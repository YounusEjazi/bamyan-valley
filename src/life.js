// Birds: pigeons wheeling in front of the Buddha niches, swallows skimming the fields and a
// pair of kites soaring high over the valley. One instanced mesh; wings flap (or hold for
// a glide) in the vertex shader, flight paths are smooth loops evaluated on the CPU.
import * as THREE from "three";
import { withAtmosphere } from "./atmosphere.js";

function birdGeometry() {
  // unit wingspan along x, forward = -z; aSpan = 0 at the body .. 1 at the wing tip
  const pos = [], span = [];
  const tri = (a, b, c) => {
    for (const v of [a, b, c]) {
      pos.push(...v);
      span.push(Math.min(1, Math.abs(v[0]) / 0.5));
    }
  };
  tri([0, 0, -0.2], [0.04, 0, 0.1], [-0.04, 0, 0.1]);           // body
  tri([0, 0, 0.08], [0.07, 0, 0.24], [-0.07, 0, 0.24]);         // tail
  for (const s of [1, -1]) {
    tri([0, 0, -0.07], [0.24 * s, 0, -0.06], [0, 0, 0.07]);     // inner wing
    tri([0.24 * s, 0, -0.06], [0.24 * s, 0, 0.05], [0, 0, 0.07]);
    tri([0.24 * s, 0, -0.06], [0.5 * s, 0, 0.02], [0.24 * s, 0, 0.05]);  // outer wing
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aSpan", new THREE.Float32BufferAttribute(span, 1));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

// flock: centre (x, z), height above ground, loop radii, speed, bird size, wing beat
const FLOCKS = [
  { name: "pigeons at the Great Buddha", x: 0, z: 42, h: 42, rx: 60, rz: 24, speed: 12, size: 0.7, beat: 13, share: 0.36, jitter: 14 },
  { name: "pigeons at the Small Buddha", x: 740, z: 10, h: 60, rx: 110, rz: 35, speed: 13, size: 0.7, beat: 13, share: 0.28, jitter: 20 },
  { name: "swallows over the fields", x: 350, z: 650, h: 12, rx: 160, rz: 110, speed: 16, size: 0.36, beat: 18, share: 0.3, jitter: 30 },
  { name: "kites", x: 450, z: 900, h: 320, rx: 280, rz: 200, speed: 9, size: 1.6, beat: 5, share: 0.06, jitter: 60, soar: true },
];

export class Birds {
  constructor(scene, world, total) {
    this.birds = [];
    const rnd = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (const f of FLOCKS) {
      const n = Math.max(f.soar ? 2 : 3, Math.round(total * f.share));
      const ground = world.groundHeight(f.x, f.z) ?? 2520;
      for (let i = 0; i < n; i++) {
        this.birds.push({
          f, ground,
          a0: rnd() * Math.PI * 2,            // position around the loop
          r: 0.75 + rnd() * 0.5,              // own loop size
          dh: (rnd() - 0.5) * f.jitter,       // own height
          seed: rnd() * 100,
          dir: f.soar ? 1 : (rnd() < 0.85 ? 1 : -1) * (f.name.startsWith("pigeons at the Small") ? -1 : 1),
          size: f.size * (0.85 + rnd() * 0.3),
        });
      }
    }
    const geo = birdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(this.birds.length * 2), 2);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aFlap", this.flap);
    const mat = withAtmosphere(
      new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.8, side: THREE.DoubleSide }),
      "bamyan-birds",
      (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aSpan;\nattribute vec2 aFlap;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            // aFlap = (phase, amplitude): the wing rotates up and down about the body,
            // the outer wing lagging a little behind the inner one
            float ang = sin( aFlap.x ) * aFlap.y + 0.12;
            float angTip = sin( aFlap.x - 0.7 ) * aFlap.y * 1.3 + 0.12;
            float a = mix( ang, angTip, smoothstep( 0.45, 1.0, aSpan ) );
            transformed.y += abs( position.x ) * sin( a );
            transformed.x *= cos( a );`);
      },
    );
    this.mesh = new THREE.InstancedMesh(geo, mat, this.birds.length);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.p = new THREE.Vector3();
    this.q = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.rot = new THREE.Quaternion();
    this.bank = new THREE.Quaternion();
    this.look = new THREE.Matrix4();
    this.fwd = new THREE.Vector3(0, 0, -1);
  }

  pos(b, t, out) {
    const f = b.f;
    const w = (f.speed / (f.rx * b.r)) * b.dir;
    const a = b.a0 + t * w;
    // a loop that wanders: radius and height breathe slowly
    const wob = Math.sin(t * 0.21 + b.seed) * 0.18;
    out.set(
      f.x + Math.cos(a) * f.rx * b.r * (1 + wob),
      b.ground + f.h + b.dh + Math.sin(t * 0.37 + b.seed * 3) * f.jitter * 0.3,
      f.z + Math.sin(a) * f.rz * b.r * (1 - wob) + Math.sin(a * 2 + b.seed) * f.rz * 0.15,
    );
    return out;
  }

  update(dt, t) {
    const arr = this.flap.array;
    this.birds.forEach((b, i) => {
      this.pos(b, t, this.p);
      this.pos(b, t + 0.1, this.q);
      const vel = this.q.sub(this.p).divideScalar(0.1);
      // point along the flight path, bank into the turn
      this.look.lookAt(this.p, this.p.clone().add(vel), this.up);
      this.rot.setFromRotationMatrix(this.look);
      const turn = b.dir * b.f.speed / (b.f.rx * b.r);
      this.bank.setFromAxisAngle(this.fwd, THREE.MathUtils.clamp(turn * 3, -0.6, 0.6));
      this.rot.multiply(this.bank);
      this.m.compose(this.p, this.rot, this.s.setScalar(b.size));
      this.mesh.setMatrixAt(i, this.m);
      // flap, with glides; climbing birds flap harder, kites mostly hold their wings
      const glide = b.f.soar ? 0.9 : THREE.MathUtils.smoothstep(Math.sin(t * 0.7 + b.seed * 7), 0.2, 0.8);
      const climb = THREE.MathUtils.clamp(vel.y * 0.2, 0, 0.4);
      arr[i * 2] += dt * b.f.beat * (0.9 + 0.2 * Math.sin(b.seed));
      arr[i * 2 + 1] = (0.75 + climb) * (1 - glide * 0.85);
    });
    this.flap.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
