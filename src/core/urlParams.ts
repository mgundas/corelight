// URL query params for debug: ?seed=123&skipBoot=1&time=0.5

export interface UrlParams {
  seed: number | null;
  skipBoot: boolean;
  /** Start time of day as a fraction of a full cycle (0 to 1), or null. */
  time: number | null;
  /** Dev shortcut (?dev=1): spawn with 8 tethers for oxygen testing. */
  dev: boolean;
  /** Dev shortcut (?build=1): spawn with power-base packages for testing. */
  build: boolean;
}

export function parseUrlParams(search: string): UrlParams {
  const params = new URLSearchParams(search);
  const seedRaw = params.get('seed');
  let seed: number | null = null;
  if (seedRaw !== null && seedRaw !== '') {
    const parsed = Number(seedRaw);
    if (Number.isFinite(parsed)) seed = parsed;
  }
  const timeRaw = params.get('time');
  let time: number | null = null;
  if (timeRaw !== null && timeRaw !== '') {
    const parsed = Number(timeRaw);
    if (Number.isFinite(parsed)) time = Math.min(1, Math.max(0, parsed));
  }
  return {
    seed,
    skipBoot: params.get('skipBoot') === '1',
    time,
    dev: params.get('dev') === '1',
    build: params.get('build') === '1',
  };
}

export function getUrlParams(): UrlParams {
  if (typeof window === 'undefined' || !window.location) {
    return { seed: null, skipBoot: false, time: null, dev: false, build: false };
  }
  return parseUrlParams(window.location.search);
}
