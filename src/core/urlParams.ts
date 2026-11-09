// URL query params for debug: ?seed=123&skipBoot=1

export interface UrlParams {
  seed: number | null;
  skipBoot: boolean;
}

export function parseUrlParams(search: string): UrlParams {
  const params = new URLSearchParams(search);
  const seedRaw = params.get('seed');
  let seed: number | null = null;
  if (seedRaw !== null && seedRaw !== '') {
    const parsed = Number(seedRaw);
    if (Number.isFinite(parsed)) seed = parsed;
  }
  return {
    seed,
    skipBoot: params.get('skipBoot') === '1',
  };
}

export function getUrlParams(): UrlParams {
  if (typeof window === 'undefined' || !window.location) {
    return { seed: null, skipBoot: false };
  }
  return parseUrlParams(window.location.search);
}
