// Loads the valley: terrain, cliff and buildings (GLB from blender/export_glb.py), the
// Sentinel-2 + OSM ground textures and the trees; builds BVHs for collision/raycasts.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const BASE = "./";
const TREE_TILE = 500;          // m
export const TREE_DRAW_DISTANCE = 3500;
export const BUILDING_DRAW_DISTANCE = 7000;

const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}`;

// ------------------------------------------------------------------ ground material
// Vertex colour alpha 0 = ground (use the satellite/OSM textures), 1 = own colour (cliff rock).
function groundMaterial(ground, textures) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const vb = ground.valley.bounds;
  const cb = ground.core.bounds;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uValley: { value: textures.valley },
      uCore: { value: textures.core },
      uValleyB: { value: new THREE.Vector4(...vb) },
      uCoreB: { value: new THREE.Vector4(...cb) },
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWorldPos;
uniform sampler2D uValley, uCore;
uniform vec4 uValleyB, uCoreB;
float insideFade(vec2 p, vec4 b, float f) {
  float d = min(min(p.x - b.x, b.z - p.x), min(p.y - b.y, b.w - p.y));
  return smoothstep(0.0, f, d);
}
vec2 boundsUV(vec2 p, vec4 b) { return (p - b.xy) / (b.zw - b.xy); }
${NOISE_GLSL}`)
      .replace("#include <color_fragment>", `
#if defined( USE_COLOR_ALPHA )
  vec3 vcol = vColor.rgb; float rockMask = vColor.a;
#else
  vec3 vcol = vColor; float rockMask = 1.0;
#endif
  vec2 lp = vec2(vWorldPos.x, -vWorldPos.z);          // local metres, x east, y north
  vec3 ground = vcol;
  float inV = insideFade(lp, uValleyB, 600.0);
  if (inV > 0.0) ground = mix(ground, texture2D(uValley, boundsUV(lp, uValleyB)).rgb, inV);
  float inC = insideFade(lp, uCoreB, 200.0);
  if (inC > 0.0) ground = mix(ground, texture2D(uCore, boundsUV(lp, uCoreB)).rgb, inC);
  // fine detail so magnified texels don't look smeared when walking
  float n = vnoise(lp * 1.7) * 0.45 + vnoise(lp * 0.33) * 0.35 + vnoise(lp * 6.0) * 0.2;
  ground *= 0.7 + 0.6 * n;
  diffuseColor.rgb *= mix(ground, vcol, rockMask);`);
  };
  return mat;
}

// ------------------------------------------------------------------ trees
function treeGeometry(type) {
  // unit-height tree (scaled per instance), vertex colours for trunk / crown
  const parts = [];
  const trunkCol = new THREE.Color(0.1, 0.075, 0.055);
  const crownCol = [new THREE.Color(0.045, 0.1, 0.028), new THREE.Color(0.085, 0.13, 0.045),
    new THREE.Color(0.07, 0.115, 0.035)][type];
  const colorize = (g, c) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  };
  if (type === 0) {
    // Lombardy poplar: slim spindle crown
    const trunk = new THREE.CylinderGeometry(0.012, 0.018, 0.3, 5).translate(0, 0.15, 0);
    const pts = [[0, 0.1], [0.07, 0.2], [0.085, 0.45], [0.06, 0.75], [0.025, 0.93], [0, 1.0]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    parts.push(colorize(trunk, trunkCol), colorize(new THREE.LatheGeometry(pts, 6), crownCol));
  } else {
    const trunk = new THREE.CylinderGeometry(0.03, 0.045, 0.45, 5).translate(0, 0.22, 0);
    const crown = new THREE.IcosahedronGeometry(0.4, 1);
    crown.scale(type === 1 ? 1.15 : 1.0, 0.8, type === 1 ? 1.15 : 1.0).translate(0, 0.62, 0);
    parts.push(colorize(trunk, trunkCol), colorize(crown, crownCol));
  }
  const merged = mergeSimple(parts);
  merged.computeVertexNormals();
  return merged;
}

function mergeSimple(geos) {
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = nonIndexed.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

function buildTrees(records, groundHeight) {
  // records: Float32Array of (x, y_north, height, type)
  const tiles = new Map();
  const n = records.length / 4;
  for (let i = 0; i < n; i++) {
    const x = records[i * 4], z = -records[i * 4 + 1];
    const key = `${Math.floor(x / TREE_TILE)},${Math.floor(z / TREE_TILE)},${records[i * 4 + 3]}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(i);
  }
  const geos = [0, 1, 2].map(treeGeometry);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const group = new THREE.Group();
  group.name = "Trees";
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  let placed = 0;
  for (const [key, idx] of tiles) {
    const type = +key.split(",")[2];
    const mesh = new THREE.InstancedMesh(geos[type], mat, idx.length);
    let k = 0;
    for (const i of idx) {
      const x = records[i * 4], z = -records[i * 4 + 1], h = records[i * 4 + 2];
      const y = groundHeight(x, z);
      if (y === null) continue;
      const w = type === 0 ? h * (0.9 + 0.3 * Math.random()) : h;
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      m.compose(p.set(x, y - 0.3, z), q, s.set(w, h, w));
      mesh.setMatrixAt(k, m);
      tint.setRGB(0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3, 0.8 + Math.random() * 0.25);
      mesh.setColorAt(k, tint);
      k++;
    }
    mesh.count = k;
    placed += k;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.center = mesh.boundingSphere.center.clone();
    group.add(mesh);
  }
  return { group, placed };
}

// ------------------------------------------------------------------ loading
export async function loadWorld(renderer, onStatus) {
  const manager = new THREE.LoadingManager();
  const draco = new DRACOLoader(manager).setDecoderPath(`${BASE}draco/`);
  const gltf = new GLTFLoader(manager).setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader(manager);
  const json = (f) => fetch(`${BASE}models/${f}`).then((r) => r.json());

  onStatus("Loading map data…", 0.05);
  const [config, ground, pois, treeBuf] = await Promise.all([
    json("views.json"), json("ground.json"), json("pois.json"),
    fetch(`${BASE}models/trees.bin`).then((r) => r.arrayBuffer()),
  ]);

  const loadTex = (file) => texLoader.loadAsync(`${BASE}${file}`).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
  onStatus("Loading terrain, cliff and town…", 0.15);
  let done = 0;
  const tick = (label) => (x) => { done++; onStatus(`Loaded ${label}`, 0.15 + 0.55 * done / 5); return x; };
  const [terrainG, cliffG, buildingsG, valleyTex, coreTex] = await Promise.all([
    gltf.loadAsync(`${BASE}models/terrain.glb`).then(tick("terrain")),
    gltf.loadAsync(`${BASE}models/cliff.glb`).then(tick("cliff")),
    gltf.loadAsync(`${BASE}models/buildings.glb`).then(tick("buildings")),
    loadTex(ground.valley.file).then(tick("satellite image")),
    loadTex(ground.core.file).then(tick("fields and roads")),
  ]);

  onStatus("Building collision data…", 0.75);
  await new Promise((r) => setTimeout(r));
  const gmat = groundMaterial(ground, { valley: valleyTex, core: coreTex });
  const bmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  bmat.onBeforeCompile = (shader) => {
    // uneven mud plaster: blotches and vertical rain streaks
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWorldPos;
${NOISE_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 wp = vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y);
        float blot = vnoise(wp * vec2(0.9, 0.9)) * 0.6 + vnoise(wp * 3.1) * 0.4;
        float streak = vnoise(vec2(wp.x * 2.3, wp.y * 0.12));
        diffuseColor.rgb *= 0.78 + 0.3 * blot - 0.08 * streak;`);
  };
  const meshesOf = (root) => { const a = []; root.traverse((o) => o.isMesh && a.push(o)); return a; };

  const terrain = meshesOf(terrainG.scene);
  const cliff = meshesOf(cliffG.scene);
  const buildings = meshesOf(buildingsG.scene);
  for (const m of [...terrain, ...cliff]) {
    m.material = gmat;
    m.receiveShadow = true;
    m.castShadow = true;
  }
  for (const m of buildings) {
    m.material = bmat;
    m.receiveShadow = true;
    m.castShadow = true;
    m.geometry.computeBoundingSphere();
    m.userData.center = m.geometry.boundingSphere.center.clone();
  }
  for (const m of [...terrain, ...cliff, ...buildings]) m.geometry.computeBoundsTree();

  const root = new THREE.Group();
  root.add(terrainG.scene, cliffG.scene, buildingsG.scene);
  root.updateMatrixWorld(true);

  // raycast helpers
  const solids = [...terrain, ...cliff, ...buildings];
  const groundOnly = [...terrain, ...cliff];
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const DOWN = new THREE.Vector3(0, -1, 0);
  const groundHeight = (x, z, targets = groundOnly, fromY = 8000) => {
    ray.set(new THREE.Vector3(x, fromY, z), DOWN);
    ray.far = Infinity;
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.point.y : null;
  };

  onStatus("Planting trees…", 0.85);
  await new Promise((r) => setTimeout(r));
  const trees = buildTrees(new Float32Array(treeBuf), (x, z) => groundHeight(x, z, terrain));
  root.add(trees.group);

  for (const p of pois) {
    const [x, z] = p.position;
    p.y = groundHeight(x, z, solids) ?? 2520;
  }

  return {
    root, config, ground, pois, solids, groundOnly, groundHeight,
    treeTiles: trees.group.children, buildingTiles: buildings,
    textures: { valley: valleyTex, core: coreTex },
    stats: { trees: trees.placed, buildings: buildings.length },
  };
}

// hide far trees / building tiles (fog hides the pop)
export function cullByDistance(world, cam) {
  for (const t of world.treeTiles) t.visible = t.userData.center.distanceTo(cam) < TREE_DRAW_DISTANCE;
  for (const b of world.buildingTiles) b.visible = b.userData.center.distanceTo(cam) < BUILDING_DRAW_DISTANCE;
}
