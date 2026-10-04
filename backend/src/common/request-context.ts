import type { Request } from 'express';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export function getRequestContext(req: Request): RequestContext {
  return {
    ip: req.ip,
    userAgent: req.header('user-agent') ?? undefined,
    correlationId: (req as Request & { correlationId?: string }).correlationId,
  };
}
