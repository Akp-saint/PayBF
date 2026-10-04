import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
};

describe('validateEnv', () => {
  it('accepte une configuration valide et applique les valeurs par defaut', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.PAYBF_ENV).toBe('sandbox');
  });

  it('refuse un secret JWT trop court', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'court' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuse une configuration sans DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('refuse un mode autre que sandbox', () => {
    expect(() => validateEnv({ ...valid, PAYBF_ENV: 'live' })).toThrow(/PAYBF_ENV/);
  });
});
