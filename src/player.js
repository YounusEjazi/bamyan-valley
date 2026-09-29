// The explorer: walk (WASD, Shift run, Space jump), fly (F to toggle, Space/E up, C/Q
// down, Shift fast) or ride a horse (E next to a saddled one; Shift to gallop, Space to
// jump). Seen in first person or, with V, from behind in third person (mouse wheel zooms).
// Touch controls feed the same input (see touch.js). Collides with terrain, cliff and
// buildings via BVH raycasts. The camera has some body: smoothed look, step bob and sway,
// a dip on landing, a wider view when running and a bank into turns when flying.
import * as THREE from "three";

const EYE = 1.65;
const RADIUS = 0.4;
const STEP = 0.9;          // highest ledge you can walk up without jumping (m)
const GRAVITY = 22;
const JUMP = 7.5;
const WALK = 4.5, RUN = 11;
const FLY = 45, FLY_FAST = 220;
const MIN_FLY_CLEARANCE = 2;
const FOV = 70;
// on horseback: canter and gallop (m/s), jump, how far ahead the horse's chest reaches
const CANTER = 7.5, GALLOP = 15, HORSE_JUMP = 6.5, HORSE_REACH = 1.1;
// third-person camera distance behind the head (m), on foot and on horseback
const CAM_WALK = 4.2, CAM_RIDE = 6.5;
const VIEW_KEY = "bamyan.view.v1";

const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

function storedView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "third" ? "third" : "first";
  } catch {
    return "first";
  }
}

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.feet = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.lookYaw = 0;          // smoothed view
    this.lookPitch = 0;
    this.roll = 0;
    this.bodyYaw = 0;          // where the figure (or the horse) faces
    this.mode = "walk";        // walk | fly | ride
    this.view = storedView();  // first | third
    this.mount = null;         // the horse being ridden (crowd.js)
    this.rideSpeed = 0;
    this.rideEye = null;       // the rider's eyes on horseback (world), set by the crowd
    this.zoom = 1;             // third-person distance factor (mouse wheel)
    this.camDist = CAM_WALK;
    this.onGround = false;
    this.keys = new Set();
    // touch input: stick x (right) / y (forward) in -1..1, held buttons
    this.stick = { x: 0, y: 0 };
    this.hold = { up: false, down: false };
    this.enabled = false;
    this.sensitivity = 0.0022;
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.bob = 0;
    this.dip = 0;              // landing dip (m) and its velocity
    this.dipVel = 0;
    this.fov = FOV;
    this.onModeChange = () => {};
    this.onViewChange = () => {};
    this.onDismount = () => {};
    this.onStep = () => {};
    this.onLand = () => {};
    this._down = new THREE.Vector3(0, -1, 0);
    this._t = new THREE.Vector3();
    this._d = new THREE.Vector3();

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === "KeyF") this.toggleMode();
      if (e.code === "KeyV") this.toggleView();
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.look(e.movementX, e.movementY);
    });
    window.addEventListener("wheel", (e) => {
      if (!this.enabled || !this.third()) return;
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 3);
    }, { passive: true });
  }

  // seen from behind (third person applies on foot and on horseback, not in flight)
  third() {
    return this.view === "third" && this.mode !== "fly";
  }

  look(dx, dy, scale = 1) {
    // slower turning when the view is zoomed in
    const k = this.sensitivity * scale * (this.camera.fov / FOV);
    this.yaw -= dx * k;
    const [lo, hi] = this.third() ? [-1.3, 1.1] : [-1.55, 1.55];
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, lo, hi);
  }

  toggleMode() {
    this.setMode(this.mode === "fly" ? "walk" : "fly");
  }

  setMode(mode) {
    if (this.mount && mode !== "ride") this.dismount();
    this.mode = mode;
    this.vel.set(0, 0, 0);
    if (mode === "walk") this.snapToGround();
    this.onModeChange(mode);
  }

  toggleView() {
    this.view = this.view === "first" ? "third" : "first";
    try {
      localStorage.setItem(VIEW_KEY, this.view);
    } catch { /* private mode */ }
    this.bodyYaw = this.mount ? this.bodyYaw : this.yaw;
    this.camDist = 0.5;        // swing out from the head
    this.onViewChange(this.view);
  }

  // climb onto a horse (crowd.js agent) standing within reach
  ride(horse) {
    if (this.mode !== "walk" || this.mount) return;
    this.mount = horse;
    horse.ridden = true;
    this.feet.copy(horse.pos);
    this.bodyYaw = horse.yaw;
    this.rideSpeed = 0;
    this.vel.set(0, 0, 0);
    this.rideEye = null;
    if (!this.third()) this.yaw = this.lookYaw = horse.yaw;
    this.mode = "ride";
    this.onModeChange("ride");
  }

  // get off on the left side if there is room, else the right, behind or in front
  dismount() {
    const h = this.mount;
    if (!h) return;
    this.mount = null;
    const fx = -Math.sin(this.bodyYaw), fz = -Math.cos(this.bodyYaw);
    const o = this.feet.clone().setY(this.feet.y + 1.1);
    const w = this.world;
    let spot = null;
    for (const [side, fwd] of [[-1.3, 0], [1.3, 0], [0, -2.4], [0, 2.4]]) {
      const x = this.feet.x - fz * side + fx * fwd, z = this.feet.z + fx * side + fz * fwd;
      const d = this._d.set(x - this.feet.x, 0, z - this.feet.z);
      const len = d.length();
      if (this.cast(o, d.normalize(), len + RADIUS)) continue;
      const g = w.groundHeight(x, z, w.solids, this.feet.y + 3);
      if (g === null || Math.abs(g - this.feet.y) > 1.2) continue;
      spot = new THREE.Vector3(x, g, z);
      break;
    }
    if (spot) this.feet.copy(spot);
    this.mode = "walk";
    this.vel.set(0, 0, 0);
    this.rideSpeed = 0;
    this.bodyYaw = this.third() ? this.bodyYaw : this.yaw;
    this.snapToGround();
    this.onDismount(h);
    this.onModeChange("walk");
  }

  place(pos, lookAt, mode = "walk") {
    if (this.mount) this.dismount();
    this.feet.copy(mode === "walk" ? this.findClearSpot(pos.x, pos.z) : pos);
    if (lookAt) {
      const d = lookAt.clone().sub(mode === "walk" ? this.feet.clone().setY(this.feet.y + EYE) : this.feet);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    this.lookYaw = this.yaw;
    this.lookPitch = this.pitch;
    this.bodyYaw = this.yaw;
    this.roll = 0;
    this.mode = mode;
    this.vel.set(0, 0, 0);
    this.dip = this.dipVel = 0;
    if (mode === "walk") this.snapToGround();
    this.onModeChange(mode);
    this.updateCamera(0);
  }

  // nearest spot (spiralling out from x, z) on open ground: not on a roof, no wall within 4 m
  findClearSpot(x, z) {
    const w = this.world;
    const dirs = [...Array(8)].map((_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));
    for (let r = 0; r <= 120; r += 4) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const g = w.groundHeight(px, pz, w.groundOnly);
        const s = w.groundHeight(px, pz, w.solids);
        if (g === null || s === null || s - g > 0.3) continue;
        const o = new THREE.Vector3(px, g + 1.2, pz);
        if (dirs.every((d) => !this.cast(o, d, 4))) return new THREE.Vector3(px, g, pz);
      }
    }
    return new THREE.Vector3(x, w.groundHeight(x, z, w.solids) ?? 0, z);
  }

  snapToGround() {
    const y = this.world.groundHeight(this.feet.x, this.feet.z, this.world.solids, this.feet.y + 60);
    const y2 = y ?? this.world.groundHeight(this.feet.x, this.feet.z, this.world.solids);
    if (y2 !== null) this.feet.y = y2;
  }

  cast(origin, dir, far) {
    this.ray.set(origin, dir);
    this.ray.far = far;
    return this.ray.intersectObjects(this.world.solids, false)[0] || null;
  }

  // moves the player; the camera follows in updateCamera() (after the crowd has posed
  // the horse, so the view from the saddle moves with it)
  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.mode === "fly") this.updateFly(dt);
    else if (this.mode === "ride") this.updateRide(dt);
    else this.updateWalk(dt);
  }

  // movement input in -1..1: forward, right, up
  axes() {
    const k = this.keys;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.stick.y;
    const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.stick.x;
    const u = (k.has("Space") || k.has("KeyE") || this.hold.up ? 1 : 0) - (k.has("KeyC") || k.has("KeyQ") || this.hold.down ? 1 : 0);
    return { f: THREE.MathUtils.clamp(f, -1, 1), r: THREE.MathUtils.clamp(r, -1, 1), u };
  }

  running() {
    // Shift, or the touch stick pushed to the rim
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || Math.hypot(this.stick.x, this.stick.y) > 0.92;
  }

  jumping() {
    return this.keys.has("Space") || this.hold.up;
  }

  // desired direction of travel (horizontal, length <= 1) from the input and the view
  wish() {
    const { f, r } = this.axes();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    if (wish.lengthSq() > 1) wish.normalize();
    return wish;
  }

  updateWalk(dt) {
    const wish = this.wish();
    const speed = this.running() ? RUN : WALK;
    const accel = this.onGround ? 12 : 3;
    const target = wish.multiplyScalar(speed);
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && this.jumping()) {
      this.vel.y = JUMP;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    // horizontal move in small steps, sliding along walls
    const move = new THREE.Vector3(this.vel.x * dt, 0, this.vel.z * dt);
    const steps = Math.max(1, Math.ceil(move.length() / 0.5));
    move.divideScalar(steps);
    for (let i = 0; i < steps; i++) this.moveHorizontal(move);
    this.fall(dt);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    // the figure turns to where it walks (third person); in first person it faces the view
    if (!this.third()) this.bodyYaw = this.yaw;
    else if (hs > 0.4) {
      const d = wrap(Math.atan2(-this.vel.x, -this.vel.z) - this.bodyYaw);
      this.bodyYaw = wrap(this.bodyYaw + d * Math.min(1, dt * 12));
    }
    // footsteps: two per bob cycle
    if (this.onGround && hs > 0.5) {
      const before = Math.floor(this.bob / Math.PI);
      this.bob += hs * dt * (this.running() ? 1.25 : 1.75);
      if (Math.floor(this.bob / Math.PI) !== before) this.onStep(hs);
    }
  }

  // On horseback the input says where to go; the horse turns toward it (more slowly the
  // faster it goes) and runs: canter, or gallop with Shift / the stick at its rim.
  updateRide(dt) {
    const wish = this.wish();
    const amount = wish.length();
    // donkeys are smaller and slower
    const k = Math.min(1, this.mount.scale ** 1.5 / 0.88);
    let target = 0;
    if (amount > 0.05) {
      const diff = wrap(Math.atan2(-wish.x, -wish.z) - this.bodyYaw);
      const rate = THREE.MathUtils.lerp(2.4, 1.2, THREE.MathUtils.clamp(this.rideSpeed / GALLOP, 0, 1));
      this.bodyYaw = wrap(this.bodyYaw + THREE.MathUtils.clamp(diff, -rate * dt, rate * dt));
      const top = this.running() ? GALLOP : CANTER * amount;
      target = top * k * THREE.MathUtils.clamp(Math.cos(diff), 0.15, 1);
    }
    const acc = target > this.rideSpeed ? 4.5 : 7;
    this.rideSpeed += THREE.MathUtils.clamp(target - this.rideSpeed, -acc * dt, acc * dt);
    const fx = -Math.sin(this.bodyYaw), fz = -Math.cos(this.bodyYaw);
    this.vel.x = fx * this.rideSpeed;
    this.vel.z = fz * this.rideSpeed;
    if (this.onGround && this.jumping()) {
      this.vel.y = HORSE_JUMP;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    const x0 = this.feet.x, z0 = this.feet.z;
    const move = new THREE.Vector3(this.vel.x * dt, 0, this.vel.z * dt);
    const steps = Math.max(1, Math.ceil(move.length() / 0.5));
    move.divideScalar(steps);
    for (let i = 0; i < steps; i++) this.moveHorizontal(move, HORSE_REACH, [0.7, 1.5]);
    // ran into a wall: the horse stops
    const moved = Math.hypot(this.feet.x - x0, this.feet.z - z0) / dt;
    if (this.onGround && moved < this.rideSpeed - 0.5) this.rideSpeed = Math.max(0, moved);
    this.fall(dt);
  }

  // vertical: fall / land, walk up small steps
  fall(dt) {
    const fall = this.vel.y * dt;
    const hit = this.cast(this.feet.clone().setY(this.feet.y + STEP), this._down, STEP + Math.max(0, -fall) + 0.3);
    if (hit && this.vel.y <= 0 && hit.point.y >= this.feet.y + fall - 0.05) {
      if (!this.onGround && this.vel.y < -4) {
        this.dipVel -= Math.min(-this.vel.y, 20) * 0.12;    // knees give a little
        this.onLand(-this.vel.y);
      }
      this.feet.y = hit.point.y;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.feet.y += fall;
      this.onGround = false;
      if (this.vel.y < -60) this.recover();
    }
  }

  moveHorizontal(move, radius = RADIUS, heights = [0.5, 1.3]) {
    const len = move.length();
    if (len < 1e-5) return;
    const dir = move.clone().normalize();
    for (const h of heights) {
      const origin = this.feet.clone().setY(this.feet.y + h);
      const hit = this.cast(origin, dir, len + radius);
      if (hit && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (n.y < 0.55) {  // too steep to walk: slide along it
          n.y = 0;
          n.normalize();
          move.addScaledVector(n, -move.dot(n));
          const back = hit.distance - radius;
          if (back < 0) this.feet.addScaledVector(n, -back * 0.5);
        }
      }
    }
    this.feet.add(move);
  }

  recover() {
    // fell through the world: put the player back on the surface
    this.feet.y = 8000;
    this.snapToGround();
    this.vel.set(0, 0, 0);
  }

  updateFly(dt) {
    const { f, r, u } = this.axes();
    const speed = this.running() ? FLY_FAST : FLY;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const target = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).add(new THREE.Vector3(0, u, 0));
    if (target.lengthSq() > 1) target.normalize();
    target.multiplyScalar(speed);
    this.vel.lerp(target, Math.min(1, 3.5 * dt));
    this.feet.addScaledVector(this.vel, dt);
    this.bodyYaw = this.yaw;
    const g = this.world.groundHeight(this.feet.x, this.feet.z, this.world.solids, this.feet.y + 500);
    if (g !== null && this.feet.y < g + MIN_FLY_CLEARANCE - EYE) this.feet.y = g + MIN_FLY_CLEARANCE - EYE;
  }

  updateCamera(dt) {
    dt = Math.min(dt, 0.05);
    // smoothed look (removes mouse / touch jitter without feeling laggy)
    const a = dt > 0 ? 1 - Math.exp(-dt * 28) : 1;
    const prevYaw = this.lookYaw;
    this.lookYaw += (this.yaw - this.lookYaw) * a;
    this.lookPitch += (this.pitch - this.lookPitch) * a;
    const turn = dt > 0 ? (this.lookYaw - prevYaw) / dt : 0;
    const third = this.third();

    let up = 0, side = 0, rollTarget = 0;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.mode === "walk") {
      const amp = THREE.MathUtils.clamp(hs / WALK, 0, 1.6) * (this.onGround ? 1 : 0.3) * (third ? 0 : 1);
      up = Math.abs(Math.sin(this.bob)) * 0.055 * amp - 0.03 * amp;
      side = Math.sin(this.bob) * 0.028 * amp;
      rollTarget = Math.sin(this.bob) * 0.006 * amp;
      // landing dip: a damped spring
      this.dipVel += (-this.dip * 90 - this.dipVel * 14) * dt;
      this.dip += this.dipVel * dt;
    } else if (this.mode === "fly") {
      // bank into turns and strafes
      const strafe = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).dot(this.vel) / FLY;
      rollTarget = THREE.MathUtils.clamp(-turn * 0.06 - strafe * 0.05, -0.35, 0.35);
      this.dip = this.dipVel = 0;
    } else {
      this.dipVel += (-this.dip * 60 - this.dipVel * 10) * dt;
      this.dip += this.dipVel * dt;
    }
    this.roll += (rollTarget - this.roll) * (dt > 0 ? 1 - Math.exp(-dt * 5) : 1);

    // wider view when running, galloping or flying fast
    const fast = this.mode === "walk" ? THREE.MathUtils.clamp((hs - WALK) / (RUN - WALK), 0, 1) * 7
      : this.mode === "ride" ? THREE.MathUtils.clamp((this.rideSpeed - CANTER) / (GALLOP - CANTER), 0, 1) * 8
        : THREE.MathUtils.clamp((this.vel.length() - FLY) / (FLY_FAST - FLY), 0, 1) * 12;
    this.fov += (FOV + fast - this.fov) * (dt > 0 ? 1 - Math.exp(-dt * 4) : 1);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const cam = this.camera;
    if (third) {
      this.thirdPerson(dt);
    } else if (this.mode === "ride") {
      // from the saddle, moving with the horse
      if (this.rideEye) cam.position.copy(this.rideEye);
      else cam.position.set(this.feet.x, this.feet.y + 2.35 * this.mount.scale, this.feet.z);
      cam.rotation.set(this.lookPitch, this.lookYaw, this.roll, "YXZ");
    } else {
      const cy = Math.cos(this.lookYaw), sy = Math.sin(this.lookYaw);
      cam.position.set(this.feet.x + cy * side, this.feet.y + EYE + up + this.dip, this.feet.z - sy * side);
      cam.rotation.set(this.lookPitch, this.lookYaw, this.roll, "YXZ");
    }
  }

  // orbit behind the head (over the right shoulder on foot), pulled in by walls and kept
  // above the ground
  thirdPerson(dt) {
    const riding = this.mode === "ride";
    const s = riding ? this.mount.scale : 1;
    const cp = Math.cos(this.lookPitch), sp = Math.sin(this.lookPitch);
    const back = this._d.set(Math.sin(this.lookYaw) * cp, -sp, Math.cos(this.lookYaw) * cp);
    const shoulder = riding ? 0 : 0.45;
    const pivot = this._t.set(
      this.feet.x + Math.cos(this.lookYaw) * shoulder,
      this.feet.y + (riding ? 2.35 * s + 0.2 : 1.6) + this.dip * 0.5,
      this.feet.z - Math.sin(this.lookYaw) * shoulder,
    );
    const want = (riding ? CAM_RIDE : CAM_WALK) * this.zoom;
    const hit = this.cast(pivot, back, want + 0.3);
    const d = hit ? Math.max(0.4, hit.distance - 0.3) : want;
    // snap in when something comes between, ease back out
    this.camDist = d < this.camDist || dt === 0 ? d : this.camDist + (d - this.camDist) * (1 - Math.exp(-dt * 3));
    const cam = this.camera;
    cam.position.copy(pivot).addScaledVector(back, this.camDist);
    const g = this.world.groundHeight(cam.position.x, cam.position.z, this.world.solids, cam.position.y + 30);
    if (g !== null && cam.position.y < g + 0.4) cam.position.y = g + 0.4;
    cam.rotation.set(this.lookPitch, this.lookYaw, 0, "YXZ");
  }

  heading() {
    // compass heading in degrees, 0 = north, 90 = east
    return ((-this.lookYaw * 180) / Math.PI + 360) % 360;
  }

  speed() {
    return this.vel.length();
  }
}
