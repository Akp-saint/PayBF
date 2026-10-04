import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.module';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/** Limiteur a fenetre fixe base sur Redis (INCR + EXPIRE). */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      const ttl = await this.redis.ttl(key);
      const resetSeconds = ttl > 0 ? ttl : windowSeconds;
      return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetSeconds };
    } catch (error) {
      // Si Redis est indisponible on laisse passer (fail-open) plutot que de couper toute l'API.
      this.logger.warn(`Rate limiter indisponible : ${(error as Error).message}`);
      return { allowed: true, limit, remaining: limit, resetSeconds: windowSeconds };
    }
  }
}
