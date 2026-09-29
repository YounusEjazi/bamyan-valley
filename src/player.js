// First-person explorer: walk (WASD, Shift run, Space jump) or fly (F to toggle,
// Space/E up, C/Q down, Shift fast). Touch controls feed the same input (see touch.js).
// Collides with terrain, cliff and buildings via BVH raycasts. The camera has some body:
// smoothed look, step bob and sway, a dip on landing, a wider view when running and a
// bank into turns when flying.
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
    this.mode = "walk";
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
    this.onStep = () => {};
    this.onLand = () => {};
    this._down = new THREE.Vector3(0, -1, 0);

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === "KeyF") this.toggleMode();
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.look(e.movementX, e.movementY);
    });
  }

  look(dx, dy, scale = 1) {
    // slower turning when the view is zoomed in
    const k = this.sensitivity * scale * (this.camera.fov / FOV);
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.55, 1.55);
  }

  toggleMode() {
    this.setMode(this.mode === "walk" ? "fly" : "walk");
  }

  setMode(mode) {
    this.mode = mode;
    this.vel.set(0, 0, 0);
    if (mode === "walk") this.snapToGround();
    this.onModeChange(mode);
  }

  place(pos, lookAt, mode = "walk") {
    this.feet.copy(mode === "walk" ? this.findClearSpot(pos.x, pos.z) : pos);
    if (lookAt) {
      const d = lookAt.clone().sub(mode === "walk" ? this.feet.clone().setY(this.feet.y + EYE) : this.feet);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    this.lookYaw = this.yaw;
    this.lookPitch = this.pitch;
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

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.mode === "fly") this.updateFly(dt);
    else this.updateWalk(dt);
    this.updateCamera(dt);
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

  updateWalk(dt) {
    const { f, r } = this.axes();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    if (wish.lengthSq() > 1) wish.normalize();
    const speed = this.running() ? RUN : WALK;
    const accel = this.onGround ? 12 : 3;
    const target = wish.multiplyScalar(speed);
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && (this.keys.has("Space") || this.hold.up)) {
      this.vel.y = JUMP;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    // horizontal move in small steps, sliding along walls
    const move = new THREE.Vector3(this.vel.x * dt, 0, this.vel.z * dt);
    const steps = Math.max(1, Math.ceil(move.length() / 0.5));
    move.divideScalar(steps);
    for (let i = 0; i < steps; i++) this.moveHorizontal(move);

    // vertical: fall / land, walk up small steps
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
    // footsteps: two per bob cycle
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      const before = Math.floor(this.bob / Math.PI);
      this.bob += hs * dt * (this.running() ? 1.25 : 1.75);
      if (Math.floor(this.bob / Math.PI) !== before) this.onStep(hs);
    }
  }

  moveHorizontal(move) {
    const len = move.length();
    if (len < 1e-5) return;
    const dir = move.clone().normalize();
    for (const h of [0.5, 1.3]) {
      const origin = this.feet.clone().setY(this.feet.y + h);
      const hit = this.cast(origin, dir, len + RADIUS);
      if (hit && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (n.y < 0.55) {  // too steep to walk: slide along it
          n.y = 0;
          n.normalize();
          move.addScaledVector(n, -move.dot(n));
          const back = hit.distance - RADIUS;
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
    const g = this.world.groundHeight(this.feet.x, this.feet.z, this.world.solids, this.feet.y + 500);
    if (g !== null && this.feet.y < g + MIN_FLY_CLEARANCE - EYE) this.feet.y = g + MIN_FLY_CLEARANCE - EYE;
  }

  updateCamera(dt) {
    // smoothed look (removes mouse / touch jitter without feeling laggy)
    const a = dt > 0 ? 1 - Math.exp(-dt * 28) : 1;
    const prevYaw = this.lookYaw;
    this.lookYaw += (this.yaw - this.lookYaw) * a;
    this.lookPitch += (this.pitch - this.lookPitch) * a;
    const turn = dt > 0 ? (this.lookYaw - prevYaw) / dt : 0;

    let up = 0, side = 0, rollTarget = 0;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.mode === "walk") {
      const amp = THREE.MathUtils.clamp(hs / WALK, 0, 1.6) * (this.onGround ? 1 : 0.3);
      up = Math.abs(Math.sin(this.bob)) * 0.055 * amp - 0.03 * amp;
      side = Math.sin(this.bob) * 0.028 * amp;
      rollTarget = Math.sin(this.bob) * 0.006 * amp;
      // landing dip: a damped spring
      this.dipVel += (-this.dip * 90 - this.dipVel * 14) * dt;
      this.dip += this.dipVel * dt;
    } else {
      // bank into turns and strafes
      const strafe = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).dot(this.vel) / FLY;
      rollTarget = THREE.MathUtils.clamp(-turn * 0.06 - strafe * 0.05, -0.35, 0.35);
      this.dip = this.dipVel = 0;
    }
    this.roll += (rollTarget - this.roll) * (dt > 0 ? 1 - Math.exp(-dt * 5) : 1);

    // wider view when running or flying fast
    const fast = this.mode === "walk" ? THREE.MathUtils.clamp((hs - WALK) / (RUN - WALK), 0, 1) * 7
      : THREE.MathUtils.clamp((this.vel.length() - FLY) / (FLY_FAST - FLY), 0, 1) * 12;
    this.fov += (FOV + fast - this.fov) * (dt > 0 ? 1 - Math.exp(-dt * 4) : 1);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const cy = Math.cos(this.lookYaw), sy = Math.sin(this.lookYaw);
    this.camera.position.set(this.feet.x + cy * side, this.feet.y + EYE + up + this.dip, this.feet.z - sy * side);
    this.camera.rotation.set(this.lookPitch, this.lookYaw, this.roll, "YXZ");
  }

  heading() {
    // compass heading in degrees, 0 = north, 90 = east
    return ((-this.lookYaw * 180) / Math.PI + 360) % 360;
  }

  speed() {
    return this.vel.length();
  }
}
