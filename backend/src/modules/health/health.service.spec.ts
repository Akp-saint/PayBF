import { HealthService } from './health.service';

function build(opts: { dbOk: boolean; redisOk: boolean }) {
  const prisma = {
    $queryRaw: opts.dbOk ? jest.fn().mockResolvedValue([{ '?column?': 1 }]) : jest.fn().mockRejectedValue(new Error('db')),
  };
  const redis = {
    status: 'ready',
    connect: jest.fn(),
    ping: opts.redisOk ? jest.fn().mockResolvedValue('PONG') : jest.fn().mockRejectedValue(new Error('redis')),
  };
  return new HealthService(prisma as never, redis as never);
}

describe('HealthService', () => {
  it('retourne ok quand la base et Redis repondent', async () => {
    const report = await build({ dbOk: true, redisOk: true }).check();
    expect(report.status).toBe('ok');
    expect(report.environment).toBe('sandbox');
    expect(report.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('retourne degraded quand la base est indisponible', async () => {
    const report = await build({ dbOk: false, redisOk: true }).check();
    expect(report.status).toBe('degraded');
    expect(report.checks.database).toBe('down');
  });

  it('retourne degraded quand Redis est indisponible', async () => {
    const report = await build({ dbOk: true, redisOk: false }).check();
    expect(report.status).toBe('degraded');
    expect(report.checks.redis).toBe('down');
  });
});
