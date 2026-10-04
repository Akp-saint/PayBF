import { generateApiKey } from './api-key.util';
import { sha256, stableStringify } from './stable-json';

describe('generateApiKey', () => {
  it('produit des cles sk_test_ et pk_test_ au bon format', () => {
    const sk = generateApiKey('SECRET');
    const pk = generateApiKey('PUBLISHABLE');
    expect(sk.key).toMatch(/^sk_test_[A-Za-z0-9_-]{32}$/);
    expect(pk.key).toMatch(/^pk_test_[A-Za-z0-9_-]{32}$/);
  });

  it('ne stocke que le hash : prefix, last4 et SHA-256 de la cle', () => {
    const { key, prefix, last4, hash } = generateApiKey('SECRET');
    expect(prefix).toBe(key.slice(0, 12));
    expect(last4).toBe(key.slice(-4));
    expect(hash).toBe(sha256(key));
    expect(hash).not.toContain(key);
  });

  it('genere des cles uniques', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey('SECRET').key));
    expect(keys.size).toBe(200);
  });
});

describe('stableStringify', () => {
  it('ne depend pas de l\'ordre des cles', () => {
    expect(stableStringify({ a: 1, b: { d: 4, c: [1, 2] } })).toBe(stableStringify({ b: { c: [1, 2], d: 4 }, a: 1 }));
  });

  it('distingue deux corps differents et ignore les champs undefined', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});
