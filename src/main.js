// Bamyan valley explorer. World: terrain + Buddha cliff + OSM town + trees (see world.js),
// first-person walk/fly (player.js), discoverable places (discovery.js).
// Coordinates: 1 unit = 1 m, Y up, X east, -Z north, Y = elevation; origin = big Buddha niche.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { loadWorld, cullByDistance } from "./world.js";
import { Player } from "./player.js";
import { Discovery } from "./discovery.js";
import { Grass } from "./grass.js";

const SUN_INTENSITY = 3.2;
const ENV_INTENSITY = 0.08;       // the Sky shader is very bright; more washes the colours out
const FOG_DENSITY = 4.5e-5;       // exp2 haze: ~18% at 10 km, ~55% at 20 km
const SHADOW_HALF = 400;          // m around the player covered by sun shadows
const SHADOW_RECENTER = 60;       // re-render shadows after moving this far

// ------------------------------------------------------------------ renderer, scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const container = document.getElementById("app");
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 600000);

const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(50);
envScene.add(envSky);
for (const s of [sky, envSky]) {
  const u = s.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
}
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget = null;
scene.environmentIntensity = ENV_INTENSITY;

const sun = new THREE.DirectionalLight(0xfff0dd, SUN_INTENSITY);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, {
  left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 10, far: 8000,
});
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const sunState = { az: 215, el: 55, dir: new THREE.Vector3() };
const shadowCenter = new THREE.Vector3(1e9, 0, 0);

function sunDirection(azDeg, elDeg) {
  // Blender (east, north, up) -> three (x, y, z) = (east, up, -north)
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function setSun(az, el) {
  sunState.az = az;
  sunState.el = el;
  sunState.dir.copy(sunDirection(az, el));
  for (const s of [sky, envSky]) s.material.uniforms.sunPosition.value.copy(sunState.dir);
  const low = THREE.MathUtils.smoothstep(el, 5, 35);
  sun.color.setRGB(1.0, 0.78 + 0.16 * low, 0.6 + 0.3 * low);
  sun.intensity = SUN_INTENSITY * (0.55 + 0.45 * low);
  if (envTarget) envTarget.dispose();
  envTarget = pmrem.fromScene(envScene);
  scene.environment = envTarget.texture;
  placeShadow(shadowCenter, true);
  $("sun-az").value = az;
  $("sun-el").value = el;
  $("az-val").textContent = `${Math.round(az)}°`;
  $("el-val").textContent = `${Math.round(el)}°`;
}

function placeShadow(center, force = false) {
  if (!force && center.distanceTo(shadowCenter) < SHADOW_RECENTER) return;
  shadowCenter.copy(center);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunState.dir, 3000);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();

// ------------------------------------------------------------------ UI: toasts, menus
let audio = null;
function chime() {
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    for (const [f, dt] of [[660, 0], [990, 0.12]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.9);
      o.connect(g).connect(audio.destination);
      o.start(t + dt);
      o.stop(t + dt + 1);
    }
  } catch { /* no audio */ }
}

let toastTimer = 0;
const ui = {
  toast(p, n, total) {
    const el = $("toast");
    el.innerHTML = `<div class="kicker">Discovered · ${n} of ${total}</div><h3>${p.title}</h3>
      <div class="sub">${p.subtitle}</div><p>${p.text}</p>`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
    chime();
  },
};

function showSheet(id) {
  for (const s of ["journal", "settings"]) $(s).hidden = s !== id;
  if (document.pointerLockElement) document.exitPointerLock();
}
document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => { $(b.dataset.close).hidden = true; }; });

// ------------------------------------------------------------------ start
let world, player, discovery, grass;

async function init() {
  world = await loadWorld(renderer, (text, f) => {
    $("loading-text").textContent = text;
    $("progress").style.width = `${Math.round(f * 100)}%`;
  });
  scene.add(world.root);
  const hc = world.config.haze.color;
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(hc[0], hc[1], hc[2]), FOG_DENSITY);

  player = new Player(camera, renderer.domElement, world);
  player.onModeChange = (m) => { $("mode").textContent = m === "fly" ? "Fly" : "Walk"; };
  const start = world.config.player_start;
  player.place(new THREE.Vector3(...start.position), new THREE.Vector3(...start.look_at), "walk");

  grass = new Grass(scene, world, world.textures.core, world.ground.core.bounds);
  discovery = new Discovery(scene, world.pois, ui);
  const updateMenuCount = () => { $("menu-found").textContent = `(${discovery.count}/${world.pois.length})`; };
  discovery.onChange = updateMenuCount;
  updateMenuCount();
  $("menu-total").textContent = world.pois.length;

  // journal: fast travel
  $("journal-list").addEventListener("click", (e) => {
    const id = e.target.dataset?.travel;
    if (!id) return;
    const p = world.pois.find((q) => q.id === id);
    const pos = new THREE.Vector3(p.position[0], p.y + 2, p.position[1] + Math.min(p.radius * 0.6, 40));
    player.place(pos, new THREE.Vector3(p.position[0], p.y + 20, p.position[1]), "walk");
    $("journal").hidden = true;
    renderer.domElement.requestPointerLock();
  });
  $("reset-progress").onclick = () => { discovery.reset(); updateMenuCount(); };

  // viewpoints (fly mode)
  const viewsEl = $("views");
  for (const [, v] of Object.entries(world.config.views)) {
    const b = document.createElement("button");
    b.textContent = v.label;
    b.onclick = () => {
      player.place(new THREE.Vector3(...v.position), new THREE.Vector3(...v.target), "fly");
      $("settings").hidden = true;
      renderer.domElement.requestPointerLock();
    };
    viewsEl.appendChild(b);
  }
  const walkHere = document.createElement("button");
  walkHere.textContent = "Back to the Great Buddha (walk)";
  walkHere.onclick = () => {
    player.place(new THREE.Vector3(...start.position), new THREE.Vector3(...start.look_at), "walk");
    $("settings").hidden = true;
    renderer.domElement.requestPointerLock();
  };
  viewsEl.appendChild(walkHere);

  document.querySelectorAll("[data-sun]").forEach((b) => { b.onclick = () => setSun(...world.config.sun[b.dataset.sun]); });
  $("sun-az").oninput = (e) => setSun(+e.target.value, sunState.el);
  $("sun-el").oninput = (e) => setSun(sunState.az, +e.target.value);
  setSun(...world.config.sun.photo);

  // menu / pointer lock
  $("play").onclick = () => renderer.domElement.requestPointerLock();
  $("open-journal").onclick = () => showSheet("journal");
  $("open-settings").onclick = () => showSheet("settings");
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === renderer.domElement;
    player.enabled = locked;
    $("menu").hidden = locked;
    if (locked) { $("journal").hidden = true; $("settings").hidden = true; }
    $("play").textContent = "Continue exploring";
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyJ") {
      if ($("journal").hidden) showSheet("journal");
      else $("journal").hidden = true;
    }
  });

  if (import.meta.env.DEV) window.bamyan = { scene, camera, world, player, discovery, grass, renderer, setSun };
  $("hud").hidden = false;
  $("menu").hidden = false;
  $("loading").classList.add("done");
  console.info(`world ready: ${world.stats.trees} trees, ${world.stats.buildings} building tiles`);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let lastCull = 0;
renderer.setAnimationLoop((now) => {
  const dt = (now - last) / 1000;
  last = now;
  if (player) {
    player.update(dt);
    discovery.update(now, player.feet, player.heading());
    // grass only near the ground (walking or low flight)
    const g = world.groundHeight(player.feet.x, player.feet.z, world.groundOnly, player.feet.y + 400);
    const low = g !== null && player.feet.y - g < 120;
    if (low) grass.update(dt, player.feet);
    grass.setVisible(low);
    placeShadow(player.feet);
    if (now - lastCull > 250) {
      cullByDistance(world, camera.position);
      lastCull = now;
    }
  }
  renderer.render(scene, camera);
});

init().catch((err) => {
  console.error(err);
  $("loading-text").textContent = `Failed to load: ${err.message}`;
});
