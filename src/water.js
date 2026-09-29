// The Bamian River and the streams from OpenStreetMap (water.json, scripts/make-water.mjs):
// ribbons draped on the terrain, with ripples that flow downstream, sky reflections and sun
// glints, foam along the banks and soft edges. Built in slices after the world is shown.
// Also reports how close the player is to running water (for the sound).
import * as THREE from "three";
import { withAtmosphere } from "./atmosphere.js";
import { NOISE_GLSL } from "./materials.js";

const CELL = 60;

function waterMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: false, roughness: 0.07, metalness: 0,
    transparent: true, depthWrite: false,
  });
  return withAtmosphere(mat, "bamyan-water", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec2 aDir;
attribute vec3 aFlow;      // across 0..1, metres downstream, width
varying vec2 vDir;
varying vec3 vFlow;
varying vec3 vWPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vDir = aDir;
        vFlow = aFlow;
        vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec2 vDir;
varying vec3 vFlow;
varying vec3 vWPos;
${NOISE_GLSL}
// ripple height field in (across, along) metres; flows downstream
float ripples( vec2 q, float t ) {
  return vnoise( vec2( q.x * 2.1, q.y * 0.8 - t * 1.9 ) ) * 0.5
       + vnoise( vec2( q.x * 4.7 + 5.0, q.y * 2.3 - t * 2.7 ) ) * 0.3
       + vnoise( vec2( q.x * 10.3 + 1.0, q.y * 6.1 - t * 3.6 ) ) * 0.2;
}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float across = vFlow.x, width = vFlow.z;
        float bank = min( across, 1.0 - across ) * width;       // metres from the nearer bank
        vec2 q = vec2( across * width, vFlow.y );
        float h = ripples( q, uTime );
        // silty green-grey water, darker where it is deep
        float depth = smoothstep( 0.0, width * 0.35, bank );
        diffuseColor.rgb = mix( vec3( 0.11, 0.1, 0.075 ), vec3( 0.03, 0.05, 0.045 ), depth );
        // foam and riffles along the banks
        float foam = smoothstep( 0.6, 0.78, h ) * ( 1.0 - smoothstep( 0.2, 1.6, bank ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.56, 0.52 ), foam * 0.7 );
        diffuseColor.a = smoothstep( 0.0, 0.9, bank ) * mix( 0.78, 0.94, depth );
        float waterFoam = foam;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix( 0.06, 0.5, waterFoam );`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          float e = 0.08;
          float hx = ripples( q + vec2( e, 0.0 ), uTime ) - ripples( q - vec2( e, 0.0 ), uTime );
          float hy = ripples( q + vec2( 0.0, e ), uTime ) - ripples( q - vec2( 0.0, e ), uTime );
          float amp = 0.2 * ( 1.0 - smoothstep( 60.0, 700.0, distance( vWPos, cameraPosition ) ) );
          vec2 acrossDir = vec2( - vDir.y, vDir.x );
          vec2 g = ( acrossDir * hx + vDir * hy ) * amp / ( 2.0 * e );
          vec3 nW = normalize( vec3( - g.x, 1.0, - g.y ) );
          normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
        }`);
  });
}

export class Water {
  constructor(scene, world, data, env) {
    this.scene = scene;
    this.world = world;
    this.lines = data.lines;
    this.material = waterMaterial();
    this.setEnvironment(env);
    this.grid = new Map();
    this.ready = false;
    this._p = new THREE.Vector3();
  }

  // the water mirrors the sky much more strongly than the scene's diffuse sky light
  setEnvironment(tex) {
    this.material.envMap = tex;
    this.material.envMapIntensity = 0.16;
    this.material.needsUpdate = true;
  }

  // build a few lines per call so loading stays smooth
  async build() {
    const geos = [];
    for (const line of this.lines) {
      geos.push(this.ribbon(line));
      await new Promise((r) => setTimeout(r));
    }
    const merged = mergeRibbons(geos.filter(Boolean));
    this.mesh = new THREE.Mesh(merged, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
    this.ready = true;
  }

  ribbon(line) {
    const p = line.points;
    const n = p.length / 2;
    if (n < 2) return null;
    const w = line.width;
    const pos = [], dir = [], flow = [], idx = [];
    let along = 0;
    const gh = (x, z) => this.world.groundHeight(x, z, this.world.groundOnly, 6000);
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1];
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = p[b * 2] - p[a * 2], tz = p[b * 2 + 1] - p[a * 2 + 1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) along += Math.hypot(x - p[i * 2 - 2], z - p[i * 2 - 1]);
      const nx = -tz * w * 0.5, nz = tx * w * 0.5;   // left of the flow
      const yc = gh(x, z);
      if (yc === null) continue;
      const yl = gh(x + nx, z + nz) ?? yc, yr = gh(x - nx, z - nz) ?? yc;
      // the DEM has no channel: sit just above the ground, never float over a bank
      const y = Math.min(yc, yl, yr) + 0.25;
      pos.push(x + nx, Math.max(y, yl + 0.1), z + nz, x - nx, Math.max(y, yr + 0.1), z - nz);
      dir.push(tx, tz, tx, tz);
      flow.push(0, along, w, 1, along, w);
      const cell = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      if (!this.grid.has(cell)) this.grid.set(cell, []);
      this.grid.get(cell).push(x, yc, z, w);
    }
    const m = pos.length / 6;
    for (let i = 0; i < m - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 3, a + 1, a, a + 2, a + 3);   // counter-clockwise seen from above
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 2));
    g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 3));
    g.setIndex(idx);
    return g;
  }

  // 0..1: how loud the nearest running water should be at p
  proximity(p) {
    if (!this.ready) return 0;
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    let best = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const pts = this.grid.get(`${cx + dx},${cz + dz}`);
        if (!pts) continue;
        for (let i = 0; i < pts.length; i += 4) {
          const d = Math.hypot(pts[i] - p.x, pts[i + 1] - p.y, pts[i + 2] - p.z);
          const reach = 25 + pts[i + 3] * 4;
          best = Math.max(best, (1 - THREE.MathUtils.smoothstep(d, 4, reach)) * Math.min(1, 0.4 + pts[i + 3] / 16));
        }
      }
    }
    return best;
  }
}

function mergeRibbons(geos) {
  const names = ["position", "normal", "aDir", "aFlow"];
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  const idx = [];
  let offset = 0;
  const arrays = names.map((n) => new Float32Array(total * geos[0].attributes[n].itemSize));
  for (const g of geos) {
    names.forEach((n, k) => arrays[k].set(g.attributes[n].array, offset * g.attributes[n].itemSize));
    for (const i of g.index.array) idx.push(i + offset);
    offset += g.attributes.position.count;
  }
  names.forEach((n, k) => out.setAttribute(n, new THREE.BufferAttribute(arrays[k], geos[0].attributes[n].itemSize)));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
