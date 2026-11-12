import { ATMOSPHERE } from '../core/constants.js';

export const ATMOSPHERE_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

// Single scattering: exponential Rayleigh + aerosol density, integrated
// along the view ray and toward the sun. The proxy sphere has no rim color.
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform vec3 planetCenter;
uniform vec3 sunDirection;
uniform vec3 rayleigh;
uniform float planetRadius;
uniform float atmosphereHeight;
uniform float scaleHeight;
uniform float mie;
uniform float visibility;
uniform mat4 projectionMatrix;
varying vec3 vWorldPos;
#include <logdepthbuf_pars_fragment>
const float PI = 3.14159265359;
const int VIEW_SAMPLES = ${ATMOSPHERE.viewSamples};
const int SUN_SAMPLES = ${ATMOSPHERE.sunSamples};

vec2 sphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float d = b * b - dot(origin, origin) + radius * radius;
  if (d < 0.0) return vec2(1.0, -1.0);
  float root = sqrt(d);
  return vec2(-b - root, -b + root);
}
vec2 density(vec3 point) {
  float h = max(0.0, length(point) - planetRadius);
  // Fade to zero before the proxy boundary: no visible membrane edge.
  float edge = 1.0 - smoothstep(atmosphereHeight * 0.75, atmosphereHeight, h);
  return exp(-h / vec2(scaleHeight, scaleHeight * ${ATMOSPHERE.mieScaleHeightFraction})) * edge;
}
vec3 extinction(vec2 opticalDepth) {
  return rayleigh * opticalDepth.x + vec3(mie * opticalDepth.y);
}
void main() {
  if (visibility < 0.001) discard;
  vec3 origin = cameraPosition - planetCenter;
  vec3 dir = normalize(vWorldPos - cameraPosition);
  vec2 interval = sphere(origin, dir, planetRadius + atmosphereHeight);
  float start = max(0.0, interval.x);
  float end = interval.y;
  vec2 ground = sphere(origin, dir, planetRadius);
  if (ground.x > 0.0 && ground.y >= ground.x) end = min(end, ground.x);
  // In low valleys the camera may be below the nominal spherical radius.
  // Begin at the outgoing surface instead of integrating through solid rock.
  if (length(origin) < planetRadius) start = max(start, ground.y);
  if (end <= start) discard;
  float stepSize = (end - start) / float(VIEW_SAMPLES);
  vec2 viewDepth = vec2(0.0);
  vec3 sumRayleigh = vec3(0.0);
  vec3 sumMie = vec3(0.0);
  for (int i = 0; i < VIEW_SAMPLES; i++) {
    vec3 point = origin + dir * (start + (float(i) + 0.5) * stepSize);
    vec2 sampleDepth = density(point) * stepSize;
    viewDepth += sampleDepth * 0.5;
    vec2 sunGround = sphere(point, sunDirection, planetRadius);
    if (!(sunGround.x > 0.0 && sunGround.y > sunGround.x)) {
      float sunEnd = sphere(point, sunDirection, planetRadius + atmosphereHeight).y;
      float sunStep = max(0.0, sunEnd) / float(SUN_SAMPLES);
      vec2 sunDepth = vec2(0.0);
      for (int j = 0; j < SUN_SAMPLES; j++) {
        sunDepth += density(point + sunDirection * ((float(j) + 0.5) * sunStep)) * sunStep;
      }
      vec3 transmittance = exp(-extinction(viewDepth + sunDepth));
      sumRayleigh += transmittance * sampleDepth.x;
      sumMie += transmittance * sampleDepth.y;
    }
    viewDepth += sampleDepth * 0.5;
  }
  float mu = dot(dir, sunDirection);
  float g = ${ATMOSPHERE.mieAnisotropy};
  float phaseR = 3.0 * (1.0 + mu * mu) / (16.0 * PI);
  float phaseM = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 radiance = ${ATMOSPHERE.sunIntensity.toFixed(1)} * (sumRayleigh * rayleigh * phaseR + sumMie * mie * phaseM);
  float alpha = clamp(1.0 - exp(-dot(extinction(viewDepth), vec3(0.333333))), 0.0, 0.9);
  // Depth belongs to the ray's atmosphere entry, not the back of the proxy.
  // This lets air veil its own planet while nearer terrain still occludes it.
  vec4 entryView = viewMatrix * vec4(cameraPosition + dir * max(start, 0.1), 1.0);
  #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    gl_FragDepth = log2(max(1.000001, 1.0 - entryView.z)) * logDepthBufFC * 0.5;
  #else
    vec4 entryClip = projectionMatrix * entryView;
    gl_FragDepth = entryClip.z / entryClip.w * 0.5 + 0.5;
  #endif
  gl_FragColor = vec4(radiance * visibility, alpha * visibility);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`;
