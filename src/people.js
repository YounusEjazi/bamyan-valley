// People of the valley: men in shalwar kameez with a waistcoat and a pakol or turban,
// women in long dresses and headscarves, children, visitors in outdoor clothes, and the
// player's own figure. One jointed model (rig.js); hats, beards, dresses and so on are
// colour slots that each person wears or not. Poses for walking and running, standing,
// talking, waving, pointing, working in the fields, jumping and riding.
import * as THREE from "three";
import { RigBuilder, Pose, tube, ball, lathe, ring } from "./rig.js";

export const SLOTS = {
  skin: 0, tunic: 1, trousers: 2, vest: 3, hem: 4, dress: 5, shoes: 6,
  beard: 7, pakol: 8, turban: 9, scarf: 10, hair: 11, eyes: 12,
};
export const B = { root: 0, chest: 1, head: 2, armL: 3, foreL: 4, armR: 5, foreR: 6, thighL: 7, shinL: 8, thighR: 9, shinR: 10 };
export const BONES = 11;
// the rider's seat: height of the bottom of the pelvis in rest pose (m)
export const SEAT = 0.84;
export const EYE = 1.62;

export function buildPerson() {
  const r = new RigBuilder(SLOTS);
  r.bone(-1, 0, 0.95, 0);             // root: pelvis
  r.bone(B.root, 0, 1.02, 0);         // chest
  r.bone(B.chest, 0, 1.5, 0);         // head (neck)
  for (const s of [-1, 1]) {
    const arm = r.bone(B.chest, 0.19 * s, 1.42, 0);
    r.bone(arm, 0.215 * s, 1.14, 0);  // elbow
  }
  for (const s of [-1, 1]) {
    const thigh = r.bone(B.root, 0.095 * s, 0.92, 0);
    r.bone(thigh, 0.095 * s, 0.5, 0);  // knee
  }

  // body: pelvis, chest in the kameez, waistcoat, knee-length shirt tail or long dress
  r.add(B.root, "trousers", ball([0, 0.95, 0], 0.165, 0.12, 0.12));
  r.add(B.chest, "tunic", lathe([[0.0, 0.94], [0.15, 0.95], [0.162, 1.08], [0.178, 1.22], [0.182, 1.33], [0.16, 1.42],
    [0.085, 1.475], [0.0, 1.49]], { sz: 0.64 }));
  r.add(B.chest, "vest", lathe([[0.168, 1.02], [0.186, 1.2], [0.19, 1.33], [0.168, 1.425], [0.1, 1.47]], { sz: 0.68 }));
  r.add(B.root, "hem", lathe([[0.162, 1.02], [0.18, 0.9], [0.215, 0.72], [0.232, 0.58]], { sz: 0.78 }));
  r.add(B.root, "dress", lathe([[0.162, 1.02], [0.2, 0.8], [0.25, 0.45], [0.275, 0.1]], { sz: 0.8 }));

  // head: neck, face, nose, eyes; hair, beard; pakol, turban or headscarf
  r.add(B.head, "skin", tube([0, 1.44, 0], [0, 1.57, 0], 0.048, 0.045, { caps: false }),
    ball([0, 1.645, -0.005], 0.093, 0.114, 0.103),
    ball([0, 1.63, -0.098], 0.017, 0.03, 0.024, { w: 6, h: 5 }));
  for (const s of [-1, 1]) r.add(B.head, "eyes", ball([0.036 * s, 1.66, -0.088], 0.013, 0.011, 0.008, { w: 6, h: 4 }));
  r.add(B.head, "hair", ball([0, 1.652, 0.008], 0.099, 0.118, 0.108, { theta: 1.75, tilt: 0.45 }));
  r.add(B.head, "beard", ball([0, 1.575, -0.045], 0.078, 0.07, 0.066, { w: 8, h: 6 }));
  r.add(B.head, "pakol", tube([0, 1.72, 0.005], [0, 1.785, 0.005], 0.108, 0.112), ring([0, 1.728, 0.005], 0.1, 0.034));
  r.add(B.head, "turban", ball([0, 1.74, 0.01], 0.128, 0.078, 0.13, { tilt: -0.15 }), ring([0, 1.715, 0.005], 0.105, 0.035));
  r.add(B.head, "scarf", ball([0, 1.655, 0.008], 0.116, 0.135, 0.122, { theta: 2.35, phi0: Math.PI * 1.5 + 0.95, phi: Math.PI * 2 - 1.9 }),
    lathe([[0.11, 1.6], [0.17, 1.47], [0.225, 1.36], [0.235, 1.3]], { sz: 0.72, phi0: Math.PI + 0.75, phi: Math.PI * 2 - 1.5 }));

  // arms in sleeves, hands
  for (const s of [-1, 1]) {
    const arm = s < 0 ? B.armL : B.armR, fore = s < 0 ? B.foreL : B.foreR;
    r.add(arm, "tunic", ball([0.18 * s, 1.415, 0], 0.062, 0.06, 0.06, { w: 8, h: 6 }),
      tube([0.19 * s, 1.42, 0], [0.215 * s, 1.14, 0], 0.056, 0.047, { caps: false }));
    r.add(fore, "tunic", tube([0.215 * s, 1.15, 0], [0.225 * s, 0.9, -0.01], 0.047, 0.041));
    r.add(fore, "skin", ball([0.227 * s, 0.855, -0.012], 0.03, 0.052, 0.04, { w: 8, h: 6 }));
  }
  // legs in baggy trousers, shoes
  for (const s of [-1, 1]) {
    const thigh = s < 0 ? B.thighL : B.thighR, shin = s < 0 ? B.shinL : B.shinR;
    r.add(thigh, "trousers", tube([0.095 * s, 0.95, 0], [0.095 * s, 0.49, 0.005], 0.088, 0.07));
    r.add(shin, "trousers", tube([0.095 * s, 0.51, 0.005], [0.095 * s, 0.1, 0.01], 0.068, 0.05));
    r.add(shin, "shoes", ball([0.095 * s, 0.045, -0.045], 0.052, 0.045, 0.125, { w: 8, h: 6 }));
  }
  return r.build();
}

// ------------------------------------------------------------------ clothes
const hex = (h) => new THREE.Color(h);
const SKIN = ["#c99a7a", "#b98a68", "#d4a88a", "#a87858", "#c28d6b", "#9c6e50"];
const KAMEEZ = ["#e8e4da", "#c9c3b4", "#b5ad96", "#9aa7ae", "#7f8a74", "#6b5a48", "#4b4d52", "#a9b89e", "#d8cfb8", "#8c9fb4", "#5f6f7c"];
const VEST = ["#2d2f33", "#3b3a36", "#4a3f35", "#2f3b48", "#3d4436", "#5a5146", "#23262b"];
const SHOES = ["#2a2420", "#3e342b", "#5a4b3c", "#1f1d1c"];
const PAKOL = ["#b8a58a", "#8c7a64", "#d4c7ae", "#6f6253", "#9a8f7e"];
const TURBAN = ["#e8e6e0", "#2b2b2b", "#7d7466", "#c4bfb3", "#3a3d45"];
const HAIR = ["#1c1814", "#2a221c", "#3a2e25", "#151311"];
const GREY = ["#8a8580", "#a39e97", "#c9c5bf"];
const DRESS = ["#7a1e2c", "#1f4e8c", "#2f6b4f", "#8a3c7a", "#c05a28", "#203050", "#5b1e1e", "#9c2f3f", "#3f2a5c"];
const SCARF = ["#f2efe8", "#2a2a2a", "#b03a48", "#3a5ba0", "#d8b04a", "#6b2f5f", "#e7d9c0"];
const KIDS = ["#c43c3c", "#3c7ac4", "#e0b030", "#3a9a5a", "#d06a2c", "#7b4fb0"];
const JACKET = ["#c0392b", "#2e86c1", "#e67e22", "#27ae60", "#34495e", "#8e44ad", "#d35400", "#16a085"];
const JEANS = ["#3b4f6b", "#2c3440", "#8a7d62", "#5a5f55", "#6d6250"];

// kind: "man", "elder", "woman", "child", "visitor"
export function dress(kind, rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pal = Object.keys(SLOTS).map(() => ({ color: new THREE.Color(), on: false }));
  const set = (slot, color, on = true) => {
    pal[SLOTS[slot]].color.copy(typeof color === "string" ? hex(color) : color);
    pal[SLOTS[slot]].on = on;
  };
  const skin = pick(SKIN);
  set("skin", skin);
  set("eyes", "#16110e");
  set("shoes", pick(SHOES));
  const hair = kind === "elder" ? pick(GREY) : pick(HAIR);
  if (kind === "man" || kind === "elder") {
    const k = pick(KAMEEZ);
    set("tunic", k);
    set("hem", k);
    set("trousers", rnd() < 0.8 ? k : pick(KAMEEZ));
    set("vest", pick(VEST), rnd() < 0.55);
    set("beard", hair, rnd() < (kind === "elder" ? 0.95 : 0.55));
    const hat = rnd();
    if (hat < 0.45) set("pakol", pick(PAKOL));
    else if (hat < 0.65 || kind === "elder") set("turban", pick(TURBAN));
    set("hair", hair);
  } else if (kind === "woman") {
    if (rnd() < 0.18) {
      // chadari: blue from head to foot
      const b = hex("#4f7fb8").offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
      for (const s of ["tunic", "dress", "scarf", "trousers"]) set(s, b);
      set("skin", b);
      set("eyes", b);
    } else {
      const d = pick(DRESS);
      set("tunic", d);
      set("dress", d);
      set("trousers", "#2a2626");
      set("scarf", pick(SCARF));
      set("vest", pick(VEST), rnd() < 0.2);
    }
  } else if (kind === "child") {
    const k = pick(KIDS);
    set("tunic", k);
    set("trousers", rnd() < 0.5 ? k : pick(KAMEEZ));
    if (rnd() < 0.4) {
      set("dress", k);
      set("scarf", pick(SCARF));
    } else {
      set("hem", k);
      set("hair", hair);
      if (rnd() < 0.3) set("pakol", pick(PAKOL));
    }
  } else {
    // visitor: jacket, trousers, sometimes a cap (the pakol slot) or a scarf
    set("tunic", pick(JACKET));
    set("trousers", pick(JEANS));
    set("hair", rnd() < 0.3 ? pick(["#6b4a2e", "#b08850", "#3a2e25"]) : hair);
    set("beard", hair, rnd() < 0.2);
    if (rnd() < 0.25) set("pakol", pick(PAKOL));
    else if (rnd() < 0.2) set("scarf", pick(SCARF));
  }
  return pal;
}

// the player: a traveller in a sand-coloured kameez, green waistcoat and pakol
export function playerDress() {
  const pal = Object.keys(SLOTS).map(() => ({ color: new THREE.Color(), on: false }));
  const set = (slot, h) => { pal[SLOTS[slot]].color.set(h); pal[SLOTS[slot]].on = true; };
  set("skin", "#c49270");
  set("eyes", "#16110e");
  set("tunic", "#cdbf9f");
  set("hem", "#cdbf9f");
  set("trousers", "#b8aa8c");
  set("vest", "#3c4a36");
  set("shoes", "#3a2e24");
  set("pakol", "#8e7b5e");
  set("hair", "#2a221c");
  set("beard", "#2a221c");
  return pal;
}

// ------------------------------------------------------------------ poses
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const _work = new Pose(BONES);

// a = { phase, speed, t, seed, air, look, lookUp, act, actT, ride, rideBob, rideLean }
// act: "idle" | "talk" | "wave" | "point" | "work"; actT = seconds in that act
export function personPose(pose, a) {
  pose.clear();
  const t = a.t + a.seed * 10;
  const s = a.speed;
  const move = smooth(s, 0.15, 0.8);
  const run = smooth(s, 2.2, 4.5);
  const sprint = smooth(s, 6, 11);
  const phi = a.phase;

  if (a.ride) return ridePose(pose, a, t);

  // standing: breathing, weight shift, arms hanging
  const idle = 1 - move;
  pose.set(B.root, 0, 0, 0.02 * Math.sin(t * 0.4) * idle);
  pose.set(B.chest, 0.015 * Math.sin(t * 1.6), 0, -0.02 * Math.sin(t * 0.4) * idle);
  pose.set(B.armL, 0, 0, -0.07);
  pose.set(B.armR, 0, 0, 0.07);
  pose.set(B.foreL, 0.12, 0, 0);
  pose.set(B.foreR, 0.12, 0, 0);
  pose.set(B.thighL, 0, 0, -0.03);
  pose.set(B.thighR, 0, 0, 0.03);

  if (move > 0) {
    // walk -> run -> sprint
    const A = 0.42 + 0.33 * run + 0.2 * sprint;
    const lean = 0.18 * run + 0.12 * sprint;
    const knee = 0.12 + 0.3 * run;
    const kneeSwing = 0.95 + 0.75 * run;
    const w = _work.clear();
    for (const [thigh, shin, ph] of [[B.thighL, B.shinL, phi], [B.thighR, B.shinR, phi + Math.PI]]) {
      w.set(thigh, A * Math.sin(ph) + lean * 0.6, 0, thigh === B.thighL ? -0.03 : 0.03);
      w.set(shin, -(knee + kneeSwing * Math.max(0, Math.cos(ph)) ** 1.5), 0, 0);
    }
    const Barm = 0.32 + 0.5 * run;
    const elbow = 0.25 + 1.2 * run;
    w.set(B.armL, -Barm * Math.sin(phi), 0, -0.1);
    w.set(B.armR, Barm * Math.sin(phi), 0, 0.1);
    w.set(B.foreL, elbow + 0.2 * Math.max(0, -Math.sin(phi)), 0, 0);
    w.set(B.foreR, elbow + 0.2 * Math.max(0, Math.sin(phi)), 0, 0);
    // hips and shoulders twist against each other; the body leans into a run
    const twist = 0.09 * (1 - 0.4 * run);
    w.set(B.root, 0, twist * Math.sin(phi), 0);
    w.set(B.chest, -lean, -twist * 1.3 * Math.sin(phi), 0);
    w.set(B.head, lean * 0.7, twist * 0.6 * Math.sin(phi), 0);
    // bounce: highest over the standing leg when walking, in flight when running
    w.off.y = (0.022 * Math.cos(2 * phi) - 0.012) * (1 - run) + (0.05 * Math.abs(Math.cos(phi)) - 0.05) * run;
    pose.blend(w, move);
  }

  // head: look toward a.look (radians, relative to the body)
  pose.add(B.head, (a.lookUp || 0), clamp(a.look || 0, -1.1, 1.1), 0);

  if (move < 0.5 && a.act && a.act !== "idle") gesture(pose, a, t, 1 - move * 2);

  if (a.air) {
    // in the air: knees up, arms out
    const w = _work.clear();
    w.set(B.thighL, 0.55, 0, -0.05).set(B.shinL, -0.9, 0, 0);
    w.set(B.thighR, 0.2, 0, 0.05).set(B.shinR, -0.5, 0, 0);
    w.set(B.armL, 0.3, 0, -0.45).set(B.armR, 0.3, 0, 0.45);
    w.set(B.foreL, 0.6, 0, 0).set(B.foreR, 0.6, 0, 0);
    w.set(B.chest, -0.08, 0, 0);
    pose.blend(w, a.air);
  }
  return pose;
}

function gesture(pose, a, t, k) {
  const w = _work.clear();
  w.rot.set(pose.rot);
  w.off.copy(pose.off);
  const e = smooth(a.actT, 0, 0.5);      // ease into the gesture
  if (a.act === "talk") {
    // hands move while talking, head nods
    const g = 0.5 + 0.5 * Math.sin(t * 0.7);
    w.set(B.armR, 0.35 + 0.25 * Math.sin(t * 2.3) * g, 0, 0.12);
    w.set(B.foreR, 0.9 + 0.35 * Math.sin(t * 3.1), 0, 0);
    w.set(B.armL, 0.15 + 0.2 * Math.sin(t * 1.9 + 1) * (1 - g), 0, -0.12);
    w.set(B.foreL, 0.5 + 0.4 * (1 - g), 0, 0);
    w.add(B.head, 0.06 * Math.sin(t * 1.7), 0, 0.03 * Math.sin(t * 0.9));
  } else if (a.act === "wave") {
    // wave for a couple of seconds, then lower the arm
    const up = e * (1 - smooth(a.actT, 2.4, 3.0));
    w.set(B.armR, 0.25 * up, 0, 0.07 + 2.3 * up);
    w.set(B.foreR, 0.12, 0, (0.5 + 0.45 * Math.sin(a.actT * 10)) * up);
    w.add(B.head, 0.05 * up, 0, 0.08 * up);
  } else if (a.act === "point") {
    // pointing up at the cliff
    const up = e * (1 - smooth(a.actT, 3.2, 3.8));
    w.set(B.armR, 2.0 * up, 0, 0.07 + 0.12 * up);
    w.set(B.foreR, 0.12 * (1 - up), 0, 0);
    w.add(B.head, 0.3 * up, 0, 0);
  } else if (a.act === "work") {
    // crouched over the crop rows, picking
    w.off.y = -0.26;
    w.set(B.thighL, 1.15, 0, -0.12).set(B.shinL, -1.55, 0, 0);
    w.set(B.thighR, 1.05, 0, 0.12).set(B.shinR, -1.45, 0, 0);
    w.set(B.chest, -0.55, 0.1 * Math.sin(t * 0.5), 0);
    w.set(B.head, 0.25, 0, 0);
    w.set(B.armR, 0.9 + 0.3 * Math.sin(t * 2.1), 0, 0.1);
    w.set(B.foreR, 0.4 + 0.3 * Math.max(0, Math.sin(t * 2.1)), 0, 0);
    w.set(B.armL, 0.7 + 0.15 * Math.sin(t * 1.3), 0, -0.1);
    w.set(B.foreL, 0.5, 0, 0);
  } else if (a.act === "look") {
    // taking in the view: hands behind the back, head up
    w.set(B.armL, -0.35, 0, 0.12).set(B.foreL, 0.9, 0, 0.5);
    w.set(B.armR, -0.35, 0, -0.12).set(B.foreR, 0.9, 0, -0.5);
    w.add(B.head, 0.15, 0, 0);
  }
  pose.blend(w, k);
}

// astride a horse: thighs forward and apart, hands on the reins; the body follows the
// horse's stride (a.rideBob) and leans forward at a gallop (a.rideLean)
function ridePose(pose, a, t) {
  const lean = a.rideLean || 0;
  pose.off.y = (a.rideRise || 0);
  pose.set(B.root, -0.05 - 0.2 * lean, 0, 0);
  pose.set(B.chest, 0.04 - 0.35 * lean + (a.rideBob || 0) * 0.6, 0, 0);
  pose.set(B.head, 0.05 + 0.3 * lean, clamp(a.look || 0, -1, 1), 0);
  pose.set(B.thighL, 1.3, 0, -0.5).set(B.shinL, -1.25 - 0.3 * lean, 0, 0.22);
  pose.set(B.thighR, 1.3, 0, 0.5).set(B.shinR, -1.25 - 0.3 * lean, 0, -0.22);
  const arm = 0.45 + 0.35 * lean;
  pose.set(B.armL, arm, 0, 0.12).set(B.foreL, 0.95 - 0.2 * lean, 0, -0.35);
  pose.set(B.armR, arm, 0, -0.12).set(B.foreR, 0.95 - 0.2 * lean, 0, 0.35);
  if (a.act === "wave") gesture(pose, a, t, 1);
  return pose;
}
