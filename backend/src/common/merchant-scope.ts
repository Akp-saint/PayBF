import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth.types';

/**
 * Retourne le merchantId du contexte d'authentification.
 * Le merchantId vient TOUJOURS du jeton, jamais du corps ou de l'URL : c'est la base de l'isolation multi-marchands.
 */
export function requireMerchantId(user: AuthUser): string {
  if (!user.merchantId) {
    throw new ForbiddenException('Cette ressource requiert un compte marchand');
  }
  return user.merchantId;
}
