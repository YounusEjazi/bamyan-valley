// Grass and crop tufts around the player, only where the satellite ground texture is green.
// Chunks of CHUNK m are created lazily within RADIUS of the player and dropped behind.
import * as THREE from "three";

const CHUNK = 32;
const RADIUS = 110;
const MAX_PER_CHUNK = 1400;

function tuftGeometry() {
  // three crossed, slightly bent blades per tuft (unit height), base at y = 0
  const pos = [], col = [];
  const base = new THREE.Color(0.05, 0.09, 0.025), tip = new THREE.Color(0.16, 0.2, 0.06);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const ox = Math.cos(a) * 0.06, oz = Math.sin(a) * 0.06;         // blades spread around the tuft
    const dx = -Math.sin(a) * 0.025, dz = Math.cos(a) * 0.025;       // half blade width
    const lean = 0.25;
    // one narrow tapering triangle per blade
    const v = [[ox - dx, 0, oz - dz], [ox + dx, 0, oz + dz], [ox * (1 + lean * 6), 1, oz * (1 + lean * 6)]];
    for (const [x, y, z] of v) {
      pos.push(x, y, z);
      const c = base.clone().lerp(tip, y);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // blades are lit from above, not edge-on
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

export class Grass {
  constructor(scene, world, coreTexture, coreBounds) {
    this.scene = scene;
    this.world = world;
    this.chunks = new Map();
    this.geo = tuftGeometry();
    this.time = { value: 0 };
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float sway = sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.27) * 0.12 + sin(uTime * 3.1 + ip.x) * 0.04;
            transformed.x += sway * position.y * position.y;
            transformed.z += sway * 0.6 * position.y * position.y;
          #endif`);
    };
    // vegetation mask: downsample the core texture to 4 m pixels and read it on the CPU
    const img = coreTexture.image;
    const w = Math.round(img.width / 2), h = Math.round(img.height / 2);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    this.mask = { data: ctx.getImageData(0, 0, w, h).data, w, h, b: coreBounds };
  }

  greenness(x, z) {
    // x east, z = -north (three coords) -> texture pixel
    const { data, w, h, b } = this.mask;
    const u = (x - b[0]) / (b[2] - b[0]);
    const v = (b[3] - -z) / (b[3] - b[1]);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
    const i = ((Math.floor(v * h) * w) + Math.floor(u * w)) * 4;
    const r = data[i], g = data[i + 1], bl = data[i + 2];
    return THREE.MathUtils.clamp((g - Math.max(r, bl) * 0.97) / 18, 0, 1);
  }

  makeChunk(cx, cz) {
    const mesh = new THREE.InstancedMesh(this.geo, this.material, MAX_PER_CHUNK);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    let k = 0;
    // stable pseudo-random per chunk so revisited chunks look the same
    let seed = (cx * 73856093) ^ (cz * 19349663);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < MAX_PER_CHUNK * 2 && k < MAX_PER_CHUNK; i++) {
      const x = cx * CHUNK + rnd() * CHUNK, z = cz * CHUNK + rnd() * CHUNK;
      const g = this.greenness(x, z);
      if (g <= 0 || rnd() > g) continue;
      const y = this.world.groundHeight(x, z, this.world.groundOnly, 6000);
      if (y === null) continue;
      const hgt = 0.25 + rnd() * 0.5 * (0.5 + g);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const wdt = 0.8 + rnd() * 0.6;
      m.compose(p.set(x, y - 0.05, z), q, s.set(wdt, hgt, wdt));
      mesh.setMatrixAt(k, m);
      tint.setRGB(0.8 + rnd() * 0.45, 0.85 + rnd() * 0.35, 0.7 + rnd() * 0.3);
      mesh.setColorAt(k, tint);
      k++;
    }
    mesh.count = k;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  update(dt, pos) {
    this.time.value += dt;
    const pcx = Math.floor(pos.x / CHUNK), pcz = Math.floor(pos.z / CHUNK);
    const r = Math.ceil(RADIUS / CHUNK);
    const wanted = new Set();
    let built = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const d = Math.hypot((cx + 0.5) * CHUNK - pos.x, (cz + 0.5) * CHUNK - pos.z);
        if (d > RADIUS) continue;
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
