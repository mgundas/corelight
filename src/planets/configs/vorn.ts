// Vorn: cold second planet. Values follow docs/PROJECT.md (radius 320, layers
// 0-25 / 25-110 / 110-shell, mantle hardness 4, 6 m core shell around a 32 m
// chamber, cold surface 1.5x, dense narrow worms). PROJECT.md leaves Vorn's
// cavern floors "TBD (arrives with M13)": they reuse the proven Sela pocket/
// slab machinery with the Vorn depths, which yields 5 floors of ~14 m rooms
// (the worms stay the primary connectors). Gravity is not specified either;
// 5 m/s^2 keeps the same feel as Sela scaled by radius (6 * 320/400 = 4.8).

import { OXYGEN_VORN_COLD_MULT } from '../../core/constants.js';
import type { PlanetConfig } from '../PlanetConfig.js';

export const VORN: PlanetConfig = {
  id: 'vorn',
  name: 'Vorn',
  seed: 2107,
  center: { x: 12000, y: 1500, z: 4000 },
  radius: 320,
  gravity: 5,
  surfaceAmplitude: 15,
  surfaceFrequency: 3,
  caves: {
    // Dense narrow worms (PROJECT.md): higher spatial frequency and lower
    // carve thresholds than Sela, so tunnels are numerous but tight.
    frequency: 0.035,
    thresholdTop: 0.05,
    thresholdBottom: 0.16,
    startDepth: 6,
  },
  layers: [
    {
      name: 'surface',
      fromDepth: 0,
      toDepth: 25,
      hardness: 1,
      color: [0.55, 0.68, 0.8],
      colorVariation: 0.08,
      // Cold: off-network oxygen drains 1.5x (PROJECT.md). Data, not code:
      // the oxygen system reads this multiplier from the layer (M12/M13).
      hazardOxygenMult: OXYGEN_VORN_COLD_MULT,
      hazardKind: 'cold',
    },
    {
      name: 'crust',
      fromDepth: 25,
      toDepth: 110,
      hardness: 2,
      color: [0.38, 0.41, 0.46],
      colorVariation: 0.1,
    },
    {
      name: 'mantle',
      fromDepth: 110,
      toDepth: 282,
      hardness: 4,
      color: [0.3, 0.22, 0.42],
      colorVariation: 0.15,
      // Heat, same 2x as Sela's mantle (PROJECT.md hazard column).
      hazardOxygenMult: 2,
      hazardKind: 'heat',
    },
  ],
  core: {
    chamberRadius: 32,
    shellThickness: 6,
    shellHardness: 4,
    chamberColor: [0.6, 0.4, 0.85],
  },
  caverns: {
    enabled: true,
    surfaceCapDepth: 25,
    cavernHeight: 14,
    slabThickness: 32,
    minFloors: 4,
    maxFloors: 8,
    floorRoughness: 1.5,
    floorRoughFrequency: 0.08,
    pitCoverage: 0.15,
    pitDepth: 3.5,
    pitFrequency: 0.05,
    minSlabLeftover: 8,
    openingBoost: 0.25,
    roomCoverage: 0.2,
    roomFrequency: 0.022,
    roomAnchorRadius: 40,
    roomAnchorSize: 40,
  },
  surfaceColors: {
    flat: [0.66, 0.78, 0.9],
    steep: [0.42, 0.44, 0.48],
  },
  atmosphere: {
    sky: [0.62, 0.76, 1],
    ground: [0.55, 0.6, 0.7],
    height: 60,
  },
  lodMaxLevel: 5,
};
