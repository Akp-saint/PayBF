import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiScope } from './api-scopes';
import type { ApiKeyContext } from './api-key.types';

export const API_SCOPES_KEY = 'paybf:api-scopes';
export const ALLOW_PUBLISHABLE_KEY = 'paybf:allow-publishable';

/** Exige que la cle API possede toutes les permissions listees. */
export const RequireScopes = (...scopes: ApiScope[]) => SetMetadata(API_SCOPES_KEY, scopes);

/** Autorise aussi les cles publiques (pk_...) sur cette route. Par defaut : cle secrete uniquement. */
export const AllowPublishableKey = () => SetMetadata(ALLOW_PUBLISHABLE_KEY, true);

export const CurrentApiKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): ApiKeyContext => {
  return ctx.switchToHttp().getRequest<Request & { apiKey: ApiKeyContext }>().apiKey;
});
