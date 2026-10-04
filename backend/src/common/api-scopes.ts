/** Permissions portees par une cle API secrete. */
export const ALL_API_SCOPES = [
  'payments:read',
  'payments:write',
  'refunds:read',
  'refunds:write',
  'customers:read',
  'customers:write',
  'transactions:read',
  'webhooks:manage',
  'payouts:write',
] as const;

export type ApiScope = (typeof ALL_API_SCOPES)[number];

export const isApiScope = (value: string): value is ApiScope =>
  (ALL_API_SCOPES as readonly string[]).includes(value);
