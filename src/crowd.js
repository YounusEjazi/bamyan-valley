// Life in the valley: villagers in the bazaar and at the shrine, farmers in the fields,
// visitors at the Buddha niches, children by the river, horses and donkeys grazing or
// waiting to be ridden, horsemen on the tracks. Drawn with rig.js (one draw call for all
// people, one for all horses) plus soft ground shadows.
// Everyone wanders within their own area over open, gentle ground (never through houses
// or the river), stops to talk, work or look up at the cliff, and turns to look at (and
// sometimes wave to) the player. Also draws the player's own figure in third person and
// the horse the player rides; the Player moves them, this only animates them.
import * as THREE from "three";
import { RigMesh, BlobShadows, Pose } from "./rig.js";
import * as P from "./people.js";
import * as Hs from "./horses.js";

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = THREE.MathUtils.clamp;
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

// where people live and what they do there; counts are for the "high" tier
// focus: [x, z, height above the ground] they look up at; bare: they keep to streets and
// bare ground (off the green of the fields and meadows)
const ZONES = [
  { x: 15, z: 100, r: 45, n: 7, kinds: { visitor: 4, man: 2, woman: 1, child: 1 }, acts: ["look", "point"], focus: [0, -5, 30], bare: true },
  { x: 420, z: -60, r: 45, n: 3, kinds: { visitor: 2, man: 1 }, acts: ["look", "point"], focus: [420, -140, 25], bare: true },
  { x: 786, z: -110, r: 40, n: 3, kinds: { visitor: 2, man: 1 }, acts: ["look", "point"], focus: [786, -186, 20], bare: true },
  { x: 434, z: 132, r: 28, n: 5, kinds: { man: 2, elder: 2, woman: 2 }, acts: ["talk"], bare: true },
  { x: 640, z: 330, r: 110, n: 8, kinds: { man: 4, elder: 1, woman: 2, child: 1 }, acts: ["work", "work", "talk"], slow: true },
  { x: 750, z: 590, r: 60, n: 5, kinds: { child: 3, woman: 2 }, acts: ["talk"] },
  { x: 1712, z: 806, r: 120, n: 26, kinds: { man: 5, elder: 2, woman: 3, child: 2, visitor: 1 }, acts: ["talk", "talk", "idle"], bare: true },
  { x: 1872, z: 1307, r: 80, n: 3, kinds: { visitor: 2, man: 1 }, acts: ["look", "point"], focus: [1872, 1307, 15] },
];

// horses and donkeys: [kind, saddled, rider]; tether = they stay where they are
const HERDS = [
  // saddled and waiting for visitors in front of the Great Buddha
  { x: 22, z: 88, r: 10, tether: true, keep: true, bare: true, animals: [["horse", true], ["horse", true], ["donkey", true]] },
  { x: 640, z: 330, r: 100, animals: [["horse"], ["horse"], ["horse", true], ["horse"], ["donkey"], ["donkey"]] },
  { x: 750, z: 590, r: 50, animals: [["horse"], ["horse", true]] },
  { x: 1712, z: 806, r: 110, bare: true, animals: [["donkey", true], ["donkey"], ["donkey", true], ["horse", true]] },
  { x: 700, z: 350, r: 260, animals: [["horse", true, true], ["horse", true, true]] },
  { x: 1650, z: 850, r: 170, animals: [["horse", true, true], ["donkey", true, true]] },
];

const WALK_SPEED = 1.3;
const RIDER_SPEEDS = [1.7, 3.8];

function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rivers and streams from water.json: is (x, z) in or right next to running water?
class Wet {
  constructor(data) {
    this.cells = new Map();
    const C = 40;
    this.C = C;
    for (const line of data?.lines || []) {
      const p = line.points, w = line.width / 2 + 2.5;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const seg = [p[i], p[i + 1], p[i + 2], p[i + 3], w];
        const x0 = Math.floor((Math.min(p[i], p[i + 2]) - w) / C), x1 = Math.floor((Math.max(p[i], p[i + 2]) + w) / C);
        const z0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - w) / C), z1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + w) / C);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            const k = `${cx},${cz}`;
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push(seg);
          }
        }
      }
    }
  }

  test(x, z) {
    const segs = this.cells.get(`${Math.floor(x / this.C)},${Math.floor(z / this.C)}`);
    if (!segs) return false;
    for (const [ax, az, bx, bz, w] of segs) {
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < w) return true;
    }
    return false;
  }
}

class Agent {
  constructor(kind, sub, rnd) {
    this.kind = kind;              // "person" | "horse"
    this.sub = sub;                // man, woman, ... | horse, donkey
    this.pos = new THREE.Vector3();
    this.n = new THREE.Vector3(0, 1, 0);
    this.yaw = rnd() * TAU;
    this.speed = 0;
    this.phase = rnd() * 10;
    this.seed = rnd();
    this.state = "idle";
    this.timer = rnd() * 4;
    this.target = new THREE.Vector3();
    this.act = "idle";
    this.actT = 0;
    this.look = 0;
    this.lookUp = 0;
    this.face = null;              // point to turn toward while acting
    this.greetCool = rnd() * 10;
    this.graze = 0;
    this.air = 0;
    this.vy = 0;
    this.rider = null;             // horse: the person on it
    this.mount = null;             // person: the horse under them
    this.partner = null;           // person: who they are going to talk to
    this.matrix = new THREE.Matrix4();
    this.visible = false;
    this.walkT = 0;
  }
}

export class Crowd {
  // green(x, z): 0..1 how green the ground is (fields, meadows) in the satellite image
  constructor(scene, world, tier, waterData, green = () => 0) {
    this.world = world;
    this.green = green;
    this.tier = tier;
    this.wet = new Wet(waterData);
    this.far = tier.crowdFar;
    this.people = [];
    this.horses = [];
    this.rnd = mulberry(20010312);
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.DOWN = new THREE.Vector3(0, -1, 0);
    this.onHoof = () => {};
    this.spawn();

    const nPeople = this.people.length + 1;   // + the player's figure
    this.peopleMesh = new RigMesh(P.buildPerson(), nPeople, "people");
    this.horseMesh = new RigMesh(Hs.buildHorse(), Math.max(1, this.horses.length), "horses");
    this.shadows = new BlobShadows(nPeople + this.horses.length);
    scene.add(this.peopleMesh.mesh, this.horseMesh.mesh, this.shadows.mesh);

    this.pose = new Pose(P.BONES);
    this.hpose = new Pose(Hs.BONES);
    this.avatar = new Agent("person", "player", this.rnd);
    this.avatar.palette = P.playerDress();
    this.avatar.scale = 1;
    this.hoofPhase = 0;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this.UP = new THREE.Vector3(0, 1, 0);
    this.stats = { people: this.people.length, horses: this.horses.length };
  }

  // ---------------------------------------------------------------- ground queries
  // ground under (x, z) near height y: { y, n } or null
  ground(x, z, y, out) {
    this.ray.set(this._v.set(x, y + 2, z), this.DOWN);
    this.ray.far = 8;
    const hit = this.ray.intersectObjects(this.world.groundOnly, false)[0];
    if (!hit) return false;
    out.y = hit.point.y;
    if (hit.face && out.n) out.n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    return true;
  }

  // height of open, gentle ground at (x, z) away from houses and water (and off the
  // fields if bare), or null
  open(x, z, bare = false) {
    const w = this.world;
    if (bare && this.green(x, z) > 0.25) return null;
    const g = w.groundHeight(x, z, w.groundOnly);
    if (g === null || this.wet.test(x, z)) return null;
    const s = w.groundHeight(x, z, w.solids, g + 30);
    if (s === null || s - g > 0.3) return null;
    for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
      const h = w.groundHeight(x + dx, z + dz, w.solids, g + 10);
      if (h === null || Math.abs(h - g) > 0.8) return null;
    }
    return g;
  }

  // can one walk in a straight line from a to (bx, bz)? returns the height at b or null
  path(a, bx, bz) {
    const w = this.world;
    const d = Math.hypot(bx - a.x, bz - a.z);
    const n = Math.max(1, Math.ceil(d / 2.5));
    let y = a.y;
    for (let i = 1; i <= n; i++) {
      const x = a.x + ((bx - a.x) * i) / n, z = a.z + ((bz - a.z) * i) / n;
      const g = w.groundHeight(x, z, w.groundOnly, y + 8);
      if (g === null || Math.abs(g - y) > (d / n) * 0.6 || this.wet.test(x, z)) return null;
      const s = w.groundHeight(x, z, w.solids, g + 8);
      if (s === null || s - g > 0.3) return null;
      y = g;
    }
    return y;
  }

  // a random open spot within r of (x, z)
  spot(x, z, r, bare = false) {
    for (let i = 0; i < 60; i++) {
      const a = this.rnd() * TAU, d = r * Math.sqrt(this.rnd());
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const y = this.open(px, pz, bare && i < 45);
      if (y !== null) return new THREE.Vector3(px, y, pz);
    }
    return null;
  }

  // ---------------------------------------------------------------- population
  spawn() {
    const rnd = this.rnd;
    const k = this.tier.crowd;
    const pickKind = (kinds) => {
      const total = Object.values(kinds).reduce((a, b) => a + b, 0);
      let x = rnd() * total;
      for (const [name, w] of Object.entries(kinds)) if ((x -= w) < 0) return name;
      return "man";
    };
    const person = (kind, zone) => {
      const a = new Agent("person", kind, rnd);
      a.zone = zone;
      a.palette = P.dress(kind, rnd);
      a.scale = kind === "child" ? 0.58 + rnd() * 0.14 : (kind === "woman" ? 0.92 : 0.96) + rnd() * 0.1;
      a.maxSpeed = (zone?.slow ? 0.9 : WALK_SPEED) * (kind === "child" ? 1.15 : kind === "elder" ? 0.75 : 1) * (0.85 + rnd() * 0.3);
      this.people.push(a);
      return a;
    };

    for (const zone of ZONES) {
      if (zone.focus) {
        const [fx, fz, fh] = zone.focus;
        zone.focusPos = new THREE.Vector3(fx, (this.world.groundHeight(fx, fz) ?? 2510) + fh, fz);
      }
      let n = Math.max(2, Math.round(zone.n * k));
      while (n > 0) {
        // groups of two or three talking, or someone on their own
        const group = zone.acts.includes("talk") && n >= 2 && rnd() < 0.55 ? Math.min(n, rnd() < 0.7 ? 2 : 3) : 1;
        const c = this.spot(zone.x, zone.z, zone.r, zone.bare);
        if (!c) break;
        for (let i = 0; i < group; i++) {
          const a = person(pickKind(zone.kinds), zone);
          if (group > 1) {
            const ang = (i / group) * TAU + rnd() * 0.3;
            a.pos.set(c.x + Math.cos(ang) * 0.75, c.y, c.z + Math.sin(ang) * 0.75);
            a.yaw = yawTo(c.x - a.pos.x, c.z - a.pos.z);
            this.startAct(a, "talk", 20 + rnd() * 50);
          } else {
            a.pos.copy(c);
          }
        }
        n -= group;
      }
    }

    for (const herd of HERDS) {
      const list = herd.keep ? herd.animals : herd.animals.slice(0, Math.max(1, Math.round(herd.animals.length * k)));
      for (const [sub, saddled = false, ridden = false] of list) {
        const c = this.spot(herd.x, herd.z, herd.r, herd.bare);
        if (!c) continue;
        const h = new Agent("horse", sub, rnd);
        h.zone = herd;
        h.pos.copy(c);
        h.home = { x: herd.x, z: herd.z, r: herd.r };
        h.saddled = saddled;
        h.tether = !!herd.tether;
        h.palette = Hs.coat(sub, rnd, saddled);
        h.scale = sub === "donkey" ? 0.68 + rnd() * 0.08 : 0.92 + rnd() * 0.1;
        h.state = rnd() < 0.6 ? "graze" : "idle";
        h.timer = 3 + rnd() * 10;
        h.maxSpeed = 1.4;
        h.bones = Array.from({ length: Hs.BONES }, () => new THREE.Matrix4());
        if (ridden) {
          const r = person(rnd() < 0.8 ? "man" : "elder", null);
          r.mount = h;
          h.rider = r;
          h.maxSpeed = RIDER_SPEEDS[rnd() < 0.6 ? 0 : 1] * (sub === "donkey" ? 0.7 : 1);
          h.state = "idle";
          h.timer = rnd() * 3;
        }
        this.horses.push(h);
      }
    }
    for (const a of this.people) a.home = a.zone ? { x: a.zone.x, z: a.zone.z, r: a.zone.r } : null;
    this.all = [...this.people, ...this.horses];
  }

  // a horse the player got off: it stays around here, grazing
  release(h) {
    h.ridden = false;
    h.tether = true;
    h.home = { x: h.pos.x, z: h.pos.z, r: 10 };
    h.speed = 0;
    h.air = 0;
    h.state = "idle";
    h.timer = 6 + this.rnd() * 6;
  }

  startAct(a, act, time, face = null) {
    a.state = "act";
    a.act = act;
    a.actT = 0;
    a.timer = time;
    a.face = face;
    a.speed = 0;
  }

  // ---------------------------------------------------------------- per frame
  // player: the Player; sun: direction to the sun; eye: camera position
  update(dt, t, player, sun, eye) {
    this.budget = 3;             // path checks this frame
    this.listener = eye;
    const far2 = this.far * this.far;
    const pf = player.feet;
    const onFoot = player.mode === "walk";

    // the horse the player rides follows the player
    const ridden = player.mount;
    if (ridden) {
      const prev = ridden.phase;
      ridden.pos.copy(pf);
      ridden.yaw = player.bodyYaw;
      ridden.speed = player.rideSpeed;
      ridden.phase += (ridden.speed * dt) / (Hs.strideOf(ridden.speed) * ridden.scale);
      ridden.air += ((player.onGround ? 0 : 1) - ridden.air) * Math.min(1, dt * 8);
      ridden.vy = player.vel.y;
      ridden.graze = 0;
      ridden.look = clamp(wrap(player.lookYaw - ridden.yaw), -0.7, 0.7) * 0.5;
      if (player.onGround) {
        const beats = Hs.hoofBeats(prev, ridden.phase, ridden.speed);
        for (let i = 0; i < beats; i++) this.onHoof(1, ridden.speed);
      }
      this.ground(pf.x, pf.z, pf.y, { y: 0, n: ridden.n });
    }

    for (const h of this.horses) {
      h.near = h.pos.distanceToSquared(eye) < far2;
      if (h === ridden || !h.near) continue;
      this.think(h, dt, t, pf, onFoot);
    }
    for (const a of this.people) {
      a.near = !a.mount && a.pos.distanceToSquared(eye) < far2;
      if (a.near) this.think(a, dt, t, pf, onFoot);
    }
    this.separate();
    this.draw(dt, t, player, sun);
  }

  think(a, dt, t, pf, onFoot) {
    const rnd = this.rnd;
    a.greetCool -= dt;
    a.timer -= dt;
    a.actT += dt;
    const dxp = pf.x - a.pos.x, dzp = pf.z - a.pos.z;
    const dp = Math.hypot(dxp, dzp);
    const toPlayer = wrap(yawTo(dxp, dzp) - a.yaw);
    const person = a.kind === "person";

    // notice the player: look, and now and then stop, turn and wave
    let lookWant = 0;
    if (onFoot && dp < (person ? 8 : 6) && Math.abs(pf.y - a.pos.y) < 3 && Math.abs(toPlayer) < 2.2) lookWant = toPlayer;
    if (person && onFoot && dp < 3.6 && a.greetCool <= 0 && (a.state === "idle" || a.state === "walk")) {
      a.greetCool = 30 + rnd() * 30;
      this.startAct(a, rnd() < 0.65 ? "wave" : "idle", 3.2, pf.clone());
    }
    if (a.state === "act" && a.act === "look" && a.zone?.focusPos) {
      const f = a.zone.focusPos;
      lookWant = wrap(yawTo(f.x - a.pos.x, f.z - a.pos.z) - a.yaw);
      a.lookUp += (clamp(Math.atan2(f.y - a.pos.y - 1.6, Math.hypot(f.x - a.pos.x, f.z - a.pos.z)), 0, 0.5) - a.lookUp) * Math.min(1, dt * 2);
    } else a.lookUp *= Math.max(0, 1 - dt * 2);
    a.look += (clamp(lookWant, -1.1, 1.1) - a.look) * Math.min(1, dt * 3);

    if (a.face) this.turn(a, yawTo(a.face.x - a.pos.x, a.face.z - a.pos.z), 2.5, dt);

    if (a.state === "walk") {
      this.walk(a, dt, dp, toPlayer);
    } else {
      a.speed += (0 - a.speed) * Math.min(1, dt * 4);
      if (a.speed > 0.02) this.step(a, dt);
      if (a.timer <= 0) this.next(a);
    }
    if (!person) a.graze += ((a.state === "graze" ? 1 : 0) - a.graze) * Math.min(1, dt * 1.2);
  }

  // what to do next
  next(a) {
    const rnd = this.rnd;
    a.face = null;
    a.act = "idle";
    if (a.partner) {
      // arrived next to someone: talk to each other
      const b = a.partner;
      a.partner = null;
      if (b.state === "wait" && b.pos.distanceTo(a.pos) < 2.5) {
        const time = 12 + rnd() * 30;
        this.startAct(a, "talk", time, b.pos.clone());
        this.startAct(b, "talk", time, a.pos.clone());
        return;
      }
    }
    if (a.kind === "horse") {
      if (a.rider || (!a.tether && rnd() < 0.45)) {
        if (this.pickTarget(a, a.rider ? 1 : 0.12)) return;
      }
      a.state = a.rider ? "idle" : (rnd() < 0.7 ? "graze" : "idle");
      a.timer = a.rider ? 4 + rnd() * 10 : 6 + rnd() * 18;
      return;
    }
    const z = a.zone;
    const r = rnd();
    if (r < 0.5 && this.pickTarget(a, 1)) return;
    if (z && r < 0.85) {
      const act = z.acts[Math.floor(rnd() * z.acts.length)];
      if (act === "talk") {
        // walk over to someone standing around and talk with them
        const b = this.people.find((p) => p !== a && p.zone === z && p.state === "idle" && !p.partner
          && p.pos.distanceTo(a.pos) < 14 && p.pos.distanceTo(a.pos) > 1.5);
        if (b && this.budget > 0) {
          const d = this._v.copy(a.pos).sub(b.pos).setY(0).normalize();
          const tx = b.pos.x + d.x * 1.0, tz = b.pos.z + d.z * 1.0;
          this.budget--;
          const y = this.path(a.pos, tx, tz);
          if (y !== null) {
            a.target.set(tx, y, tz);
            a.state = "walk";
            a.walkT = 0;
            a.partner = b;
            b.state = "wait";
            b.timer = 20;
            b.face = a.pos;
            b.speed = 0;
            return;
          }
        }
      } else if (act !== "idle") {
        const face = act === "look" || act === "point" ? z.focusPos : null;
        this.startAct(a, act === "point" && rnd() < 0.5 ? "look" : act,
          act === "work" ? 15 + rnd() * 40 : act === "point" ? 4 : 6 + rnd() * 12, face);
        return;
      }
    }
    a.state = "idle";
    a.timer = 3 + rnd() * 9;
  }

  // a new walking target near home; frac = how far across the home area to look
  pickTarget(a, frac) {
    if (this.budget <= 0) {
      a.timer = 0.2;
      return false;
    }
    this.budget--;
    const home = a.home;
    if (!home) return false;
    const rnd = this.rnd;
    const r = home.r * frac;
    let x, z;
    if (frac < 1) {
      // a few steps from here, staying at home
      const ang = rnd() * TAU, d = 3 + rnd() * Math.max(4, r);
      x = a.pos.x + Math.cos(ang) * d;
      z = a.pos.z + Math.sin(ang) * d;
      if (Math.hypot(x - home.x, z - home.z) > home.r) {
        x = a.pos.x + (home.x - a.pos.x) * 0.2;
        z = a.pos.z + (home.z - a.pos.z) * 0.2;
      }
    } else {
      const ang = rnd() * TAU, d = home.r * Math.sqrt(rnd());
      x = home.x + Math.cos(ang) * d;
      z = home.z + Math.sin(ang) * d;
      // don't cross the whole bazaar in one go
      const far = Math.hypot(x - a.pos.x, z - a.pos.z);
      if (far > 60) {
        x = a.pos.x + ((x - a.pos.x) * 60) / far;
        z = a.pos.z + ((z - a.pos.z) * 60) / far;
      }
    }
    const y = a.zone?.bare && this.green(x, z) > 0.25 ? null : this.path(a.pos, x, z);
    if (y === null) {
      a.state = "idle";
      a.timer = 0.5 + rnd();
      return false;
    }
    a.target.set(x, y, z);
    a.state = "walk";
    a.walkT = 0;
    return true;
  }

  turn(a, want, rate, dt) {
    const d = wrap(want - a.yaw);
    a.yaw = wrap(a.yaw + clamp(d, -rate * dt, rate * dt));
    return d;
  }

  walk(a, dt, dp, toPlayer) {
    const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    a.walkT += dt;
    if (d < 0.35 || a.walkT > d / (a.maxSpeed * 0.3) + 12) {
      a.state = "idle";
      a.timer = a.partner ? 0 : 1 + this.rnd() * 5;
      return;
    }
    const diff = this.turn(a, yawTo(dx, dz), a.kind === "horse" ? 1.6 : 3, dt);
    let want = a.maxSpeed * Math.max(0, Math.cos(diff)) * Math.min(1, d / 1.2 + 0.3);
    // wait for the player to get out of the way
    const reach = a.kind === "horse" ? 3.5 : 1.6;
    if (dp < reach && Math.abs(toPlayer) < 0.9) want = 0;
    a.speed += (want - a.speed) * Math.min(1, dt * (a.kind === "horse" ? 1.5 : 4));
    this.step(a, dt);
  }

  step(a, dt) {
    const s = a.speed * dt;
    a.pos.x -= Math.sin(a.yaw) * s;
    a.pos.z -= Math.cos(a.yaw) * s;
    const g = { y: a.pos.y, n: a.n };
    if (this.ground(a.pos.x, a.pos.z, a.pos.y, g)) a.pos.y = g.y;
    const prev = a.phase;
    if (a.kind === "horse") {
      a.phase += s / (Hs.strideOf(a.speed) * a.scale);
      if (a.rider) {
        const beats = Hs.hoofBeats(prev, a.phase, a.speed);
        if (beats && this.listener) {
          const d = a.pos.distanceTo(this.listener);
          if (d < 35) for (let i = 0; i < beats; i++) this.onHoof(Math.max(0, 1 - d / 35) ** 2 * 0.6, a.speed);
        }
      }
    }
  }

  // people and animals don't walk through each other
  separate() {
    const list = this.all;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.near || a.mount || a.state !== "walk") continue;
      const ra = a.kind === "horse" ? 0.8 * a.scale : 0.3;
      for (let j = 0; j < list.length; j++) {
        const b = list[j];
        if (b === a || !b.near || b.mount || b === a.partner) continue;
        const rb = b.kind === "horse" ? 0.8 * b.scale : 0.3;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const d2 = dx * dx + dz * dz, min = ra + rb;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (min - d) * 0.5;
          a.pos.x += (dx / d) * push;
          a.pos.z += (dz / d) * push;
        }
      }
    }
  }

  // keep the player out of people and horses (the player's feet, after moving)
  pushPlayer(player) {
    if (player.mode === "fly") return;
    const pf = player.feet;
    const riding = player.mode === "ride";
    const pc = riding ? [[0.55, 0.5], [-0.55, 0.5]] : [[0, 0.32]];
    const fx = -Math.sin(player.bodyYaw), fz = -Math.cos(player.bodyYaw);
    const test = (ax, az, ar) => {
      for (const [o, pr] of pc) {
        const px = pf.x + fx * o, pz = pf.z + fz * o;
        const dx = px - ax, dz = pz - az;
        const d = Math.hypot(dx, dz), min = pr + ar;
        if (d < min && d > 1e-4) {
          pf.x += (dx / d) * (min - d);
          pf.z += (dz / d) * (min - d);
        }
      }
    };
    for (const a of this.people) {
      if (a.mount || !a.near || Math.abs(a.pos.y - pf.y) > 2 || a.pos.distanceToSquared(pf) > 16) continue;
      test(a.pos.x, a.pos.z, 0.28 * a.scale);
    }
    for (const h of this.horses) {
      if (h === player.mount || !h.near || Math.abs(h.pos.y - pf.y) > 2.5 || h.pos.distanceToSquared(pf) > 25) continue;
      const hx = -Math.sin(h.yaw), hz = -Math.cos(h.yaw);
      for (const o of [0.6, -0.5]) test(h.pos.x + hx * o * h.scale, h.pos.z + hz * o * h.scale, 0.42 * h.scale);
    }
  }

  // the nearest saddled horse nobody is riding, within reach of the player
  mountable(pf, reach = 2.8) {
    let best = null, bd = reach;
    for (const h of this.horses) {
      if (!h.saddled || h.rider || h.ridden || !h.near || Math.abs(h.pos.y - pf.y) > 1.5) continue;
      // measure to the middle of the horse's side
      const d = Math.hypot(h.pos.x - pf.x, h.pos.z - pf.z);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- drawing
  draw(dt, t, player, sun) {
    const pm = this.peopleMesh, hm = this.horseMesh, sh = this.shadows;
    const sunK = 0.5 * THREE.MathUtils.smoothstep(sun.y, 0.02, 0.2);
    pm.begin();
    hm.begin();
    sh.begin();

    for (const h of this.horses) {
      h.visible = h.near || h === player.mount;
      if (!h.visible) continue;
      Hs.horsePose(this.hpose, { phase: h.phase, speed: h.speed, t, seed: h.seed, graze: h.graze, air: h.air, vy: h.vy, look: h.look });
      hm.solve(this.hpose, h.bones);
      h.matrix.compose(h.pos, this._q.setFromAxisAngle(this.UP, h.yaw), this._s.setScalar(h.scale));
      hm.push(h.matrix, h.bones, h.palette);
      sh.push(h.pos, h.n, h.yaw, 2.0 * h.scale, 0.75 * h.scale, (h.rider || h.ridden ? 2.4 : 1.6) * h.scale, sun, sunK);
    }

    for (const a of this.people) {
      if (a.mount) {
        if (!a.mount.visible) continue;
        this.rider(a, a.mount, t, 0);
      } else {
        if (!a.near) continue;
        a.phase += (a.speed * dt * TAU) / (1.45 * a.scale);
        P.personPose(this.pose, { phase: a.phase, speed: a.speed / a.scale, t, seed: a.seed, act: a.state === "act" ? a.act : "idle",
          actT: a.actT, look: a.look, lookUp: a.lookUp });
        a.matrix.compose(a.pos, this._q.setFromAxisAngle(this.UP, a.yaw), this._s.setScalar(a.scale));
        pm.push(a.matrix, pm.solve(this.pose), a.palette);
        sh.push(a.pos, a.n, a.yaw, 0.45 * a.scale, 0.45 * a.scale, 1.7 * a.scale, sun, sunK);
      }
    }

    // the player's own figure
    const av = this.avatar;
    const third = player.view === "third" && player.mode !== "fly";
    if (player.mount) {
      this.rider(av, player.mount, t, wrap(player.lookYaw - player.bodyYaw), !third);
    } else if (third) {
      const hs = Math.hypot(player.vel.x, player.vel.z);
      av.air += ((player.onGround ? 0 : 1) - av.air) * Math.min(1, dt * 10);
      if (player.onGround) av.phase += (hs * dt * TAU) / (1.45 + 1.15 * THREE.MathUtils.smoothstep(hs, 2.2, 4.5) + 1.6 * THREE.MathUtils.smoothstep(hs, 6, 11));
      P.personPose(this.pose, { phase: av.phase, speed: hs, t, seed: 0, act: "idle", actT: 0, air: av.air,
        look: clamp(wrap(player.lookYaw - player.bodyYaw), -1, 1) * 0.6, lookUp: clamp(player.lookPitch, -0.4, 0.4) * 0.5 });
      av.matrix.compose(player.feet, this._q.setFromAxisAngle(this.UP, player.bodyYaw), this._s.setScalar(1));
      pm.push(av.matrix, pm.solve(this.pose), av.palette);
      const g = { y: player.feet.y, n: av.n };
      if (!this.ground(player.feet.x, player.feet.z, player.feet.y, g)) av.n.set(0, 1, 0);
      if (player.feet.y - g.y < 4) {
        sh.push(this._v.set(player.feet.x, g.y, player.feet.z), av.n, player.bodyYaw, 0.45, 0.45, 1.7, sun, sunK);
      }
    }
    pm.end();
    hm.end();
    sh.end();
  }

  // a person on horse h: placed on the saddle, following the horse's body
  rider(a, h, t, look, hidden = false) {
    const lean = THREE.MathUtils.smoothstep(h.speed, 6, 13);
    P.personPose(this.pose, { ride: true, t, seed: a.seed, act: "idle", actT: 0, look,
      rideLean: lean, rideBob: -0.04 * Math.sin(h.phase * TAU * 2) * THREE.MathUtils.smoothstep(h.speed, 1, 4),
      rideRise: 0.05 * lean });
    const rs = a.scale / h.scale;
    this._m.makeTranslation(Hs.SADDLE.x, Hs.SADDLE.y, Hs.SADDLE.z);
    this._m2.makeScale(rs, rs, rs);
    this._m.multiply(this._m2);
    this._m2.makeTranslation(0, -P.SEAT, 0);
    this._m.multiply(this._m2);
    a.matrix.multiplyMatrices(h.matrix, h.bones[0]).multiply(this._m);
    // where the rider's eyes are, for the first-person view from the saddle
    this._eye.set(0, P.EYE, -0.07).applyMatrix4(a.matrix);
    if (!hidden) this.peopleMesh.push(a.matrix, this.peopleMesh.solve(this.pose), a.palette);
  }

  // eye position of the player on horseback (world), valid after update()
  get riderEye() {
    return this._eye;
  }
}
