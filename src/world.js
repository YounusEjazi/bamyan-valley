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
