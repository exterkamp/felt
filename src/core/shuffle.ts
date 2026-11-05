/**
 * A random number generator you can ask for the same numbers twice.
 *
 * Math.random is right for a game and wrong for a test: anything that deals
 * from a distribution can only be checked by dealing a great many times and
 * looking at what came out, and that is a flaky test unless the sequence is
 * fixed. Everything here takes a `() => number`, so the game passes
 * Math.random and a test passes one of these.
 *
 * mulberry32: small, fast, and far better distributed than anything built out
 * of Math.sin, which is the usual thing people reach for.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, against a supplied source of randomness so a deal can be
 * repeated.
 *
 * Generic over what is being shuffled, and it returns a new array of the same
 * items rather than copies of them. Copying is a decision about a card model
 * - one of these games clones its cards on every deal and the other does not
 * - and a shuffle that made it for you would be a shuffle you had to work
 * around.
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * One of `weights`, chosen in proportion to its weight.
 *
 * Weights rather than percentages, because percentages have to add to a
 * hundred and a table that has to add up is a table nobody wants to edit:
 * adding an entry would mean retuning every other line to make room. With
 * weights, a new entry takes its share and the rest keep their ratios.
 *
 * Entries weighing zero or less never come up, which is how something is
 * switched off without being deleted.
 */
export function pickWeighted<T extends string>(
  weights: Partial<Record<T, number>>, random: () => number,
): T | undefined {
  const entries = (Object.entries(weights) as [T, number][])
    .filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return undefined;

  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  // Only reachable through floating point drift on the last entry.
  return entries[entries.length - 1][0];
}
