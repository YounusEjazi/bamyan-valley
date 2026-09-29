// Loads the valley: terrain, cliff and buildings (GLB from blender/export_glb.py), the
// Sentinel-2 + OSM ground textures, the photo-scanned detail maps and the trees; builds
// BVHs for collision/raycasts.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { groundMaterial, buildingMaterial, loadDetailTextures } from "./materials.js";
import { Trees } from "./trees.js";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const BASE = "./";

// Per-vertex (base height, roof height, random seed) of the building each vertex belongs
// to: vertices are welded by position and triangles joined into buildings (union-find).
// The building shader places floors, windows and doors with it.
function buildingAttributes(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const n = pos.count;
  const v = new THREE.Vector3();
  const wy = new Float32Array(n), wx = new Float32Array(n), wz = new Float32Array(n);
  const weld = new Map();
  const rep = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    wx[i] = v.x;
    wy[i] = v.y;
    wz[i] = v.z;
    const k = `${Math.round(v.x * 10)},${Math.round(v.y * 10)},${Math.round(v.z * 10)}`;
    const r = weld.get(k);
    if (r === undefined) weld.set(k, (rep[i] = i));
    else rep[i] = r;
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const idx = geo.index ? geo.index.array : Int32Array.from({ length: n }, (_, i) => i);
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(rep[idx[t]]), b = find(rep[idx[t + 1]]), c = find(rep[idx[t + 2]]);
    parent[a] = b;
    parent[find(c)] = find(b);
  }
  const lo = new Map(), hi = new Map(), cx = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(rep[i]);
    lo.set(r, Math.min(lo.get(r) ?? Infinity, wy[i]));
    hi.set(r, Math.max(hi.get(r) ?? -Infinity, wy[i]));
    if (!cx.has(r)) cx.set(r, Math.abs(Math.sin(wx[i] * 12.9898 + wz[i] * 78.233) * 43758.5453) % 1);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = find(rep[i]);
    out[i * 3] = lo.get(r);
    out[i * 3 + 1] = hi.get(r);
    out[i * 3 + 2] = cx.get(r);
  }
  geo.setAttribute("aBld", new THREE.BufferAttribute(out, 3));
}

export async function loadWorld(renderer, tier, onStatus) {
  const manager = new THREE.LoadingManager();
  const draco = new DRACOLoader(manager).setDecoderPath(`${BASE}draco/`);
  const gltf = new GLTFLoader(manager).setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader(manager);
  const json = (f) => fetch(`${BASE}${f}`).then((r) => r.json());

  onStatus("Loading map data…", 0.05);
  const [config, ground, pois, detailMeta, treeBuf] = await Promise.all([
    json("models/views.json"), json("models/ground.json"), json("models/pois.json"), json("textures/detail.json"),
    fetch(`${BASE}models/trees.bin`).then((r) => r.arrayBuffer()),
  ]);

  const loadTex = (file) => texLoader.loadAsync(`${BASE}${file}`).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
  onStatus("Loading terrain, cliff and town…", 0.15);
  let done = 0;
  const tick = (label) => (x) => { done++; onStatus(`Loaded ${label}`, 0.15 + 0.55 * done / 6); return x; };
  const [terrainG, cliffG, buildingsG, valleyTex, coreTex, detail] = await Promise.all([
    gltf.loadAsync(`${BASE}models/terrain.glb`).then(tick("terrain")),
    gltf.loadAsync(`${BASE}models/cliff.glb`).then(tick("cliff")),
    gltf.loadAsync(`${BASE}models/buildings.glb`).then(tick("buildings")),
    loadTex(ground.valley.file).then(tick("satellite image")),
    loadTex(ground.core.file).then(tick("fields and roads")),
    loadDetailTextures(texLoader, renderer, detailMeta).then(tick("rock and soil")),
  ]);
  draco.dispose();

  onStatus("Building collision data…", 0.75);
  await new Promise((r) => setTimeout(r));
  const gmat = groundMaterial(ground, { valley: valleyTex, core: coreTex }, detail, tier);
  const bmat = buildingMaterial(detail, tier);
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
  for (const m of buildings) buildingAttributes(m);

  // raycast helpers
  const solids = [...terrain, ...cliff, ...buildings];
  const groundOnly = [...terrain, ...cliff];
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const DOWN = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const groundHeight = (x, z, targets = groundOnly, fromY = 8000) => {
    ray.set(origin.set(x, fromY, z), DOWN);
    ray.far = Infinity;
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.point.y : null;
  };

  onStatus("Planting trees…", 0.85);
  await new Promise((r) => setTimeout(r));
  const trees = new Trees(new Float32Array(treeBuf), (x, z) => groundHeight(x, z, terrain), tier);
  root.add(trees.group);

  for (const p of pois) {
    const [x, z] = p.position;
    p.y = groundHeight(x, z, solids) ?? 2520;
  }

  return {
    root, config, ground, pois, solids, groundOnly, groundHeight, trees,
    buildingTiles: buildings,
    textures: { valley: valleyTex, core: coreTex },
    stats: { trees: trees.count, buildings: buildings.length },
  };
}

// trees: leaf cards near the camera, far tiles by distance; far building tiles hidden (fog hides the pop)
export function cullByDistance(world, cam, tier) {
  world.trees.update(cam);
  for (const b of world.buildingTiles) b.visible = b.userData.center.distanceTo(cam) < tier.buildingFar;
}
