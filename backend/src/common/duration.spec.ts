import { parseDurationMs } from './duration';

describe('parseDurationMs', () => {
  it('convertit les unites supportees', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('12h')).toBe(43_200_000);
    expect(parseDurationMs('30d')).toBe(2_592_000_000);
  });

  it('refuse les formats invalides', () => {
    expect(() => parseDurationMs('15')).toThrow();
    expect(() => parseDurationMs('abc')).toThrow();
    expect(() => parseDurationMs('1w')).toThrow();
  });
});
