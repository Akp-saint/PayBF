import { randomBytes } from 'crypto';

/** Identifiant public prefixe et non devinable, ex. txn_9f2c... (96 bits d'entropie). */
export function newId(prefix: 'txn' | 'ref' | 'po' | 'evt' | 'cus'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}
