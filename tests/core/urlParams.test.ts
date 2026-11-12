import { describe, expect, it } from 'vitest';
import { parseUrlParams } from '../../src/core/urlParams.js';

describe('parseUrlParams', () => {
  it('parses seed, skipBoot, time and dev', () => {
    expect(parseUrlParams('')).toEqual({
      seed: null,
      skipBoot: false,
      time: null,
      dev: false,
      build: false,
    });
    expect(parseUrlParams('?seed=123')).toMatchObject({ seed: 123, dev: false });
    expect(parseUrlParams('?skipBoot=1&time=0.5')).toMatchObject({ skipBoot: true, time: 0.5 });
    // M08 dev shortcut: a fresh run starts with a full tether pack.
    expect(parseUrlParams('?dev=1')).toMatchObject({ dev: true });
    expect(parseUrlParams('?dev=0')).toMatchObject({ dev: false });
    // M10 dev shortcut: power-base packages for the base building test.
    expect(parseUrlParams('?build=1')).toMatchObject({ build: true });
    expect(parseUrlParams('?build=0')).toMatchObject({ build: false });
  });
});
