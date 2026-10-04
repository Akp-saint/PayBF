const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Convertit une duree de type "15m", "30d" en millisecondes. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Duree invalide : "${value}" (attendu : 15m, 12h, 30d...)`);
  }
  return Number(match[1]) * UNITS[match[2]];
}
