// Atmosphere shared by every lit material: aerial perspective (height fog tinted by the
// sky in the view direction and brightened toward the sun), drifting cloud shadows on the
// sunlight, and the time / wind uniforms the foliage animates with.
// three's fog chunks are replaced globally, so any material with fog gets the new look;
// materials built with withAtmosphere() also receive the uniforms below.
import * as THREE from "three";

export const atmo = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
  uFogBase: { value: 2500 },            // valley floor elevation (m): haze is densest below
  uFogFalloff: { value: 1 / 1300 },     // 1 / scale height of the haze (m)
  uFogSky: { value: 0.18 },             // sky radiance -> haze colour (the Sky shader is very bright)
  uCloudCover: { value: 0.4 },
  uCloudShadow: { value: 0.62 },        // sunlight removed under a cloud
  uCloudDrift: { value: new THREE.Vector2(7, -3) },  // m/s
  uWindDir: { value: new THREE.Vector2(0.92, 0.39) },
  uWind: { value: 1 },                  // gust strength, animated in main.js
};

const ATMO_PARS = /* glsl */ `
uniform float uTime, uFogBase, uFogFalloff, uFogSky, uCloudCover, uCloudShadow, uWind;
uniform vec3 uSunDir, uSunColor;
uniform vec2 uCloudDrift, uWindDir;
float atmoHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float atmoNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( atmoHash( i ), atmoHash( i + vec2( 1, 0 ) ), f.x ),
              mix( atmoHash( i + vec2( 0, 1 ) ), atmoHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// clouds ~3 km above the valley floor, projected along the sun onto the ground
float atmoCloudShadow( vec3 wp ) {
  if ( uCloudCover <= 0.0 ) return 1.0;
  vec2 p = wp.xz + uSunDir.xz / max( uSunDir.y, 0.2 ) * ( uFogBase + 3000.0 - wp.y );
  p = ( p - vec2( uCloudDrift.x, - uCloudDrift.y ) * uTime ) / 1700.0;
  float n = atmoNoise( p ) * 0.55 + atmoNoise( p * 2.3 + 7.1 ) * 0.3 + atmoNoise( p * 5.3 + 3.7 ) * 0.15;
  float c = smoothstep( 1.0 - uCloudCover, 1.18 - uCloudCover, n );
  return 1.0 - c * uCloudShadow;
}`;

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogWorld = instanceMatrix * fogWorld;
  #endif
  vFogWorldPos = ( modelMatrix * fogWorld ).xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${ATMO_PARS}
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 fogRay = vFogWorldPos - cameraPosition;
  float fogDist = length( fogRay );
  vec3 fogDir = fogRay / max( fogDist, 1e-3 );
  #ifdef FOG_EXP2
    // exponential height fog, integrated along the view ray
    float fk = max( uFogFalloff, 1e-6 );
    float fdy = fogDir.y * fogDist * fk;
    float fogOptical = fogDensity * exp( - fk * ( cameraPosition.y - uFogBase ) ) * fogDist
      * ( abs( fdy ) > 1e-4 ? ( 1.0 - exp( - fdy ) ) / fdy : 1.0 );
    float fogFactor = 1.0 - exp( - fogOptical );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // haze takes the colour of the sky at the horizon in this direction
  vec3 fogSky = fogColor;
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
    vec3 fogLook = normalize( vec3( fogDir.x, max( fogDir.y, 0.0 ) * 0.4 + 0.04, fogDir.z ) );
    fogSky = textureCubeUV( envMap, envMapRotation * fogLook, 0.6 ).rgb * uFogSky;
  #endif
  float fogSun = pow( max( dot( fogDir, uSunDir ), 0.0 ), 8.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogSky + uSunColor * fogSun * 0.35, fogFactor );
#endif`;

// cloud shadows dim the sun (directional light) only; sky light stays
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  `getDirectionalLightInfo( directionalLight, directLight );
    #ifdef USE_FOG
      directLight.color *= atmoCloudShadow( vFogWorldPos );
    #endif`,
);

// Give a material the atmosphere uniforms plus its own shader patch. `key` must be unique
// per patch: three caches programs by it.
export function withAtmosphere(material, key, patch) {
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, atmo);
    if (patch) patch(shader, renderer);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
