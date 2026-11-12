// A proxy volume for single-scattered sunlight, not a colored bubble.
// Positions and uniforms use floating-origin coordinates every frame.
import * as THREE from 'three';
import type { PlanetConfig } from '../planets/PlanetConfig.js';
import { ATMOSPHERE, DEPTH_FULL_DARK_M } from '../core/constants.js';
import { distance, smoothstep, type Vec3d } from '../core/math.js';
import { toLocal } from './floatingOrigin.js';
import { ATMOSPHERE_FRAGMENT, ATMOSPHERE_VERTEX } from './atmosphereShader.js';

interface Shell {
  planet: PlanetConfig;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export class Atmosphere {
  private readonly shells: Shell[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  addPlanet(planet: PlanetConfig): void {
    const height = planet.atmosphere.height;
    const scaleHeight = height * ATMOSPHERE.scaleHeightFraction;
    // Keep the planet palette, but preferentially scatter blue wavelengths.
    const tint = planet.atmosphere.sky;
    const material = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: {
        planetCenter: { value: new THREE.Vector3() },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        planetRadius: { value: planet.radius },
        atmosphereHeight: { value: height },
        scaleHeight: { value: scaleHeight },
        rayleigh: { value: new THREE.Vector3(...ATMOSPHERE.rayleighOpticalDepth)
          .multiply(new THREE.Vector3(tint[0], tint[1], tint[2])).divideScalar(scaleHeight) },
        mie: { value: ATMOSPHERE.mieOpticalDepth / scaleHeight },
        visibility: { value: 1 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      // Output is preintegrated radiance plus transmittance, not RGB * alpha.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(
      planet.radius + height, ATMOSPHERE.sphereSegments, ATMOSPHERE.sphereRings,
    ), material);
    mesh.userData['originManaged'] = true;
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.shells.push({ planet, mesh, material });
  }

  update(sunDirWorld: Vec3d, cameraLocal: Vec3d, depthBelowM = 0): void {
    for (const shell of this.shells) {
      const local = toLocal(shell.planet.center);
      shell.mesh.position.set(local.x, local.y, local.z);
      const center = shell.material.uniforms['planetCenter'] as { value: THREE.Vector3 };
      center.value.set(local.x, local.y, local.z);
      const sun = shell.material.uniforms['sunDirection'] as { value: THREE.Vector3 };
      sun.value.set(sunDirWorld.x, sunDirWorld.y, sunDirWorld.z).normalize();
      const visibility = shell.material.uniforms['visibility'] as { value: number };
      const altitude = distance(cameraLocal, local) - shell.planet.radius;
      const height = shell.planet.atmosphere.height;
      // The volume integrates to a nominal sphere, not the scene depth.
      // Inside the air layer that paints through hills/props and exposes a
      // false spherical horizon. Surface sky/fog own that view; the orbital
      // volume fades in only after leaving the air layer.
      const orbitFade = smoothstep(height * ATMOSPHERE.orbitFadeStartHeight,
        height * ATMOSPHERE.orbitFadeEndHeight, altitude);
      visibility.value = orbitFade * (1 - smoothstep(0, DEPTH_FULL_DARK_M, depthBelowM));
      shell.mesh.visible = visibility.value > 0;
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
