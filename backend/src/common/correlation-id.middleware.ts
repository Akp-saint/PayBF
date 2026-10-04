import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

/** Attache un identifiant de correlation a chaque requete et le renvoie dans la reponse. */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_HEADER);
    const valid = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming);
    const id = valid ? incoming : `req_${randomUUID()}`;
    (req as Request & { correlationId: string }).correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
    next();
  }
}
