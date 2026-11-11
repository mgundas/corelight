// M05 atmosphere: a BackSide shell above the planet with a gradient
// shader. It is brighter on the sunlit side and reads as a rim glow from
// space. Positions re-sync from world doubles every frame (cheap: one mesh
// per planet), so origin shifts can never desync it.

import * as THREE from 'three';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { ATMOSPHERE_SHELL_MULT } from '../core/constants.js';
import type { Vec3d } from '../core/math.js';
import { toLocal } from './floatingOrigin.js';

const VERT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform vec3 sunDirection;
uniform vec3 skyColor;
uniform vec3 groundColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  float rim = pow(1.0 - abs(dot(N, V)), 2.5);
  float day = clamp(dot(N, sunDirection) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(groundColor, skyColor, day) * (0.3 + 0.7 * day);
  gl_FragColor = vec4(col, rim * (0.25 + 0.75 * day));
}
`;

interface Shell {
  planet: PlanetConfig;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export class Atmosphere {
  private readonly shells: Shell[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  addPlanet(planet: PlanetConfig): void {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        skyColor: {
          value: new THREE.Color(planet.atmosphere.sky[0], planet.atmosphere.sky[1], planet.atmosphere.sky[2]),
        },
        groundColor: {
          value: new THREE.Color(
            planet.atmosphere.ground[0],
            planet.atmosphere.ground[1],
            planet.atmosphere.ground[2],
          ),
        },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(planet.radius * ATMOSPHERE_SHELL_MULT, 48, 32),
      material,
    );
    mesh.userData['originManaged'] = true;
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.shells.push({ planet, mesh, material });
  }

  /** Reposition from world doubles and refresh the sunlit side. */
  update(sunDirWorld: Vec3d): void {
    for (const shell of this.shells) {
      const local = toLocal(shell.planet.center);
      shell.mesh.position.set(local.x, local.y, local.z);
      const sun = shell.material.uniforms['sunDirection'] as { value: THREE.Vector3 };
      sun.value.set(sunDirWorld.x, sunDirWorld.y, sunDirWorld.z);
    }
  }

  dispose(): void {
    for (const shell of this.shells) {
      this.scene.remove(shell.mesh);
      shell.mesh.geometry.dispose();
      shell.material.dispose();
    }
    this.shells.length = 0;
  }
}
