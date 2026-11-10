// Boot pre-generation: the only loading screen. Shows "Corelight" with a
// progress bar while meshing LOD levels lodMaxLevel down to
// lodMaxLevel - 2 for every planet, then hands the results to the game so
// the planet is never bare. ?skipBoot=1 skips straight to streaming.

import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { isDefinitelyAir, nodeKey, nodesAtLevel, type OctreeNode } from '../terrain/octree.js';
import { createDensityField } from '../terrain/density.js';
import { MeshWorkerPool } from '../terrain/workerPool.js';
import type { PrebuiltTerrain } from '../render/Renderer.js';

export interface BootResult {
  prebuilt: PrebuiltTerrain[];
}

export async function runBoot(
  worldSeed: number,
  planets: PlanetConfig[],
  skipBoot: boolean,
  onProgress?: (loaded: number, total: number) => void,
): Promise<BootResult> {
  const prebuilt: PrebuiltTerrain[] = planets.map((planet) => ({ planet, results: [], emptyKeys: [] }));
  if (skipBoot) return { prebuilt };

  const overlay = document.createElement('div');
  overlay.id = 'boot';
  const title = document.createElement('h1');
  title.textContent = 'Corelight';
  const bar = document.createElement('div');
  bar.id = 'boot-bar';
  const fill = document.createElement('div');
  fill.id = 'boot-fill';
  bar.appendChild(fill);
  const label = document.createElement('div');
  label.id = 'boot-label';
  overlay.append(title, bar, label);
  document.body.appendChild(overlay);

  const report = (loaded: number, total: number): void => {
    fill.style.width = total === 0 ? '100%' : `${(100 * loaded) / total}%`;
    label.textContent = `Generating terrain ${loaded} / ${total}`;
    onProgress?.(loaded, total);
  };

  interface BootJob {
    planet: PlanetConfig;
    node: OctreeNode;
  }

  try {
    // Collect every node at the three coarsest levels; cheap air-skips are
    // filed as empty up front (same sound rule as the streamer).
    const jobs: BootJob[] = [];
    let loaded = 0;
    const total = planets.reduce((sum, planet) => {
      let count = 0;
      for (let level = planet.lodMaxLevel; level >= planet.lodMaxLevel - 2; level -= 1) {
        count += nodesAtLevel(planet, level).length;
      }
      return sum + count;
    }, 0);
    for (const planet of planets) {
      const field = createDensityField(planet, worldSeed);
      const pre = prebuilt.find((p) => p.planet.id === planet.id) as PrebuiltTerrain;
      for (let level = planet.lodMaxLevel; level >= planet.lodMaxLevel - 2; level -= 1) {
        for (const node of nodesAtLevel(planet, level)) {
          if (isDefinitelyAir(field.density, node)) {
            pre.emptyKeys.push(nodeKey(planet.id, node.level, node.coord));
            loaded += 1;
          } else {
            jobs.push({ planet, node });
          }
        }
      }
    }
    report(loaded, total);
    const pool = new MeshWorkerPool();
    try {
      await Promise.all(
        jobs.map(async ({ planet, node }) => {
          try {
            const result = await pool.submit({
              planetConfig: planet,
              worldSeed,
              level: node.level,
              coord: { ...node.coord },
            });
            const pre = prebuilt.find((p) => p.planet.id === planet.id) as PrebuiltTerrain;
            if (result.empty) pre.emptyKeys.push(result.key);
            else pre.results.push(result);
          } finally {
            loaded += 1;
            report(loaded, total);
          }
        }),
      );
    } finally {
      pool.dispose();
    }
  } finally {
    overlay.remove();
  }
  return { prebuilt };
}
