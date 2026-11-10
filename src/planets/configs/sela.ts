// Sela: temperate home planet. Values follow docs/PROJECT.md:
// radius 400, core chamber 40, 6 m shell, layers 0-30/30-140/140-shell.

import type { PlanetConfig } from '../PlanetConfig.js';

export const SELA: PlanetConfig = {
  id: 'sela',
  name: 'Sela',
  seed: 1103,
  center: { x: 0, y: 0, z: 0 },
  radius: 400,
  gravity: 6,
  surfaceAmplitude: 15,
  surfaceFrequency: 3,
  caves: {
    frequency: 0.022,
    thresholdTop: 0.07,
    thresholdBottom: 0.24,
    startDepth: 6,
  },
  layers: [
    {
      name: 'surface',
      fromDepth: 0,
      toDepth: 30,
      hardness: 1,
      color: [0.42, 0.52, 0.3],
      colorVariation: 0.1,
    },
    {
      name: 'crust',
      fromDepth: 30,
      toDepth: 140,
      hardness: 2,
      color: [0.42, 0.3, 0.2],
      colorVariation: 0.12,
    },
    {
      name: 'mantle',
      fromDepth: 140,
      toDepth: 354,
      hardness: 3,
      color: [0.63, 0.35, 0.18],
      colorVariation: 0.15,
    },
  ],
  core: {
    chamberRadius: 40,
    shellThickness: 6,
    shellHardness: 4,
    chamberColor: [0.4, 0.9, 0.85],
  },
  caverns: {
    enabled: true,
    surfaceCapDepth: 30,
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
    roomAnchorRadius: 55,
    roomAnchorSize: 45,
  },
  surfaceColors: {
    flat: [0.36, 0.58, 0.28],
    steep: [0.45, 0.33, 0.22],
  },
  atmosphere: {
    sky: [0.5, 0.7, 1],
    ground: [0.6, 0.55, 0.45],
    height: 60,
  },
  lodMaxLevel: 5,
};
