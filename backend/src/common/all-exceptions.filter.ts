import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Format d'erreur unique : { error: { status, code, message, correlation_id } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { correlationId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message: string | string[] = 'Erreur interne';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const obj = body as { code?: string; message?: string | string[]; error?: string };
        message = obj.message ?? exception.message;
        code = obj.code ?? (obj.error ?? 'error').toLowerCase().replace(/\s+/g, '_');
      }
    } else {
      this.logger.error(`[${req.correlationId}] ${(exception as Error)?.stack ?? String(exception)}`);
    }

    res.status(status).json({ error: { status, code, message, correlation_id: req.correlationId } });
  }
}
