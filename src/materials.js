// Materials for the valley meshes. Colours come from the data (Sentinel-2 + OSM ground
// textures, Blender's baked vertex colours); photo-scanned detail maps (Poly Haven, packed
// by scripts/build-textures.mjs: R = luminance, GB = normal) add the close-up surface:
// planar soil / grass on the ground, triplanar layered rock on the cliff and steep slopes,
// mud plaster on the houses.
import * as THREE from "three";
import { withAtmosphere } from "./atmosphere.js";

export const NOISE_GLSL = /* glsl */ `
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1, 0 ) ), f.x ), mix( hash12( i + vec2( 0, 1 ) ), hash12( i + vec2( 1, 1 ) ), f.x ), f.y );
}`;

const DETAIL_GLSL = /* glsl */ `
vec3 unpackDetailNormal( vec3 t, float strength ) {
  vec2 xy = ( t.gb * 2.0 - 1.0 ) * strength;
  return vec3( xy, sqrt( max( 1.0 - dot( xy, xy ), 0.0 ) ) );
}
// triplanar detail (Golus' whiteout blend): x = luminance / mean, n = perturbed world normal
struct Detail { float lum; vec3 n; };
Detail triplanar( sampler2D tex, vec3 p, vec3 n, float scale, float mean, float strength ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) );
  w /= w.x + w.y + w.z;
  vec3 s = vec3( n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0 );
  vec2 uvX = p.zy * scale, uvY = p.xz * scale, uvZ = p.xy * scale;
  uvX.x *= s.x; uvY.x *= s.y; uvZ.x *= - s.z;
  vec3 tX = vec3( mean, 0.5, 0.5 ), tY = tX, tZ = tX;
  if ( w.x > 0.02 ) tX = texture2D( tex, uvX ).rgb;
  if ( w.y > 0.02 ) tY = texture2D( tex, uvY ).rgb;
  if ( w.z > 0.02 ) tZ = texture2D( tex, uvZ ).rgb;
  Detail d;
  d.lum = ( tX.r * w.x + tY.r * w.y + tZ.r * w.z ) / mean;
  #ifdef DETAIL_NORMALS
    vec3 nX = unpackDetailNormal( tX, strength ), nY = unpackDetailNormal( tY, strength ), nZ = unpackDetailNormal( tZ, strength );
    nX.x *= s.x; nY.x *= s.y; nZ.x *= - s.z;
    nX = vec3( nX.xy + n.zy, abs( nX.z ) * n.x );
    nY = vec3( nY.xy + n.xz, abs( nY.z ) * n.y );
    nZ = vec3( nZ.xy + n.xy, abs( nZ.z ) * n.z );
    d.n = normalize( nX.zyx * w.x + nY.xzy * w.y + nZ.xyz * w.z );
  #else
    d.n = n;
  #endif
  return d;
}
// top-down projection for the ground
Detail planar( vec3 t, vec3 n, float mean, float strength ) {
  Detail d;
  d.lum = t.r / mean;
  #ifdef DETAIL_NORMALS
    vec3 tn = unpackDetailNormal( t, strength );
    d.n = normalize( vec3( tn.x + n.x, abs( tn.z ) * n.y, tn.y + n.z ) );
  #else
    d.n = n;
  #endif
  return d;
}`;

// world position + world normal varyings for the fragment code
function worldVaryings(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;")
    .replace("#include <project_vertex>", `#include <project_vertex>
      vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      vWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );`);
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
    `#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\n${NOISE_GLSL}\n${DETAIL_GLSL}`);
}

// replace the geometric normal by the detail normal (world -> view space)
const APPLY_DETAIL_NORMAL = /* glsl */ `#include <normal_fragment_maps>
  #ifdef DETAIL_NORMALS
    normal = normalize( ( viewMatrix * vec4( detailN, 0.0 ) ).xyz );
  #endif`;

export function loadDetailTextures(loader, renderer, meta) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const out = {};
  return Promise.all(Object.entries(meta.maps).map(([name, m]) => loader.loadAsync(`./${m.file}`).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;   // packed data, not colour
    t.anisotropy = aniso;
    out[name] = { tex: t, mean: m.mean };
  }))).then(() => out);
}

// ------------------------------------------------------------------ terrain + cliff
// Vertex colour alpha 0 = ground (use the satellite/OSM textures), 1 = own colour (cliff rock).
export function groundMaterial(ground, textures, detail, tier) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  if (tier.detailNormals) mat.defines = { DETAIL_NORMALS: "" };
  const vb = ground.valley.bounds;
  const cb = ground.core.bounds;
  return withAtmosphere(mat, "bamyan-ground", (shader) => {
    Object.assign(shader.uniforms, {
      uValley: { value: textures.valley },
      uCore: { value: textures.core },
      uValleyB: { value: new THREE.Vector4(...vb) },
      uCoreB: { value: new THREE.Vector4(...cb) },
      uRock: { value: detail.rock.tex },
      uDry: { value: detail.dry.tex },
      uGrass: { value: detail.grass.tex },
      uMeans: { value: new THREE.Vector3(detail.rock.mean, detail.dry.mean, detail.grass.mean) },
    });
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uValley, uCore, uRock, uDry, uGrass;
uniform vec4 uValleyB, uCoreB;
uniform vec3 uMeans;
float insideFade( vec2 p, vec4 b, float f ) {
  float d = min( min( p.x - b.x, b.z - p.x ), min( p.y - b.y, b.w - p.y ) );
  return smoothstep( 0.0, f, d );
}
vec2 boundsUV( vec2 p, vec4 b ) { return ( p - b.xy ) / ( b.zw - b.xy ); }`)
      .replace("#include <color_fragment>", `
#if defined( USE_COLOR_ALPHA )
  vec3 vcol = vColor.rgb; float rockMask = vColor.a;
#else
  vec3 vcol = vColor; float rockMask = 1.0;
#endif
  vec2 lp = vec2( vWorldPos.x, - vWorldPos.z );          // local metres, x east, y north
  vec3 ground = vcol;
  float inV = insideFade( lp, uValleyB, 600.0 );
  if ( inV > 0.0 ) ground = mix( ground, texture2D( uValley, boundsUV( lp, uValleyB ) ).rgb, inV );
  float inC = insideFade( lp, uCoreB, 200.0 );
  if ( inC > 0.0 ) ground = mix( ground, texture2D( uCore, boundsUV( lp, uCoreB ) ).rgb, inC );

  vec3 nGeo = normalize( vWorldNormal );
  float camDist = distance( vWorldPos, cameraPosition );
  float detailNear = 1.0 - smoothstep( 90.0, 900.0, camDist );
  // cliff rock, and bare rock on steep ground
  float rockW = clamp( max( rockMask, smoothstep( 0.42, 0.62, 1.0 - nGeo.y ) ), 0.0, 1.0 );
  float dLum = 1.0;
  vec3 detailN = nGeo;
  if ( rockW < 0.99 ) {
    float green = clamp( ( ground.g - max( ground.r, ground.b ) ) * 16.0 + 0.15, 0.0, 1.0 );
    vec3 t = mix( texture2D( uDry, vWorldPos.xz * 0.31 ).rgb, texture2D( uGrass, vWorldPos.xz * 0.43 ).rgb, green );
    Detail g = planar( t, nGeo, mix( uMeans.y, uMeans.z, green ), 1.1 );
    dLum = g.lum;
    detailN = g.n;
  }
  if ( rockW > 0.01 ) {
    // strata wander up and down instead of repeating in straight bands
    vec3 rp = vWorldPos + vec3( 0.0, ( vnoise( vWorldPos.xz * 0.045 ) - 0.5 ) * 9.0 + ( vnoise( vWorldPos.xz * 0.19 + 3.1 ) - 0.5 ) * 2.5, 0.0 );
    Detail r = triplanar( uRock, rp, nGeo, 0.14, uMeans.x, 1.35 );
    // a second, coarser layer breaks up the tiling
    float macro = texture2D( uRock, vec2( rp.x + rp.z, rp.y ) * 0.021 ).r / uMeans.x;
    dLum = mix( dLum, r.lum * mix( 1.0, macro, 0.45 ), rockW );
    detailN = normalize( mix( detailN, r.n, rockW ) );
  }
  detailN = normalize( mix( nGeo, detailN, detailNear ) );
  // the baked cliff palette is a little too saturated next to the photos
  vec3 rockCol = mix( vec3( dot( vcol, vec3( 0.2126, 0.7152, 0.0722 ) ) ), vcol, 0.72 );
  vec3 baseCol = mix( ground, rockCol, rockMask );
  baseCol *= 0.88 + 0.24 * ( vnoise( lp * 0.021 ) * 0.6 + vnoise( lp * 0.13 ) * 0.4 );
  diffuseColor.rgb *= baseCol * mix( 1.0, dLum, mix( 0.25, 0.95, detailNear ) );`)
      .replace("#include <normal_fragment_maps>", APPLY_DETAIL_NORMAL);
  });
}

// ------------------------------------------------------------------ buildings
export function buildingMaterial(detail, tier) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  if (tier.detailNormals) mat.defines = { DETAIL_NORMALS: "" };
  return withAtmosphere(mat, "bamyan-buildings", (shader) => {
    Object.assign(shader.uniforms, {
      uPlaster: { value: detail.plaster.tex },
      uPlasterMean: { value: detail.plaster.mean },
    });
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uPlaster;\nuniform float uPlasterMean;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 nGeo = normalize( vWorldNormal );
        float detailNear = 1.0 - smoothstep( 60.0, 600.0, distance( vWorldPos, cameraPosition ) );
        Detail pl = triplanar( uPlaster, vWorldPos, nGeo, 0.45, uPlasterMean, 1.1 );
        vec3 detailN = normalize( mix( nGeo, pl.n, detailNear ) );
        // uneven mud plaster: blotches, vertical rain streaks, darker and damp at the foot
        vec2 wp = vec2( vWorldPos.x + vWorldPos.z, vWorldPos.y );
        float blot = vnoise( wp * 0.9 ) * 0.6 + vnoise( wp * 3.1 ) * 0.4;
        float streak = vnoise( vec2( wp.x * 2.3, wp.y * 0.12 ) );
        diffuseColor.rgb *= ( 0.8 + 0.28 * blot - 0.1 * streak ) * mix( 1.0, pl.lum, mix( 0.3, 0.9, detailNear ) );`)
      .replace("#include <normal_fragment_maps>", APPLY_DETAIL_NORMAL);
  });
}
