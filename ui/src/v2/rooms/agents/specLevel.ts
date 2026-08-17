/**
 * Display-only compression of the 1-10 `authority_level` scale into the
 * spec §30 UI's 6-band "LEVEL 0-5" framing. Mirrors
 * `src/roles/authority.ts`'s `toSpecLevel`/`SPEC_LEVEL_LABELS` (the UI and
 * daemon are separate bundles, so this is a deliberate small duplicate, not
 * a second source of truth for the band boundaries — see that file's doc
 * comment for why this stays additive rather than migrating stored levels).
 */

export type SpecLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const SPEC_LEVEL_LABELS: Record<SpecLevel, string> = {
  0: "No access",
  1: "Read only",
  2: "Read + write",
  3: "Command execution",
  4: "Agent management",
  5: "Full access",
};

export function toSpecLevel(authorityLevel: number): SpecLevel {
  if (authorityLevel <= 0) return 0;
  if (authorityLevel <= 2) return 1;
  if (authorityLevel <= 4) return 2;
  if (authorityLevel <= 6) return 3;
  if (authorityLevel <= 8) return 4;
  return 5;
}

export function specLevelLabel(authorityLevel: number): string {
  return SPEC_LEVEL_LABELS[toSpecLevel(authorityLevel)];
}
