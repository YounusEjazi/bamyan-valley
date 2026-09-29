// Horses and donkeys: one jointed model (rig.js) with bay, chestnut, grey, dun and black
// coats, dark legs, a white blaze, horse or donkey ears, and a saddle with an Afghan
// saddle blanket on the ones that can be ridden. Gaits blend from walk to trot, canter
// and gallop with the speed; they also graze, look around, swish their tails and jump.
import * as THREE from "three";
import { RigBuilder, Pose, tube, ball, lathe, box } from "./rig.js";

export const SLOTS = {
  coat: 0, points: 1, mane: 2, hoof: 3, dark: 4, saddle: 5, blanket: 6, blaze: 7,
  ears: 8, donkeyEars: 9, muzzle: 10,
};
export const H = { body: 0, neck: 1, head: 2, tail: 3, flU: 4, flL: 5, frU: 6, frL: 7, hlU: 8, hlL: 9, hrU: 10, hrL: 11 };
export const BONES = 12;
// top of the saddle seat, in the body bone's rest space
export const SADDLE = new THREE.Vector3(0, 1.625, -0.06);

export function buildHorse() {
  const r = new RigBuilder(SLOTS);
  r.bone(-1, 0, 1.2, 0);              // body
  r.bone(H.body, 0, 1.32, -0.68);     // neck
  r.bone(H.neck, 0, 1.97, -1.2);      // head (poll)
  r.bone(H.body, 0, 1.4, 0.86);       // tail
  for (const s of [-1, 1]) {
    const u = r.bone(H.body, 0.17 * s, 1.02, -0.6);
    r.bone(u, 0.17 * s, 0.53, -0.6);  // knee
  }
  for (const s of [-1, 1]) {
    const u = r.bone(H.body, 0.17 * s, 1.02, 0.5);   // stifle
    r.bone(u, 0.17 * s, 0.56, 0.68);                 // hock
  }

  // barrel (a lathe along the body), chest, croup and withers
  const barrel = lathe([[0, -0.95], [0.2, -0.9], [0.31, -0.72], [0.35, -0.4], [0.35, 0.05], [0.34, 0.45],
    [0.3, 0.75], [0.18, 0.92], [0, 0.96]], { seg: 14, sx: 0.82 });
  barrel.rotateX(-Math.PI / 2).translate(0, 1.2, 0);
  r.add(H.body, "coat", barrel,
    ball([0, 1.28, 0.5], 0.3, 0.3, 0.42),
    ball([0, 1.15, -0.55], 0.27, 0.32, 0.36),
    ball([0, 1.44, -0.5], 0.1, 0.12, 0.26, { w: 8, h: 6 }));

  // neck, mane, head
  r.add(H.neck, "coat", tube([0, 1.3, -0.7], [0, 1.95, -1.2], 0.22, 0.12, { sx: 0.6, seg: 10 }));
  r.add(H.neck, "mane", tube([0, 1.495, -0.61], [0, 2.02, -1.12], 0.06, 0.045, { sx: 0.4 }));
  r.add(H.head, "coat", tube([0, 1.98, -1.18], [0, 1.55, -1.52], 0.1, 0.075, { sx: 0.72, seg: 10 }),
    ball([0, 1.86, -1.25], 0.075, 0.11, 0.12, { w: 8, h: 6 }));
  r.add(H.head, "muzzle", ball([0, 1.54, -1.52], 0.068, 0.075, 0.085, { w: 8, h: 6 }));
  r.add(H.head, "blaze", tube([0, 1.996, -1.289], [0, 1.614, -1.558], 0.026, 0.024, { seg: 6 }));
  for (const s of [-1, 1]) {
    r.add(H.head, "dark", ball([0.07 * s, 1.88, -1.28], 0.022, 0.022, 0.022, { w: 6, h: 4 }),
      ball([0.035 * s, 1.53, -1.595], 0.014, 0.018, 0.012, { w: 6, h: 4 }));
    r.add(H.head, "ears", tube([0.045 * s, 2.0, -1.16], [0.065 * s, 2.15, -1.13], 0.03, 0.006, { seg: 6 }));
    r.add(H.head, "donkeyEars", tube([0.05 * s, 2.0, -1.15], [0.11 * s, 2.3, -1.1], 0.045, 0.012, { seg: 6, sz: 0.6 }));
    // bridle (only with the saddle)
    r.add(H.head, "saddle", tube([0.074 * s, 1.96, -1.2], [0.066 * s, 1.6, -1.46], 0.012, 0.012, { seg: 4 }));
  }
  r.add(H.head, "saddle", tube([-0.08, 1.96, -1.22], [0.08, 1.96, -1.22], 0.012, 0.012, { seg: 4 }));

  // tail
  r.add(H.tail, "mane", tube([0, 1.42, 0.85], [0, 1.2, 0.97], 0.055, 0.062),
    tube([0, 1.22, 0.96], [0, 0.62, 1.04], 0.075, 0.03));

  // legs: forearm / gaskin in the coat colour, dark lower legs, hooves
  for (const s of [-1, 1]) {
    const x = 0.17 * s;
    const U = s < 0 ? H.flU : H.frU, L = s < 0 ? H.flL : H.frL;
    r.add(U, "coat", tube([x, 1.12, -0.58], [x, 0.53, -0.6], 0.09, 0.055, { sx: 0.85 }),
      ball([x * 0.95, 0.98, -0.56], 0.09, 0.13, 0.12, { w: 8, h: 6 }));
    lowerLeg(r, L, x, -0.6, -0.6, 0.53);
  }
  for (const s of [-1, 1]) {
    const x = 0.17 * s;
    const U = s < 0 ? H.hlU : H.hrU, L = s < 0 ? H.hlL : H.hrL;
    r.add(U, "coat", ball([x * 0.9, 1.1, 0.56], 0.12, 0.22, 0.18, { w: 8, h: 6 }),
      tube([x, 1.02, 0.52], [x, 0.56, 0.68], 0.1, 0.055, { sx: 0.8 }));
    lowerLeg(r, L, x, 0.68, 0.62, 0.56);
  }

  // saddle, stirrups and blanket
  r.add(H.body, "blanket", ball([0, 1.2, -0.06], 0.305, 0.372, 0.45, { theta: 0.95, w: 14, h: 5 }));
  r.add(H.body, "saddle", ball([0, 1.555, -0.06], 0.2, 0.07, 0.3),
    ball([0, 1.62, -0.31], 0.08, 0.07, 0.06, { w: 8, h: 6 }),
    ball([0, 1.61, 0.2], 0.13, 0.06, 0.05, { w: 8, h: 6 }));
  for (const s of [-1, 1]) {
    r.add(H.body, "saddle", tube([0.27 * s, 1.52, -0.08], [0.34 * s, 1.0, -0.08], 0.012, 0.012, { seg: 4 }),
      box([0.345 * s, 0.98, -0.08], 0.04, 0.05, 0.12));
  }
  return r.build();
}

function lowerLeg(r, bone, x, zTop, zBottom, yTop) {
  r.add(bone, "points", ball([x, yTop, zTop + 0.01], 0.05, 0.055, 0.055, { w: 8, h: 6 }),
    tube([x, yTop, zTop], [x, 0.15, zBottom], 0.045, 0.037),
    ball([x, 0.14, zBottom - 0.005], 0.045, 0.05, 0.05, { w: 8, h: 6 }),
    tube([x, 0.14, zBottom - 0.005], [x, 0.07, zBottom - 0.03], 0.035, 0.035, { caps: false }));
  r.add(bone, "hoof", tube([x, 0.075, zBottom - 0.035], [x, 0.0, zBottom - 0.05], 0.045, 0.058));
}

// ------------------------------------------------------------------ coats
const COATS = [
  // coat, points (lower legs), mane and tail
  ["#7a4a2a", "#2a1f19", "#1e1814"],   // bay
  ["#6b3d22", "#231a15", "#1a1411"],   // dark bay
  ["#9a5a32", "#8a4f2c", "#7a4526"],   // chestnut
  ["#3f2a1e", "#2a1d16", "#1a1411"],   // brown
  ["#1f1b19", "#1a1716", "#141211"],   // black
  ["#b9b4ac", "#8f8a84", "#dcd7d0"],   // grey
  ["#d6d2cc", "#b9b4ae", "#ece8e2"],   // white-grey
  ["#b89868", "#3a2e24", "#2a221c"],   // dun
  ["#c9a268", "#b89258", "#ede0c0"],   // palomino
];
const DONKEY = [["#8a8076", "#6f6760", "#4a4540"], ["#6f6a64", "#5a5550", "#3a3632"], ["#9c8b78", "#7d6f60", "#4f463d"]];
const BLANKET = ["#8e1f24", "#a8322a", "#2c3f7a", "#6a2c5a", "#7a2a1c", "#1f5a4a"];

// kind: "horse" | "donkey"; saddled: wears saddle, bridle and blanket
export function coat(kind, rnd, saddled) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pal = Object.keys(SLOTS).map(() => ({ color: new THREE.Color(), on: true }));
  const set = (slot, h, on = true) => { pal[SLOTS[slot]].color.set(h); pal[SLOTS[slot]].on = on; };
  const [c, p, m] = kind === "donkey" ? pick(DONKEY) : pick(COATS);
  set("coat", c);
  set("points", p);
  set("mane", m);
  set("hoof", "#3a332d");
  set("dark", "#141110");
  set("saddle", "#4e3220", saddled);
  set("blanket", pick(BLANKET), saddled);
  set("blaze", "#ece8e2", kind === "horse" && rnd() < 0.35);
  set("ears", c, kind === "horse");
  set("donkeyEars", c, kind === "donkey");
  set("muzzle", kind === "donkey" ? "#d8d0c4" : c);
  return pal;
}

// ------------------------------------------------------------------ gaits
// per gait: speed (m/s), stride (m per cycle), stance share, leg swing (rad), knee flex
// (rad), phase of each leg [FL, FR, HL, HR], body bob (m), bobs per cycle, pitch (rad)
const GAITS = [
  { speed: 1.6, stride: 1.75, stance: 0.62, amp: 0.3, flex: 0.85, off: [0.25, 0.75, 0.0, 0.5], bob: 0.015, beats: 2, pitch: 0.01 },
  { speed: 4.0, stride: 2.6, stance: 0.45, amp: 0.36, flex: 1.2, off: [0.0, 0.5, 0.5, 0.0], bob: 0.05, beats: 2, pitch: 0.015 },
  { speed: 7.5, stride: 3.7, stance: 0.4, amp: 0.46, flex: 1.35, off: [0.3, 0.55, 0.0, 0.3], bob: 0.07, beats: 1, pitch: 0.06 },
  { speed: 14, stride: 6.2, stance: 0.33, amp: 0.62, flex: 1.55, off: [0.45, 0.57, 0.0, 0.12], bob: 0.09, beats: 1, pitch: 0.07 },
];
const G = { stride: 0, stance: 0, amp: 0, flex: 0, off: [0, 0, 0, 0], bob: 0, beats: 0, pitch: 0 };

// continuous gait index 0 (walk) .. 3 (gallop) for a speed
export function gaitOf(speed) {
  for (let i = 0; i < GAITS.length - 1; i++) {
    if (speed < GAITS[i + 1].speed) return i + Math.max(0, (speed - GAITS[i].speed) / (GAITS[i + 1].speed - GAITS[i].speed));
  }
  return GAITS.length - 1;
}

function gait(g) {
  const i = Math.min(Math.floor(g), GAITS.length - 2), f = Math.min(g - i, 1);
  const a = GAITS[i], b = GAITS[i + 1];
  for (const k of ["stride", "stance", "amp", "flex", "bob", "beats", "pitch"]) G[k] = a[k] + (b[k] - a[k]) * f;
  for (let j = 0; j < 4; j++) G.off[j] = a.off[j] + (b.off[j] - a.off[j]) * f;
  return G;
}

export function strideOf(speed) {
  return gait(gaitOf(speed)).stride;
}

// leg phase 0..1: [upper swing, knee flex]; stance = hoof on the ground moving back
function leg(p, stance, amp, flex) {
  p -= Math.floor(p);
  if (p < stance) return [amp * (1 - 2 * p / stance), 0.05 * flex];
  const u = (p - stance) / (1 - stance);
  return [-amp * Math.cos(Math.PI * u), flex * Math.sin(Math.PI * u)];
}

// how many hooves touched down between two phases (for hoof beats)
export function hoofBeats(p0, p1, speed) {
  const g = gait(gaitOf(speed));
  let n = 0;
  for (let j = 0; j < 4; j++) if (Math.floor(p1 + g.off[j]) !== Math.floor(p0 + g.off[j])) n++;
  return n;
}

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const _w = new Pose(BONES);

// h = { phase (cycles), speed, t, seed, graze 0..1, air 0..1, vy, look }
export function horsePose(pose, h) {
  pose.clear();
  const t = h.t + h.seed * 13;
  const g = gait(gaitOf(h.speed));
  const move = smooth(h.speed, 0.05, 0.6);
  const fast = smooth(h.speed, 5, 12);
  const P = h.phase;

  // standing: weight shift, tail swish, looking around
  const swish = Math.sin(t * 1.3) * smooth(Math.sin(t * 0.23), 0.3, 0.9);
  pose.set(H.tail, 0.05, 0, 0.35 * swish);
  pose.set(H.neck, 0.08 * Math.sin(t * 0.21), 0.25 * Math.sin(t * 0.17) * (1 - move), 0);
  pose.set(H.head, 0.05 * Math.sin(t * 0.33), 0.15 * Math.sin(t * 0.29) * (1 - move), 0);
  pose.set(H.hrU, 0.04 * (1 + Math.sin(t * 0.11)), 0, 0).set(H.hrL, 0.12 * (1 + Math.sin(t * 0.11)), 0, 0);

  if (move > 0) {
    const w = _w.clear();
    const legs = [[H.flU, H.flL, 1], [H.frU, H.frL, 1], [H.hlU, H.hlL, -1], [H.hrU, H.hrL, -1]];
    legs.forEach(([U, L, front], j) => {
      const [a, f] = leg(P + g.off[j], g.stance, g.amp, g.flex);
      if (front > 0) w.set(U, a, 0, 0).set(L, -f, 0, 0);
      else w.set(U, a * 0.85, 0, 0).set(L, -f * 0.7, 0, 0);
    });
    // body rides up and down; at canter and gallop it rocks, the neck swinging with it
    const beat = Math.sin(2 * Math.PI * P * g.beats);
    w.off.y = -g.bob * (0.5 + 0.5 * beat);
    w.set(H.body, g.pitch * Math.sin(2 * Math.PI * P), 0, 0);
    w.set(H.neck, -0.1 - 0.25 * fast + (0.04 + 0.1 * fast) * Math.sin(2 * Math.PI * (P * g.beats + 0.2)), 0, 0);
    w.set(H.head, 0.05 + 0.25 * fast, 0, 0);
    w.set(H.tail, 0.05 - 0.9 * fast, 0, 0.1 * Math.sin(t * 2.1));
    pose.blend(w, move);
  }

  // turn the head toward something (the rider's view, the player)
  if (h.look) pose.add(H.neck, 0, clamp(h.look, -0.7, 0.7) * 0.6, 0).add(H.head, 0, clamp(h.look, -0.7, 0.7) * 0.4, 0);

  if (h.graze > 0) {
    // head down in the grass, nibbling; front legs a little apart
    const w = _w.clear();
    w.rot.set(pose.rot);
    w.off.copy(pose.off);
    w.set(H.neck, -1.85 + 0.05 * Math.sin(t * 0.5), 0.15 * Math.sin(t * 0.13), 0);
    w.set(H.head, 1.15 + 0.08 * Math.sin(t * 3.2) * smooth(Math.sin(t * 0.4), -0.2, 0.4), 0, 0);
    w.set(H.body, -0.03, 0, 0);
    w.set(H.flU, 0.12, 0, -0.03).set(H.frU, -0.06, 0, 0.03);
    pose.blend(w, h.graze * (1 - move * 0.7));
  }

  if (h.air > 0) {
    // jumping: forelegs tucked, hind legs pushed back, nose up on the way up
    const w = _w.clear();
    w.rot.set(pose.rot);
    w.set(H.flU, 0.95, 0, 0).set(H.flL, -1.9, 0, 0);
    w.set(H.frU, 0.85, 0, 0).set(H.frL, -1.8, 0, 0);
    w.set(H.hlU, -0.55, 0, 0).set(H.hlL, -0.35, 0, 0);
    w.set(H.hrU, -0.5, 0, 0).set(H.hrL, -0.3, 0, 0);
    w.set(H.body, clamp((h.vy || 0) * 0.05, -0.25, 0.25), 0, 0);
    w.set(H.neck, -0.25, 0, 0);
    w.set(H.tail, -0.6, 0, 0);
    pose.blend(w, h.air);
  }
  return pose;
}
