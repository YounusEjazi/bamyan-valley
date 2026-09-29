// Trees from trees.bin: Lombardy poplars (type 0), willows (1) and fruit trees (2).
// Far away they are solid low-poly crowns instanced in 500 m tiles; these also cast the
// (static) sun shadows. Within tier.treeNear of the player the same trees get crowns of
// alpha-tested leaf cards that sway with the wind, flutter and catch the light; the far
// tiles shrink and darken those crowns in their vertex shader into a solid core that the
// cards wrap around (dense foliage without see-through gaps), and keep drawing the trunks.
import * as THREE from "three";
import { withAtmosphere } from "./atmosphere.js";

const TILE = 500;             // far tiles (m)
const CELL = 50;              // grid for the near-tree query (m)
const REFRESH = 12;           // rebuild the near set after moving this far (m)

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ shapes (unit-height tree)
const POPLAR = [[0, 0.1], [0.07, 0.2], [0.085, 0.45], [0.06, 0.75], [0.025, 0.93], [0, 1.0]];
function poplarRadius(y) {
  for (let i = 1; i < POPLAR.length; i++) {
    const [r1, y1] = POPLAR[i], [r0, y0] = POPLAR[i - 1];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
const ROUND = [null, { cy: 0.62, rx: 0.46, ry: 0.33 }, { cy: 0.62, rx: 0.4, ry: 0.32 }];
const CARDS = [{ n: 120, size: 0.075 }, { n: 90, size: 0.22 }, { n: 76, size: 0.2 }];
const CROWN = [[0.06, 0.13, 0.034], [0.1, 0.15, 0.05], [0.085, 0.14, 0.042]].map((c) => new THREE.Color(...c));
const TRUNK = new THREE.Color(0.1, 0.075, 0.055);

// ------------------------------------------------------------------ leaf texture
// A cluster of leaves and twigs on a transparent canvas. Mip levels are made here with the
// alpha boosted, so alpha-tested crowns don't thin out with distance.
function leafTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = mulberry32(11);
  g.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    g.strokeStyle = "rgb(62,50,38)";
    g.lineWidth = 2 + rnd() * 3;
    g.beginPath();
    g.moveTo(S / 2 + (rnd() - 0.5) * 60, S / 2 + (rnd() - 0.5) * 60);
    g.quadraticCurveTo(S / 2 + Math.cos(a + 0.4) * S * 0.2, S / 2 + Math.sin(a + 0.4) * S * 0.2,
      S / 2 + Math.cos(a) * S * 0.44, S / 2 + Math.sin(a) * S * 0.44);
    g.stroke();
  }
  // pointed leaves, darker and more crowded toward the middle of the cluster
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.6);
    const r = rr * S * 0.45;
    const len = 26 + rnd() * 20, wid = len * (0.42 + rnd() * 0.2);
    const hue = 78 + rnd() * 30, sat = 38 + rnd() * 28, light = 16 + rnd() * 16 + rr * 12;
    g.save();
    g.translate(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
    g.rotate(a + Math.PI / 2 + (rnd() - 0.5) * 1.8);
    const grad = g.createLinearGradient(-wid / 2, 0, wid / 2, 0);
    grad.addColorStop(0, `hsl(${hue},${sat}%,${light * 0.8}%)`);
    grad.addColorStop(1, `hsl(${hue - 6},${sat + 6}%,${light * 1.25}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, len / 2);
    g.quadraticCurveTo(wid * 0.75, 0, 0, -len / 2);
    g.quadraticCurveTo(-wid * 0.75, 0, 0, len / 2);
    g.fill();
    g.strokeStyle = `hsla(${hue},30%,${light * 1.6}%,0.5)`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, len / 2);
    g.lineTo(0, -len / 2);
    g.stroke();
    g.restore();
  }
  // mean colour (linear) of the leaves, to match the solid far crowns
  const px = g.getImageData(0, 0, S, S).data;
  const mean = new THREE.Color(0, 0, 0);
  const tmp = new THREE.Color();
  let n = 0;
  for (let i = 0; i < px.length; i += 16) {
    if (px[i + 3] < 128) continue;
    tmp.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace);
    mean.r += tmp.r;
    mean.g += tmp.g;
    mean.b += tmp.b;
    n++;
  }
  mean.multiplyScalar(1 / Math.max(n, 1));
  const mips = [c];
  for (let s = S / 2, level = 1; s >= 1; s /= 2, level++) {
    const m = document.createElement("canvas");
    m.width = m.height = s;
    const mg = m.getContext("2d", { willReadFrequently: true });
    mg.drawImage(mips[level - 1], 0, 0, s, s);
    const d = mg.getImageData(0, 0, s, s);
    const boost = 1 + 0.4 * level;
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = Math.min(255, d.data[i] * boost);
    mg.putImageData(d, 0, 0);
    mips.push(m);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, mean };
}

// ------------------------------------------------------------------ geometry helpers
class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.uv = [];
    this.extra = [];   // aCrown (far) or aLeaf phase (near)
    this.index = [];
  }

  vertex(p, n, c, uv, extra) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(uv[0], uv[1]);
    this.extra.push(extra);
    return this.pos.length / 3 - 1;
  }

  // append a three geometry; normalFn(p, n) may replace normals, colorFn(p) gives colours
  add(geo, colorFn, extra, normalFn) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, n = g.attributes.normal;
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      w.fromBufferAttribute(n, i);
      if (normalFn) normalFn(v, w);
      this.index.push(this.vertex(v, w, colorFn(v), [0, 0], extra));
    }
  }

  build(extraName) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute(extraName, new THREE.Float32BufferAttribute(this.extra, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

function crownCenter(type, y) {
  return type === 0 ? new THREE.Vector3(0, y, 0) : new THREE.Vector3(0, ROUND[type].cy, 0);
}

// soft "volume" normal: away from the crown axis (poplar) or centre (round crowns)
function volumeNormal(type, p) {
  if (type === 0) return new THREE.Vector3(p.x, (p.y - 0.55) * 0.25, p.z).normalize();
  const r = ROUND[type];
  return new THREE.Vector3(p.x / r.rx, (p.y - r.cy) / r.ry, p.z / r.rx).normalize();
}

// darker inside the crown and at its base
function crownShade(type, p) {
  let radial, vertical;
  if (type === 0) {
    radial = Math.hypot(p.x, p.z) / Math.max(poplarRadius(p.y), 0.01);
    vertical = (p.y - 0.1) / 0.9;
  } else {
    const r = ROUND[type];
    radial = Math.hypot(p.x / r.rx, (p.y - r.cy) / r.ry, p.z / r.rx);
    vertical = (p.y - (r.cy - r.ry)) / (2 * r.ry);
  }
  const s = THREE.MathUtils.smoothstep(radial, 0.25, 1.0);
  return (0.45 + 0.55 * s) * (0.72 + 0.28 * THREE.MathUtils.clamp(vertical, 0, 1));
}

function trunkGeometry(type) {
  return type === 0
    ? new THREE.CylinderGeometry(0.012, 0.02, 0.32, 5).translate(0, 0.16, 0)
    : new THREE.CylinderGeometry(0.028, 0.045, 0.5, 6).translate(0, 0.25, 0);
}

// solid crown + trunk; aCrown = height of the crown centre on crown vertices, 0 on the trunk
function farGeometry(type) {
  const b = new Builder();
  b.add(trunkGeometry(type), () => TRUNK, 0);
  let crown;
  if (type === 0) {
    crown = new THREE.LatheGeometry(POPLAR.map(([r, y]) => new THREE.Vector2(r, y)), 7);
  } else {
    const r = ROUND[type];
    crown = new THREE.IcosahedronGeometry(1, 1).scale(r.rx, r.ry, r.rx).translate(0, r.cy, 0);
  }
  const col = CROWN[type];
  b.add(crown, (p) => col.clone().multiplyScalar(0.55 + 0.6 * crownShade(type, p)), type === 0 ? 0.55 : ROUND[type].cy,
    (p, n) => n.copy(volumeNormal(type, p)));
  return b.build("aCrown");
}

// leaf cards; aLeaf = random phase per card (flutter / shimmer)
function nearGeometry(type, leafMean) {
  const b = new Builder();
  const rnd = mulberry32(100 + type);
  const { n, size } = CARDS[type];
  // vertex colour x leaf texture averages to the solid far crown's colour
  const col = new THREE.Color(CROWN[type].r / leafMean.r, CROWN[type].g / leafMean.g, CROWN[type].b / leafMean.b).multiplyScalar(1.15);
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
  const rand = new THREE.Vector3(), t = new THREE.Vector3(), bt = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const c = new THREE.Vector3();
    if (type === 0) {
      let y;
      do { y = 0.14 + rnd() * 0.84; } while (rnd() > (poplarRadius(y) / 0.085) ** 1.5);
      const a = rnd() * Math.PI * 2, r = poplarRadius(y) * (0.5 + 0.45 * Math.sqrt(rnd()));
      c.set(Math.cos(a) * r, y, Math.sin(a) * r);
    } else {
      const r = ROUND[type];
      rand.randomDirection();
      const f = 0.5 + 0.42 * Math.sqrt(rnd());
      c.set(rand.x * r.rx * f, r.cy + rand.y * r.ry * f, rand.z * r.rx * f);
    }
    const out = volumeNormal(type, c);
    const normal = out.clone().lerp(rand.randomDirection(), 0.55).normalize();
    t.crossVectors(Math.abs(normal.y) < 0.9 ? up : side, normal).normalize();
    bt.crossVectors(normal, t);
    const rot = rnd() * Math.PI * 2, cs = Math.cos(rot), sn = Math.sin(rot);
    const T = t.clone().multiplyScalar(cs).addScaledVector(bt, sn);
    const B = bt.clone().multiplyScalar(cs).addScaledVector(t, -sn);
    const s = size * (0.75 + rnd() * 0.5) * 0.5;
    const phase = rnd();
    const tint = 0.85 + rnd() * 0.3;
    const idx = [];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = c.clone().addScaledVector(T, (u * 2 - 1) * s).addScaledVector(B, (v * 2 - 1) * s);
      const nv = normal.clone().lerp(volumeNormal(type, p), 0.75).normalize();
      idx.push(b.vertex(p, nv, col.clone().multiplyScalar(crownShade(type, p) * tint), [u, v], phase));
    }
    b.index.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
  }
  return b.build("aLeaf");
}

// ------------------------------------------------------------------ materials
const SWAY_GLSL = /* glsl */ `
uniform float uTime, uWind;
uniform vec2 uWindDir;
// world-space sway of a tree at ip (base) with height h, at unit height y
vec2 treeSway( vec3 ip, float y, float h ) {
  float ph = dot( ip.xz, vec2( 0.071, 0.053 ) );
  float gust = sin( dot( ip.xz, uWindDir ) * 0.018 - uTime * 1.1 ) * 0.5 + 0.5;
  float s = ( 0.3 + 0.7 * gust ) * uWind * ( sin( uTime * 1.3 + ph ) * 0.45 + 0.65 ) + sin( uTime * 2.9 + ph * 3.1 ) * 0.1;
  return uWindDir * s * y * y * h * 0.02;
}`;

function swayProject(extra = "") {
  return /* glsl */ `
    vec4 mvPosition = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      vec3 ip = instanceMatrix[3].xyz;
      float th = length( instanceMatrix[1].xyz );
      mvPosition.xz += treeSway( ip, max( position.y, 0.0 ), th );
      ${extra}
    #endif
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;`;
}

function farMaterial(near) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  return withAtmosphere(mat, "bamyan-trees-far", (shader) => {
    Object.assign(shader.uniforms, near);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute float aCrown;
uniform vec3 uNearCenter;
uniform float uNearR;
varying float vCore;
${SWAY_GLSL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vCore = 0.0;
        #ifdef USE_INSTANCING
          // near trees get leaf cards: the solid crown shrinks into a dark core inside them
          if ( aCrown > 0.0 && distance( instanceMatrix[3].xyz, uNearCenter ) < uNearR ) {
            vec3 cc = vec3( 0.0, aCrown, 0.0 );
            transformed = cc + ( transformed - cc ) * vec3( 0.64, 0.84, 0.64 );
            vCore = 1.0;
          }
        #endif`)
      .replace("#include <project_vertex>", swayProject());
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCore;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= 1.0 - 0.42 * vCore;");
  });
}

function leafMaterial(tex, msaa) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, vertexColors: true, roughness: 0.72, metalness: 0,
    side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: msaa > 0,
  });
  return withAtmosphere(mat, "bamyan-trees-near", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute float aLeaf;
varying float vShimmer;
${SWAY_GLSL}`)
      .replace("#include <project_vertex>", swayProject(`
        // leaves flutter; poplar leaves flip and flash in the sun
        float fl = sin( uTime * ( 9.0 + aLeaf * 5.0 ) + aLeaf * 40.0 + ip.x ) * ( 0.35 + 0.65 * uWind );
        mvPosition.xyz += vec3( uWindDir.x, 0.7, uWindDir.y ) * fl * 0.045;
        vShimmer = sin( uTime * ( 6.0 + aLeaf * 7.0 ) + aLeaf * 61.0 + ip.z ) * uWind;`));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vShimmer;")
      // cards are lit by their soft crown normal from both sides
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize( vNormal );")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= 0.92 + 0.14 * vShimmer;")
      // sunlight shining through the leaves toward the viewer
      .replace("#include <opaque_fragment>", `
        vec3 viewToFrag = normalize( vFogWorldPos - cameraPosition );
        float through = pow( max( dot( viewToFrag, uSunDir ), 0.0 ), 5.0 ) * smoothstep( 0.0, 0.15, uSunDir.y );
        outgoingLight += diffuseColor.rgb * vec3( 0.9, 1.0, 0.55 ) * uSunColor * through * 0.9 * atmoCloudShadow( vFogWorldPos );
        #include <opaque_fragment>`);
  });
}

// ------------------------------------------------------------------ trees
export class Trees {
  // records: Float32Array of (x, y_north, height, type) in local metres
  constructor(records, groundHeight, tier) {
    this.tier = tier;
    this.group = new THREE.Group();
    this.group.name = "Trees";
    this.near = { uNearCenter: { value: new THREE.Vector3(1e9, 0, 0) }, uNearR: { value: tier.treeNear } };
    this.center = new THREE.Vector3(1e9, 0, 0);

    // per-tree matrix, tint and type
    const n = records.length / 4;
    this.matrices = new Float32Array(n * 16);
    this.tints = new Float32Array(n * 3);
    this.types = new Uint8Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const rnd = mulberry32(3);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = records[i * 4], z = -records[i * 4 + 1], h = records[i * 4 + 2], type = records[i * 4 + 3];
      const y = groundHeight(x, z);
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd();
      if (y === null) continue;
      const w = type === 0 ? h * (0.9 + 0.3 * r1) : h;
      q.setFromAxisAngle(up, r2 * Math.PI * 2);
      m.compose(p.set(x, y - 0.3, z), q, s.set(w, h, w)).toArray(this.matrices, k * 16);
      this.tints.set([0.85 + r3 * 0.3, 0.85 + r4 * 0.3, 0.8 + r5 * 0.25], k * 3);
      this.types[k] = type;
      this.px[k] = x;
      this.py[k] = y;
      this.pz[k] = z;
      k++;
    }
    this.count = k;

    // far tiles
    const farMat = farMaterial(this.near);
    const farGeos = [0, 1, 2].map(farGeometry);
    const tiles = new Map();
    for (let i = 0; i < k; i++) {
      const key = `${Math.floor(this.px[i] / TILE)},${Math.floor(this.pz[i] / TILE)},${this.types[i]}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(i);
    }
    this.tiles = [];
    for (const [key, idx] of tiles) {
      const type = +key.split(",")[2];
      const mesh = new THREE.InstancedMesh(farGeos[type], farMat, idx.length);
      this.fill(mesh, idx);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.userData.center = mesh.boundingSphere.center.clone();
      this.tiles.push(mesh);
      this.group.add(mesh);
    }

    // grid for the near query
    this.grid = new Map();
    for (let i = 0; i < k; i++) {
      const key = `${Math.floor(this.px[i] / CELL)},${Math.floor(this.pz[i] / CELL)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }

    // near leaf-card meshes, one per type, refilled as the player moves
    const leaf = leafTexture();
    const leafMat = leafMaterial(leaf.tex, tier.msaa);
    this.nearMeshes = [0, 1, 2].map((type) => {
      const mesh = new THREE.InstancedMesh(nearGeometry(type, leaf.mean), leafMat, 1500);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    });
    this.lists = [[], [], []];
  }

  fill(mesh, idx) {
    const ma = mesh.instanceMatrix.array;
    if (!mesh.instanceColor) mesh.setColorAt(0, new THREE.Color());
    const ca = mesh.instanceColor.array;
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j];
      for (let e = 0; e < 16; e++) ma[j * 16 + e] = this.matrices[i * 16 + e];
      ca[j * 3] = this.tints[i * 3];
      ca[j * 3 + 1] = this.tints[i * 3 + 1];
      ca[j * 3 + 2] = this.tints[i * 3 + 2];
    }
    mesh.count = idx.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // leaf-card trees around the camera; far tiles by draw distance
  update(cam, force = false) {
    for (const t of this.tiles) t.visible = t.userData.center.distanceTo(cam) < this.tier.treeFar;
    if (!force && this.center.distanceToSquared(cam) < REFRESH * REFRESH) return;
    this.center.copy(cam);
    this.near.uNearCenter.value.copy(cam);
    const R = this.tier.treeNear, R2 = R * R;
    for (const l of this.lists) l.length = 0;
    const x0 = Math.floor((cam.x - R) / CELL), x1 = Math.floor((cam.x + R) / CELL);
    const z0 = Math.floor((cam.z - R) / CELL), z1 = Math.floor((cam.z + R) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.grid.get(`${cx},${cz}`);
        if (!cell) continue;
        for (const i of cell) {
          const dx = this.px[i] - cam.x, dy = this.py[i] - 0.3 - cam.y, dz = this.pz[i] - cam.z;
          if (dx * dx + dy * dy + dz * dz < R2) this.lists[this.types[i]].push(i);
        }
      }
    }
    this.nearMeshes.forEach((mesh, type) => {
      const list = this.lists[type];
      if (list.length > mesh.instanceMatrix.count) {
        const bigger = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.ceil(list.length * 1.5));
        bigger.frustumCulled = false;
        bigger.receiveShadow = true;
        bigger.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.remove(mesh);
        mesh.dispose();
        this.group.add(bigger);
        this.nearMeshes[type] = mesh = bigger;
      }
      this.fill(mesh, list);
    });
  }

  get nearCount() {
    return this.nearMeshes.reduce((s, m) => s + m.count, 0);
  }
}
