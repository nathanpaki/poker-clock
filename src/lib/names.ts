/**
 * Player-name matching.
 *
 * normalizeName() must stay in step with the `players.name_key` generated column
 * in Postgres (see schema.ts), which is the source of truth for uniqueness:
 *   lower → drop anything that isn't a letter, digit or space → collapse spaces → trim
 * So "Hank S.", "hank s" and "  HANK   S " are the same player name.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A name needs at least one letter or digit, otherwise every key would be "". */
export const hasNameContent = (name: string) => normalizeName(name).length > 0;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Could these two (normalized, non-identical) names be the same person?
 * - small typos: "jon" / "john", "katie" / "kate", "jon smith" / "john smith"
 * - a bare first name vs the same name with a surname or initial: "hank" / "hank s"
 * Deliberately NOT similar: names that differ only by a short final initial
 * ("mike r" / "mike t"), which is how leagues tell two people apart.
 */
export function namesAreSimilar(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const ta = a.split(" ");
  const tb = b.split(" ");
  const sameUpToLast = ta.length === tb.length && ta.length >= 2 && ta.slice(0, -1).join(" ") === tb.slice(0, -1).join(" ");
  if (sameUpToLast && ta.at(-1)!.length <= 2 && tb.at(-1)!.length <= 2) return false;
  if ((ta.length === 1 && tb[0] === a) || (tb.length === 1 && ta[0] === b)) return true;
  const longest = Math.max(a.length, b.length);
  const limit = longest <= 4 ? 1 : longest <= 10 ? 2 : 3;
  return levenshtein(a, b) <= limit;
}

export type NameMatch<T> = { exact: T | null; similar: T[] };

/** Find an exact match and up to five similar names among a league's players. */
export function findNameMatches<T extends { nameKey: string }>(name: string, players: T[], excludeId?: string, idOf: (p: T) => string = (p) => (p as unknown as { id: string }).id): NameMatch<T> {
  const key = normalizeName(name);
  const pool = players.filter((p) => idOf(p) !== excludeId);
  return {
    exact: pool.find((p) => p.nameKey === key) ?? null,
    similar: pool.filter((p) => namesAreSimilar(key, p.nameKey)).slice(0, 5),
  };
}
