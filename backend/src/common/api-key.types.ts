export interface ApiKeyContext {
  id: string;
  merchantId: string;
  applicationId: string;
  environment: 'TEST' | 'LIVE';
  type: 'PUBLISHABLE' | 'SECRET';
  permissions: string[];
}
