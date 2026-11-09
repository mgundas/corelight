// Stable string entity IDs. Never use array indexes as references.

let counter = 0;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Random-ish unique ID for gameplay use (not deterministic). */
export function newId(prefix: string): string {
  counter += 1;
  const time = Date.now().toString(36);
  let rand = '';
  for (let i = 0; i < 5; i += 1) {
    rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${time}${counter.toString(36)}${rand}`;
}

/** Deterministic ID generator for tests: seed -> repeatable sequence. */
export function createDeterministicId(prefix: string, seed = 1): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}_test_${seed}_${n}`;
  };
}
