// First-person explorer: walk (WASD, Shift run, Space jump) or fly (F to toggle,
// Space/E up, C/Q down, Shift fast). Collides with terrain, cliff and buildings via BVH raycasts.
import * as THREE from "three";

const EYE = 1.65;
const RADIUS = 0.4;
const STEP = 0.9;          // highest ledge you can walk up without jumping (m)
const GRAVITY = 22;
const JUMP = 7.5;
const WALK = 4.5, RUN = 11;
const FLY = 45, FLY_FAST = 220;
const MIN_FLY_CLEARANCE = 2;

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.feet = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.mode = "walk";
    this.onGround = false;
    this.keys = new Set();
    this.enabled = false;
    this.sensitivity = 0.0022;
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.bob = 0;
    this.onModeChange = () => {};

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === "KeyF") this.setMode(this.mode === "walk" ? "fly" : "walk");
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (!this.enabled) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.55, 1.55);
    });
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
    this.mode = mode;
    this.vel.set(0, 0, 0);
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

  wishDir() {
    const k = this.keys;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const d = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    return d.lengthSq() > 0 ? d.normalize() : d;
  }

  updateWalk(dt) {
    const k = this.keys;
    const wish = this.wishDir();
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? RUN : WALK;
    const accel = this.onGround ? 14 : 3;
    const target = wish.multiplyScalar(speed);
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && k.has("Space")) {
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
    const hit = this.cast(this.feet.clone().setY(this.feet.y + STEP), new THREE.Vector3(0, -1, 0),
      STEP + Math.max(0, -fall) + 0.3);
    if (hit && this.vel.y <= 0 && hit.point.y >= this.feet.y + fall - 0.05) {
      this.feet.y = hit.point.y;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.feet.y += fall;
      this.onGround = false;
      if (this.vel.y < -60) this.recover();
    }
    // head bob
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bob = this.onGround ? this.bob + hs * dt * 1.8 : this.bob;
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
    const k = this.keys;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? FLY_FAST : FLY;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const u = (k.has("Space") || k.has("KeyE") ? 1 : 0) - (k.has("KeyC") || k.has("KeyQ") ? 1 : 0);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const target = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).add(new THREE.Vector3(0, u, 0));
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);
    this.vel.lerp(target, Math.min(1, 6 * dt));
    this.feet.addScaledVector(this.vel, dt);
    const g = this.world.groundHeight(this.feet.x, this.feet.z, this.world.solids, this.feet.y + 500);
    if (g !== null && this.feet.y < g + MIN_FLY_CLEARANCE - EYE) this.feet.y = g + MIN_FLY_CLEARANCE - EYE;
  }

  updateCamera() {
    const bob = this.mode === "walk" ? Math.sin(this.bob) * 0.04 : 0;
    this.camera.position.set(this.feet.x, this.feet.y + EYE + bob, this.feet.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  heading() {
    // compass heading in degrees, 0 = north, 90 = east
    return ((-this.yaw * 180) / Math.PI + 360) % 360;
  }
}
