import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard, RateLimitOptions } from './rate-limit.guard';
import { RateLimiter } from './rate-limiter.service';

/** Redis minimal en memoire : INCR / EXPIRE / TTL. */
function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    status: 'ready',
    connect: jest.fn(),
    incr: jest.fn(async (k: string) => {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    }),
    expire: jest.fn(async () => 1),
    ttl: jest.fn(async () => 42),
  };
}

describe('RateLimiter', () => {
  it('autorise jusqu\'a la limite puis refuse', async () => {
    const limiter = new RateLimiter(fakeRedis() as never);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit('k', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    expect(results[3].remaining).toBe(0);
  });

  it('isole les compteurs par cle', async () => {
    const limiter = new RateLimiter(fakeRedis() as never);
    await limiter.hit('a', 1, 60);
    expect((await limiter.hit('b', 1, 60)).allowed).toBe(true);
    expect((await limiter.hit('a', 1, 60)).allowed).toBe(false);
  });

  it('laisse passer si Redis est indisponible (fail-open)', async () => {
    const redis = { ...fakeRedis(), incr: jest.fn().mockRejectedValue(new Error('down')) };
    const result = await new RateLimiter(redis as never).hit('k', 1, 60);
    expect(result.allowed).toBe(true);
  });
});

describe('RateLimitGuard', () => {
  function build(options: RateLimitOptions | undefined, request: Record<string, unknown>) {
    const limiter = new RateLimiter(fakeRedis() as never);
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(options) } as unknown as Reflector;
    const config = { get: () => 120 };
    const guard = new RateLimitGuard(limiter, reflector, config as never);
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
    const context = {
      getHandler: () => ({ name: 'handler' }),
      getClass: () => ({ name: 'Controller' }),
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
    } as unknown as ExecutionContext;
    return { guard, context, headers };
  }

  it('renvoie 429 avec Retry-After au-dela de la limite', async () => {
    const { guard, context, headers } = build({ limit: 2, windowSeconds: 60, by: 'ip' }, { ip: '1.2.3.4' });
    await guard.canActivate(context);
    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(headers['Retry-After']).toBe('42');
    expect(headers['X-RateLimit-Limit']).toBe('2');
  });

  it('compte par cle API quand elle est presente, sinon par IP', async () => {
    const withKey = build({ limit: 1, windowSeconds: 60, by: 'key' }, { ip: '9.9.9.9', apiKey: { id: 'key_1' } });
    await withKey.guard.canActivate(withKey.context);
    await expect(withKey.guard.canActivate(withKey.context)).rejects.toBeInstanceOf(HttpException);
  });

  it('applique la limite par defaut de la configuration', async () => {
    const { guard, context, headers } = build(undefined, { ip: '1.1.1.1' });
    await guard.canActivate(context);
    expect(headers['X-RateLimit-Limit']).toBe('120');
  });
});
