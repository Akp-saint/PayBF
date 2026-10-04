import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { ApiKeyContext } from '../api-key.types';
import { RateLimiter } from './rate-limiter.service';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  /** 'key' : par cle API (repli sur l'IP si absente). 'ip' : par adresse IP. */
  by: 'key' | 'ip';
  /** Nom du compteur : les routes qui partagent un nom partagent leur quota. */
  name?: string;
}

export const RATE_LIMIT_KEY = 'paybf:rate-limit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { apiKey?: ApiKeyContext }>();
    const res = http.getResponse<Response>();

    const options =
      this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {
        limit: this.config.get<number>('RATE_LIMIT_PER_MINUTE') ?? 120,
        windowSeconds: 60,
        by: 'key' as const,
      };

    const identity = options.by === 'key' && req.apiKey ? `key:${req.apiKey.id}` : `ip:${req.ip ?? 'unknown'}`;
    const name = options.name ?? `${context.getClass().name}.${context.getHandler().name}`;
    const result = await this.limiter.hit(`rl:${name}:${identity}`, options.limit, options.windowSeconds);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetSeconds));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.resetSeconds));
      throw new HttpException(
        { statusCode: 429, code: 'rate_limit_exceeded', message: 'Trop de requetes, reessayez plus tard' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
