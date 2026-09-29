// Bamyan valley explorer. World: terrain + Buddha cliff + OSM town + trees (see world.js),
// first-person walk/fly (player.js, touch.js), discoverable places (discovery.js),
// atmosphere and grading (atmosphere.js, post.js), birds (life.js), sound (audio.js).
// Coordinates: 1 unit = 1 m, Y up, X east, -Z north, Y = elevation; origin = big Buddha niche.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { tier, tierName, TIERS, isTouch, saveTier } from "./quality.js";
import { atmo } from "./atmosphere.js";
import { loadWorld, cullByDistance } from "./world.js";
import { Player } from "./player.js";
import { Discovery } from "./discovery.js";
import { Grass } from "./grass.js";
import { Birds } from "./life.js";
import { Water } from "./water.js";
import { Pipeline } from "./post.js";
import { TouchControls } from "./touch.js";
import { Sound } from "./audio.js";

const SUN_INTENSITY = 3.4;
const ENV_INTENSITY = 0.075;      // the Sky shader is very bright; more washes the colours out
const FOG_DENSITY = 3.2e-5;       // haze extinction per metre at the valley floor
const CLOUDS = { coverage: 0.38, density: 0.45, scale: 0.00022, speed: 0.00012 };

// ------------------------------------------------------------------ renderer, scene
const renderer = new THREE.WebGLRenderer({
  antialias: false,               // MSAA happens in the render pipeline's target
  reversedDepthBuffer: true,      // with the float depth target: precise from 0.25 m to 100 km
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxDpr));
renderer.toneMapping = THREE.NeutralToneMapping;   // keeps the satellite / photo colours
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const container = document.getElementById("app");
container.appendChild(renderer.domElement);
const pipeline = new Pipeline(renderer, tier);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.25, 120000);

const sky = new Sky();
sky.scale.setScalar(100000);
sky.material.depthTest = false;   // drawn first, behind everything
sky.material.depthWrite = false;
sky.renderOrder = -1000;
sky.frustumCulled = false;
scene.add(sky);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(50);
envScene.add(envSky);
for (const s of [sky, envSky]) {
  const u = s.material.uniforms;
  u.turbidity.value = 4.5;
  u.rayleigh.value = 1.3;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.cloudCoverage.value = CLOUDS.coverage;
  u.cloudDensity.value = CLOUDS.density;
  u.cloudScale.value = CLOUDS.scale;
  u.cloudSpeed.value = CLOUDS.speed;
}
atmo.uCloudCover.value = CLOUDS.coverage;
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget = null;
scene.environmentIntensity = ENV_INTENSITY;

const sun = new THREE.DirectionalLight(0xfff0dd, SUN_INTENSITY);
sun.castShadow = true;
sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
const SH = tier.shadowHalf;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 8000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35 * (SH / 380) * (4096 / tier.shadowMap);
sun.shadow.radius = 2;
scene.add(sun, sun.target);
// light bounced off the sunlit desert fills the shadows with a warm tone
const bounce = new THREE.HemisphereLight(0xc4ccd2, 0x9c7b58, 0.3);
scene.add(bounce);

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
  const low = THREE.MathUtils.smoothstep(el, 3, 35);
  sun.color.setRGB(1.0, 0.72 + 0.22 * low, 0.5 + 0.4 * low);
  sun.intensity = SUN_INTENSITY * (0.45 + 0.55 * low);
  atmo.uSunDir.value.copy(sunState.dir);
  atmo.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity * 0.45);
  bounce.intensity = 0.1 + 0.22 * low;
  pipeline.uniforms.uSunTint.value.setRGB(1.0, 0.72 + 0.16 * low, 0.48 + 0.25 * low).multiplyScalar(0.5 + 0.5 * low);
  if (envTarget) envTarget.dispose();
  envTarget = pmrem.fromScene(envScene);
  scene.environment = envTarget.texture;
  water?.setEnvironment(envTarget.texture);
  placeShadow(shadowCenter, true);
  $("sun-az").value = az;
  $("sun-el").value = el;
  $("az-val").textContent = `${Math.round(az)}°`;
  $("el-val").textContent = `${Math.round(el)}°`;
}

function placeShadow(center, force = false) {
  if (!force && center.distanceTo(shadowCenter) < SH * 0.16) return;
  shadowCenter.copy(center);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunState.dir, 3000);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxDpr));
  renderer.setSize(w, h, false);
  pipeline.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();

// ------------------------------------------------------------------ UI: toasts, menus
const sound = new Sound();
let toastTimer = 0;
const ui = {
  toast(p, n, total) {
    const el = $("toast");
    el.innerHTML = `<div class="kicker">Discovered · ${n} of ${total}</div><h3>${p.title}</h3>
      <div class="sub">${p.subtitle}</div><p>${p.text}</p>`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
    sound.chime();
  },
};
$("toast").addEventListener("click", () => { $("toast").hidden = true; });

document.body.classList.toggle("touch", isTouch);
if (isTouch) $("play").textContent = "Tap to explore";

// ------------------------------------------------------------------ game state
// The menu card opens only when asked for (pause button, Menu, or Esc when the mouse is
// free). Losing the pointer lock or the tab just pauses: a small "click to continue" pill
// on desktop, nothing on phones. Closing the journal / settings goes back to where they
// were opened from.
let world, player, discovery, grass, birds, touch, water;
let waterNear = 0;
let started = false;      // the first "explore" click happened
let playing = false;
let menuOpen = true;      // the start card is the menu
let sheetFrom = "game";

const sheetOpen = () => !$("journal").hidden || !$("settings").hidden;
const showPaused = () => { $("paused").hidden = isTouch || playing || !started || menuOpen || sheetOpen(); };

function setPlaying(on) {
  playing = on;
  if (player) player.enabled = on;
  touch?.show(on);
  document.body.classList.toggle("playing", on);
  if (on) {
    started = true;
    menuOpen = false;
    $("menu").hidden = true;
    $("journal").hidden = true;
    $("settings").hidden = true;
    $("play").textContent = isTouch ? "Continue" : "Continue exploring";
  } else if (document.pointerLockElement) {
    document.exitPointerLock();
  }
  showPaused();
}

function openMenu() {
  menuOpen = true;
  $("journal").hidden = true;
  $("settings").hidden = true;
  setPlaying(false);
  $("menu").hidden = false;
}

function showSheet(id) {
  sheetFrom = menuOpen ? "menu" : "game";
  for (const s of ["journal", "settings"]) $(s).hidden = s !== id;
  $("menu").hidden = true;
  setPlaying(false);
}

function closeSheet(id) {
  $(id).hidden = true;
  if (sheetFrom === "menu" || !started) openMenu();
  else engage();
}
document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => closeSheet(b.dataset.close); });

// enter the game: pointer lock on desktop, touch controls on phones
function engage() {
  sound.start();
  if (isTouch) {
    setPlaying(true);
    return;
  }
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p?.catch) p.catch(() => setPlaying(true));
  } catch {
    setPlaying(true);
  }
}

async function init() {
  world = await loadWorld(renderer, tier, (text, f) => {
    $("loading-text").textContent = text;
    $("progress").style.width = `${Math.round(f * 100)}%`;
  });
  scene.add(world.root);
  const hc = world.config.haze.color;
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(hc[0], hc[1], hc[2]), FOG_DENSITY);
  const start = world.config.player_start;
  atmo.uFogBase.value = start.position[1] - 20;

  player = new Player(camera, renderer.domElement, world);
  touch = new TouchControls(player, $("touch"), {
    onPause: openMenu,
    onJournal: () => showSheet("journal"),
  });
  player.onModeChange = (m) => {
    $("mode").textContent = m === "fly" ? "Fly" : "Walk";
    touch.setMode(m);
    pipeline.pause(1);
  };
  player.onStep = (s) => sound.step(s);
  player.onLand = (v) => sound.land(v);
  player.place(new THREE.Vector3(...start.position), new THREE.Vector3(...start.look_at), "walk");

  grass = new Grass(scene, world, world.textures.core, world.ground.core.bounds, tier);
  birds = new Birds(scene, world, tier.birds);
  // rivers and streams: built in the background after the world appears
  fetch("./models/water.json").then((r) => r.json()).then((data) => {
    water = new Water(scene, world, data, envTarget.texture);
    return water.build();
  }).catch((e) => console.warn("water", e));
  discovery = new Discovery(scene, world.pois, ui);
  const updateMenuCount = () => { $("menu-found").textContent = `(${discovery.count}/${world.pois.length})`; };
  discovery.onChange = updateMenuCount;
  updateMenuCount();
  $("menu-total").textContent = world.pois.length;

  const travel = (pos, look, mode) => {
    player.place(pos, look, mode);
    world.trees.update(camera.position, true);
    pipeline.pause(2);
    engage();
  };

  // journal: fast travel
  $("journal-list").addEventListener("click", (e) => {
    const id = e.target.dataset?.travel;
    if (!id) return;
    const p = world.pois.find((q) => q.id === id);
    travel(new THREE.Vector3(p.position[0], p.y + 2, p.position[1] + Math.min(p.radius * 0.6, 40)),
      new THREE.Vector3(p.position[0], p.y + 20, p.position[1]), "walk");
  });
  $("reset-progress").onclick = () => { discovery.reset(); updateMenuCount(); };

  // viewpoints (fly mode)
  const viewsEl = $("views");
  for (const [, v] of Object.entries(world.config.views)) {
    const b = document.createElement("button");
    b.textContent = v.label;
    b.onclick = () => travel(new THREE.Vector3(...v.position), new THREE.Vector3(...v.target), "fly");
    viewsEl.appendChild(b);
  }
  const walkHere = document.createElement("button");
  walkHere.textContent = "Back to the Great Buddha (walk)";
  walkHere.onclick = () => travel(new THREE.Vector3(...start.position), new THREE.Vector3(...start.look_at), "walk");
  viewsEl.appendChild(walkHere);

  document.querySelectorAll("[data-sun]").forEach((b) => { b.onclick = () => setSun(...world.config.sun[b.dataset.sun]); });
  $("sun-az").oninput = (e) => setSun(+e.target.value, sunState.el);
  $("sun-el").oninput = (e) => setSun(sunState.az, +e.target.value);
  setSun(...(world.config.sun.late_afternoon || world.config.sun.photo));   // long shadows show the cliff best

  // graphics quality (reloads) and sound
  const q = $("quality");
  for (const [name, t] of Object.entries(TIERS)) q.add(new Option(t.label, name, false, name === tierName));
  q.onchange = () => {
    saveTier(q.value);
    const url = new URL(location.href);
    url.searchParams.delete("q");
    location.replace(url);
  };
  const soundBtn = $("sound");
  const showSound = () => { soundBtn.textContent = sound.muted ? "Sound: off" : "Sound: on"; };
  soundBtn.onclick = () => { sound.setMuted(!sound.muted); showSound(); };
  showSound();
  const fs = $("fullscreen");
  if (document.fullscreenEnabled) {
    fs.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));
  } else fs.hidden = true;

  // menu / pointer lock
  $("play").onclick = engage;
  $("open-journal").onclick = () => showSheet("journal");
  $("open-settings").onclick = () => showSheet("settings");
  $("open-menu").onclick = (e) => { e.stopPropagation(); openMenu(); };
  $("paused").onclick = engage;
  renderer.domElement.addEventListener("click", () => {
    if (!isTouch && started && !playing && !menuOpen && !sheetOpen()) engage();
  });
  document.addEventListener("pointerlockchange", () => {
    if (isTouch) return;
    const locked = document.pointerLockElement === renderer.domElement;
    if (locked !== playing) setPlaying(locked);
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyJ" && started) {
      if ($("journal").hidden) showSheet("journal");
      else closeSheet("journal");
    }
    // the first Esc frees the mouse (browser), a second one opens the menu
    if (e.code === "Escape" && started && !playing) {
      if (sheetOpen()) closeSheet(!$("journal").hidden ? "journal" : "settings");
      else if (!menuOpen) openMenu();
    }
    if (e.code === "KeyM") {
      sound.setMuted(!sound.muted);
      showSound();
    }
  });
  document.addEventListener("visibilitychange", () => {
    // phones: just let go of the sticks; desktop loses the pointer lock by itself (-> paused)
    if (document.hidden) touch.reset();
    pipeline.pause(2);
  });

  world.trees.update(camera.position, true);
  if (import.meta.env.DEV) {
    window.bamyan = { THREE, scene, camera, world, player, discovery, grass, birds, renderer, pipeline, setSun, atmo, tier, travel, get water() { return water; } };
  }
  $("hud").hidden = false;
  $("menu").hidden = false;
  $("loading").classList.add("done");
  pipeline.pause(3);
  console.info(`world ready: ${world.stats.trees} trees, ${world.stats.buildings} building tiles, quality ${tierName}, reversed depth ${pipeline.reversed}`);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let lastCull = 0;
let gustPhase = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  atmo.uTime.value += dt;
  sky.material.uniforms.time.value = atmo.uTime.value;
  // wind: slow swells and gusts
  gustPhase += dt;
  atmo.uWind.value = 0.55 + 0.3 * Math.sin(gustPhase * 0.23) + 0.2 * Math.sin(gustPhase * 0.61 + 1.3);
  if (player) {
    player.update(dt);
    discovery.update(now, player.feet, player.heading());
    // grass only near the ground (walking or low flight)
    const g = world.groundHeight(player.feet.x, player.feet.z, world.groundOnly, player.feet.y + 400);
    const altitude = g === null ? 1000 : player.feet.y - g;
    const low = altitude < 120;
    if (low) grass.update(dt, player.feet);
    grass.setVisible(low);
    birds.update(dt, atmo.uTime.value);
    placeShadow(player.feet);
    if (now - lastCull > 250) {
      cullByDistance(world, camera.position, tier);
      waterNear = water ? water.proximity(camera.position) : 0;
      lastCull = now;
    }
    sound.update(dt, altitude, player.speed(), player.mode === "fly", playing, waterNear);
    if (playing) pipeline.adapt(dt);
  }
  pipeline.updateSun(camera, sunState.dir, sunState.el);
  pipeline.render(scene, camera, dt);
});

init().catch((err) => {
  console.error(err);
  $("loading-text").textContent = `Failed to load: ${err.message}`;
});
