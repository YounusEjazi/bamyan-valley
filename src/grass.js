// Grass and crop tufts around the player, only where the satellite ground texture is green,
// tinted with the ground colour under them. Chunks of CHUNK m are created lazily within the
// tier's radius and dropped behind; tufts shrink away toward the edge of the radius and
// bend under gusts that roll across the fields.
import * as THREE from "three";
import { withAtmosphere } from "./atmosphere.js";

const CHUNK = 32;
const MAX_PER_CHUNK = 2200;
const FRESH = new THREE.Color(0.085, 0.16, 0.032);   // summer crops / meadow (linear)

function tuftGeometry() {
  // eleven thin, curved, tapering blades per tuft (unit height), base at y = 0
  const pos = [], col = [], idx = [];
  const blades = 11;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < blades; i++) {
    const a = rnd() * Math.PI * 2;
    const spread = 0.02 + 0.13 * Math.sqrt(rnd());
    const ox = Math.cos(a) * spread, oz = Math.sin(a) * spread;      // blades spread around the tuft
    const w = 0.011 + 0.008 * rnd();                                   // half blade width at the base
    const dx = -Math.sin(a) * w, dz = Math.cos(a) * w;
    const lean = 0.2 + 0.5 * rnd();
    const h = 0.55 + 0.45 * rnd();
    const bend = (y) => 1 + lean * y * y * 4;                         // blades curve outward
    const v = [
      [ox - dx, 0, oz - dz], [ox + dx, 0, oz + dz],
      [ox * bend(0.55) - dx * 0.6, 0.55 * h, oz * bend(0.55) - dz * 0.6],
      [ox * bend(0.55) + dx * 0.6, 0.55 * h, oz * bend(0.55) + dz * 0.6],
      [ox * bend(1), h, oz * bend(1)],
    ];
    const base = pos.length / 3;
    const tone = 0.8 + 0.4 * rnd();
    for (const [x, y, z] of v) {
      pos.push(x, y, z);
      const s = (0.3 + 0.8 * y) * tone;    // dark at the root, light at the tip
      col.push(s, s, s * (0.9 + 0.2 * y));
    }
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  // blades are lit from above, not edge-on
  g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, world, coreTexture, coreBounds, tier) {
    this.scene = scene;
    this.world = world;
    this.radius = tier.grassRadius;
    this.density = tier.grassDensity;
    this.chunks = new Map();
    this.geo = tuftGeometry();
    this.uniforms = { uGrassR: { value: this.radius } };
    this.material = withAtmosphere(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }),
      "bamyan-grass",
      (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime, uWind, uGrassR;\nuniform vec2 uWindDir;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 ip = instanceMatrix[3].xyz;
              // shrink away toward the edge of the grass radius (no popping)
              float fade = 1.0 - smoothstep( uGrassR * 0.6, uGrassR, distance( ip.xz, cameraPosition.xz ) );
              transformed.y *= fade;
              // gusts rolling across the field + a little flutter
              float wave = sin( dot( ip.xz, uWindDir ) * 0.11 - uTime * 1.7 ) * 0.5 + 0.5;
              float sway = ( 0.08 + 0.32 * wave * wave ) * uWind + sin( uTime * 3.3 + ip.x * 1.7 + ip.z ) * 0.05;
              float k = position.y * position.y;
              transformed.xz += uWindDir * sway * k;
              transformed.y -= sway * sway * k * 0.35;
            #endif`);
      },
    );
    // ground colour / vegetation mask: the core texture at 4 m pixels, read on the CPU
    const img = coreTexture.image;
    const w = Math.round(img.width / 2), h = Math.round(img.height / 2);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    this.mask = { data: ctx.getImageData(0, 0, w, h).data, w, h, b: coreBounds };
    this.tint = new THREE.Color();
  }

  // greenness 0..1 at (x, z) and the ground colour (linear) in this.tint
  sample(x, z) {
    // x east, z = -north (three coords) -> texture pixel
    const { data, w, h, b } = this.mask;
    const u = (x - b[0]) / (b[2] - b[0]);
    const v = (b[3] - -z) / (b[3] - b[1]);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
    const i = ((Math.floor(v * h) * w) + Math.floor(u * w)) * 4;
    const r = data[i], g = data[i + 1], bl = data[i + 2];
    this.tint.setRGB(r / 255, g / 255, bl / 255, THREE.SRGBColorSpace);
    return THREE.MathUtils.clamp((g - Math.max(r, bl) * 0.97) / 18, 0, 1);
  }

  makeChunk(cx, cz) {
    const max = Math.round(MAX_PER_CHUNK * this.density);
    const mesh = new THREE.InstancedMesh(this.geo, this.material, max);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    let k = 0;
    // stable pseudo-random per chunk so revisited chunks look the same
    let seed = (cx * 73856093) ^ (cz * 19349663);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < max * 2 && k < max; i++) {
      const x = cx * CHUNK + rnd() * CHUNK, z = cz * CHUNK + rnd() * CHUNK;
      const g = this.sample(x, z);
      if (g <= 0 || rnd() > g) continue;
      const y = this.world.groundHeight(x, z, this.world.groundOnly, 6000);
      if (y === null) continue;
      const hgt = 0.22 + rnd() * 0.45 * (0.5 + g);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const wdt = 0.9 + rnd() * 0.8;
      m.compose(p.set(x, y - 0.04, z), q, s.set(wdt, hgt, wdt));
      mesh.setMatrixAt(k, m);
      // the ground colour, lifted and pulled toward fresh green, with some variation
      tint.copy(this.tint).multiplyScalar(1.6).lerp(FRESH, 0.35 + 0.4 * g).multiplyScalar(0.85 + rnd() * 0.5);
      tint.r *= 0.9 + rnd() * 0.3;
      mesh.setColorAt(k, tint);
      k++;
    }
    mesh.count = k;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  update(dt, pos) {
    const pcx = Math.floor(pos.x / CHUNK), pcz = Math.floor(pos.z / CHUNK);
    const r = Math.ceil(this.radius / CHUNK);
    const wanted = new Set();
    let built = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const d = Math.hypot((cx + 0.5) * CHUNK - pos.x, (cz + 0.5) * CHUNK - pos.z);
        if (d > this.radius + CHUNK * 0.7) continue;
        const key = `${cx},${cz}`;
        wanted.add(key);
        if (!this.chunks.has(key) && built < 2) {  // spread chunk creation over frames
          const mesh = this.makeChunk(cx, cz);
          this.scene.add(mesh);
          this.chunks.set(key, mesh);
          built++;
        }
      }
    }
    for (const [key, mesh] of this.chunks) {
      if (!wanted.has(key)) {
        this.scene.remove(mesh);
        mesh.dispose();
        this.chunks.delete(key);
      }
    }
  }

  setVisible(v) {
    for (const mesh of this.chunks.values()) mesh.visible = v;
  }
}
