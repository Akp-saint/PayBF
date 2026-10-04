import { randomBytes } from 'crypto';
import { sha256 } from './stable-json';

export type ApiKeyKind = 'SECRET' | 'PUBLISHABLE';

export interface GeneratedApiKey {
  /** Cle complete : a afficher UNE seule fois, jamais stockee. */
  key: string;
  prefix: string;
  last4: string;
  /** SHA-256 de la cle : seul element stocke en base. */
  hash: string;
}

/** Genere une cle `sk_test_xxx` / `pk_test_xxx` (192 bits d'entropie). */
export function generateApiKey(type: ApiKeyKind, environment: 'TEST' | 'LIVE' = 'TEST'): GeneratedApiKey {
  const kind = type === 'SECRET' ? 'sk' : 'pk';
  const env = environment === 'TEST' ? 'test' : 'live';
  const key = `${kind}_${env}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), last4: key.slice(-4), hash: sha256(key) };
}
