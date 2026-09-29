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
  float detailNear = 1.0 - smoothstep( 50.0, 650.0, camDist );
  // cliff rock, and bare rock on steep ground
  float rockW = clamp( max( rockMask, smoothstep( 0.42, 0.62, 1.0 - nGeo.y ) ), 0.0, 1.0 );
  float dLum = 1.0;
  vec3 detailN = nGeo;
  if ( rockW < 0.99 ) {
    float green = clamp( ( ground.g - max( ground.r, ground.b ) ) * 16.0 + 0.15, 0.0, 1.0 );
    vec3 t = mix( texture2D( uDry, vWorldPos.xz * 0.31 ).rgb, texture2D( uGrass, vWorldPos.xz * 0.43 ).rgb, green );
    Detail g = planar( t, nGeo, mix( uMeans.y, uMeans.z, green ), 1.1 );
    // a second, larger and rotated sample hides the repeat
    vec2 ruv = mat2( 0.8, -0.6, 0.6, 0.8 ) * vWorldPos.xz * 0.083;
    float big = ( green > 0.5 ? texture2D( uGrass, ruv ).r / uMeans.z : texture2D( uDry, ruv ).r / uMeans.y );
    dLum = g.lum * mix( 1.0, big, 0.5 );
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
  diffuseColor.rgb *= baseCol * mix( 1.0, dLum, mix( 0.12, 0.95, detailNear ) );`)
      .replace("#include <normal_fragment_maps>", APPLY_DETAIL_NORMAL);
  });
}

// ------------------------------------------------------------------ buildings
// Mud-plastered walls with a damp, dirty foot; windows (dark glass reflecting the sky in
// painted wooden frames) and doors placed per floor from the building's base / roof height
// (aBld, see world.js); coloured roofs are corrugated tin.
const BUILDING_GLSL = /* glsl */ `
// returns 1 inside a box of half size h (x across, y up) around q, antialiased
float boxMask( vec2 q, vec2 h, vec2 fw ) {
  vec2 d = h - abs( q );
  return smoothstep( - fw.x, fw.x, d.x ) * smoothstep( - fw.y, fw.y, d.y );
}`;

export function buildingMaterial(detail, tier) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  if (tier.detailNormals) mat.defines = { DETAIL_NORMALS: "" };
  return withAtmosphere(mat, "bamyan-buildings", (shader) => {
    Object.assign(shader.uniforms, {
      uPlaster: { value: detail.plaster.tex },
      uPlasterMean: { value: detail.plaster.mean },
    });
    worldVaryings(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aBld;\nvarying vec3 vBld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vBld = aBld;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uPlaster;
uniform float uPlasterMean;
varying vec3 vBld;
${BUILDING_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 nGeo = normalize( vWorldNormal );
        float camD = distance( vWorldPos, cameraPosition );
        float detailNear = 1.0 - smoothstep( 60.0, 600.0, camD );
        Detail pl = triplanar( uPlaster, vWorldPos, nGeo, 0.45, uPlasterMean, 1.1 );
        vec3 detailN = normalize( mix( nGeo, pl.n, detailNear ) );
        // uneven mud plaster: blotches, vertical rain streaks
        vec2 wp = vec2( vWorldPos.x + vWorldPos.z, vWorldPos.y );
        float blot = vnoise( wp * 0.9 ) * 0.6 + vnoise( wp * 3.1 ) * 0.4;
        float streak = vnoise( vec2( wp.x * 2.3, wp.y * 0.12 ) );
        diffuseColor.rgb *= ( 0.8 + 0.28 * blot - 0.1 * streak ) * mix( 1.0, pl.lum, mix( 0.3, 0.9, detailNear ) );

        float seed = vBld.z;
        float hB = vWorldPos.y - vBld.x - 0.35;          // above the ground floor
        float hTop = vBld.y - vWorldPos.y;               // below the roof line
        float glass = 0.0, tin = 0.0;
        vec3 cmax = max( vColor.rgb, vec3( 0.0 ) );
        float sat = max( cmax.r, max( cmax.g, cmax.b ) ) - min( cmax.r, min( cmax.g, cmax.b ) );
        if ( abs( nGeo.y ) < 0.3 ) {
          // wall: darker, damp foot and a worn top edge
          diffuseColor.rgb *= mix( 0.62, 1.0, smoothstep( 0.0, 1.1, hB ) ) * mix( 1.08, 1.0, smoothstep( 0.0, 0.35, hTop ) );
          vec2 tng = normalize( vec2( - nGeo.z, nGeo.x ) );
          float u = dot( vWorldPos.xz, tng );
          vec2 fw = vec2( fwidth( u ), fwidth( hB ) ) * 1.2 + 1e-4;
          float fade = 1.0 - smoothstep( 250.0, 700.0, camD );
          if ( fade > 0.0 && vBld.y - vBld.x > 2.4 && fract( seed * 3.17 ) > 0.3 ) {
            float level = floor( hB / 3.0 );
            float fy = hB - level * 3.0;
            float spacing = 3.2 + fract( seed * 7.3 ) * 1.8;
            float cell = floor( u / spacing );
            float fu = u - ( cell + 0.5 ) * spacing;
            float rnd = hash12( vec2( cell, level + seed * 131.0 ) );
            // painted frames: faded blue, green or plain wood
            float pick = fract( seed * 11.7 );
            vec3 frame = pick < 0.35 ? vec3( 0.07, 0.14, 0.22 ) : pick < 0.55 ? vec3( 0.06, 0.13, 0.08 ) : vec3( 0.12, 0.07, 0.035 );
            if ( level < 0.5 && rnd < 0.18 ) {
              // door
              vec2 q = vec2( fu, fy - 1.05 );
              float outer = boxMask( q, vec2( 0.6, 1.08 ), fw );
              float inner = boxMask( q, vec2( 0.52, 1.0 ), fw );
              float planks = 0.85 + 0.15 * smoothstep( 0.35, 0.5, abs( fract( fu * 7.0 ) - 0.5 ) );
              vec3 door = mix( frame * 1.2, vec3( 0.1, 0.06, 0.03 ) * planks, inner );
              diffuseColor.rgb = mix( diffuseColor.rgb, door, outer * fade );
            } else if ( rnd < 0.8 && hTop > 0.9 ) {
              vec2 q = vec2( fu, fy - 1.75 );
              vec2 half_ = vec2( 0.42 + 0.2 * fract( seed * 5.7 ), 0.6 );
              float outer = boxMask( q, half_ + 0.08, fw );
              float inner = boxMask( q, half_, fw );
              // glass: dark, a little lighter at the bottom, shadowed under the lintel
              vec3 pane = vec3( 0.02, 0.025, 0.03 ) * ( 1.2 - 0.6 * smoothstep( -0.6, 0.6, q.y ) );
              float bars = smoothstep( 0.03, 0.0, abs( q.x ) - fw.x ) * inner;
              vec3 win = mix( frame, pane, inner - bars );
              diffuseColor.rgb = mix( diffuseColor.rgb, win, outer * fade );
              glass = ( inner - bars ) * fade;
              // sill shadow on the wall just below
              diffuseColor.rgb *= 1.0 - 0.35 * boxMask( q + vec2( 0.0, half_.y + 0.2 ), vec2( half_.x + 0.1, 0.12 ), fw ) * fade;
            }
          }
        } else if ( nGeo.y > 0.7 && sat > 0.1 ) {
          // coloured roofs are corrugated tin
          tin = 1.0;
          float axis = fract( seed * 5.3 ) > 0.5 ? vWorldPos.x : vWorldPos.z;
          float per = 6.2831 / 0.09;
          float fade = 1.0 - smoothstep( 0.02, 0.06, fwidth( axis ) );
          float slope = cos( axis * per ) * 0.35 * fade;
          vec3 ripple = fract( seed * 5.3 ) > 0.5 ? vec3( slope, 0.0, 0.0 ) : vec3( 0.0, 0.0, slope );
          detailN = normalize( nGeo + ripple );
          diffuseColor.rgb *= 0.9 + 0.2 * vnoise( vWorldPos.xz * 0.7 );
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.12, glass );
        roughnessFactor = mix( roughnessFactor, 0.42, tin );`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = mix( metalnessFactor, 0.55, tin );`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        #ifdef DETAIL_NORMALS
          normal = normalize( ( viewMatrix * vec4( detailN, 0.0 ) ).xyz );
        #else
          if ( tin > 0.5 ) normal = normalize( ( viewMatrix * vec4( detailN, 0.0 ) ).xyz );
        #endif`);
  });
}
