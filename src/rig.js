// Instanced, jointed characters: one draw call per kind (people, horses). A character is
// made of simple shapes, each rigidly attached to one bone. Every frame the CPU poses the
// bones of each visible character and writes the bone matrices, with the character's
// colours, into one row of a float texture; the vertex shader reads its row by
// gl_InstanceID. The instance matrix places the character in the world.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { withAtmosphere } from "./atmosphere.js";

// ------------------------------------------------------------------ shapes (rest pose, metres)
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// tapered tube from a to b (radius r0 at a, r1 at b); sx squeezes the cross-section in x
export function tube(a, b, r0, r1, { seg = 8, sx = 1, sz = 1, caps = true } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, !caps);
  g.scale(sx, 1, sz);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _v.copy(B).sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

// ellipsoid, or with theta < PI a cap around +y (rotated by rx about x)
export function ball(c, rx, ry, rz, { w = 10, h = 8, theta = Math.PI, phi0 = 0, phi = Math.PI * 2, tilt = 0 } = {}) {
  const g = new THREE.SphereGeometry(1, w, h, phi0, phi, 0, theta);
  g.scale(rx, ry, rz);
  if (tilt) g.rotateX(tilt);
  g.translate(...c);
  return g;
}

// surface of revolution around y: points [radius, y], squeezed by sx / sz
export function lathe(points, { seg = 12, sx = 1, sz = 1, phi0 = 0, phi = Math.PI * 2, at = [0, 0, 0] } = {}) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phi);
  g.scale(sx, 1, sz);
  g.translate(...at);
  return g;
}

export function box(c, sx, sy, sz, rotX = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rotX) g.rotateX(rotX);
  g.translate(...c);
  return g;
}

export function ring(c, r, t, { seg = 14, rotX = Math.PI / 2 } = {}) {
  const g = new THREE.TorusGeometry(r, t, 6, seg);
  g.rotateX(rotX);
  g.translate(...c);
  return g;
}

// ------------------------------------------------------------------ building a character
export class RigBuilder {
  constructor(slots) {
    this.slots = slots;        // { name: index } colour slots
    this.bones = [];           // { parent, pivot }
    this.parts = [];
  }

  bone(parent, x, y, z) {
    this.bones.push({ parent, pivot: new THREE.Vector3(x, y, z) });
    return this.bones.length - 1;
  }

  // geometry in rest-pose character space, attached to `bone`, painted with colour `slot`
  add(bone, slot, ...geos) {
    for (let g of geos) {
      if (!g.index) g = g.toIndexed?.() ?? g;
      g.deleteAttribute("uv");
      const n = g.attributes.position.count;
      g.setAttribute("aBone", new THREE.Float32BufferAttribute(new Float32Array(n).fill(bone), 1));
      g.setAttribute("aSlot", new THREE.Float32BufferAttribute(new Float32Array(n).fill(this.slots[slot]), 1));
      this.parts.push(g);
    }
  }

  build() {
    const geometry = mergeGeometries(this.parts);
    for (const p of this.parts) p.dispose();
    geometry.computeBoundingSphere();
    return { geometry, bones: this.bones, slotCount: Object.keys(this.slots).length };
  }
}

// A pose: Euler angles (XYZ, radians) per bone plus a translation of the root bone.
export class Pose {
  constructor(bones) {
    this.rot = new Float32Array(bones * 3);
    this.off = new THREE.Vector3();
  }

  set(bone, x = 0, y = 0, z = 0) {
    this.rot[bone * 3] = x;
    this.rot[bone * 3 + 1] = y;
    this.rot[bone * 3 + 2] = z;
    return this;
  }

  add(bone, x = 0, y = 0, z = 0) {
    this.rot[bone * 3] += x;
    this.rot[bone * 3 + 1] += y;
    this.rot[bone * 3 + 2] += z;
    return this;
  }

  clear() {
    this.rot.fill(0);
    this.off.set(0, 0, 0);
    return this;
  }

  // this = mix(this, other, t)
  blend(other, t) {
    if (t <= 0) return this;
    for (let i = 0; i < this.rot.length; i++) this.rot[i] += (other.rot[i] - this.rot[i]) * t;
    this.off.lerp(other.off, t);
    return this;
  }
}

// ------------------------------------------------------------------ drawing many of them
export class RigMesh {
  // kind = RigBuilder.build() result; max = most characters drawn at once
  constructor(kind, max, name) {
    this.bones = kind.bones;
    this.slotCount = kind.slotCount;
    this.max = max;
    const nb = this.bones.length;
    this.width = nb * 4 + this.slotCount;
    this.data = new Float32Array(this.width * max * 4);
    this.texture = new THREE.DataTexture(this.data, this.width, max, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = { uRig: { value: this.texture }, uPalette: { value: nb * 4 } };
    const material = withAtmosphere(
      new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: THREE.DoubleSide }),
      `bamyan-rig-${name}`,
      (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>
            attribute float aBone;
            attribute float aSlot;
            uniform highp sampler2D uRig;
            uniform int uPalette;
            varying vec3 vPaint;`)
          .replace("#include <beginnormal_vertex>", `
            int rigCol = int( aBone + 0.5 ) * 4;
            mat4 rigBone = mat4(
              texelFetch( uRig, ivec2( rigCol, gl_InstanceID ), 0 ),
              texelFetch( uRig, ivec2( rigCol + 1, gl_InstanceID ), 0 ),
              texelFetch( uRig, ivec2( rigCol + 2, gl_InstanceID ), 0 ),
              texelFetch( uRig, ivec2( rigCol + 3, gl_InstanceID ), 0 ) );
            vec4 rigPaint = texelFetch( uRig, ivec2( uPalette + int( aSlot + 0.5 ), gl_InstanceID ), 0 );
            vPaint = rigPaint.rgb;
            vec3 objectNormal = mat3( rigBone ) * normal;`)
          // a slot with alpha 0 is not worn: its triangles collapse to a point
          .replace("#include <begin_vertex>", `
            vec3 transformed = rigPaint.a > 0.5 ? ( rigBone * vec4( position, 1.0 ) ).xyz : vec3( 0.0 );`);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vPaint;")
          .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vPaint;");
      },
    );
    this.mesh = new THREE.InstancedMesh(kind.geometry, material, max);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;     // characters are spread over the whole valley
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.world = Array.from({ length: nb }, () => new THREE.Matrix4());
    this._local = new THREE.Matrix4();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this.count = 0;
  }

  // bone matrices (rest character space -> posed character space) for a pose
  solve(pose, out = this.world) {
    const { rot, off } = pose;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      const L = this._local.makeRotationFromEuler(this._e.set(rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2]));
      // rotate about the pivot: T(p) R T(-p)
      this._p.copy(b.pivot).applyMatrix4(L);
      L.setPosition(b.pivot.x - this._p.x, b.pivot.y - this._p.y, b.pivot.z - this._p.z);
      if (i === 0) {
        const e = L.elements;
        e[12] += off.x;
        e[13] += off.y;
        e[14] += off.z;
      }
      if (b.parent < 0) out[i].copy(L);
      else out[i].multiplyMatrices(out[b.parent], L);
    }
    return out;
  }

  begin() {
    this.count = 0;
  }

  // one character: world placement, solved bone matrices, palette [{ color, on }]
  push(matrix, boneMats, palette) {
    if (this.count >= this.max) return;
    const k = this.count++;
    this.mesh.setMatrixAt(k, matrix);
    const row = k * this.width * 4;
    for (let i = 0; i < boneMats.length; i++) this.data.set(boneMats[i].elements, row + i * 16);
    const pal = row + this.bones.length * 16;
    for (let s = 0; s < this.slotCount; s++) {
      const p = palette[s];
      this.data[pal + s * 4] = p.color.r;
      this.data[pal + s * 4 + 1] = p.color.g;
      this.data[pal + s * 4 + 2] = p.color.b;
      this.data[pal + s * 4 + 3] = p.on ? 1 : 0;
    }
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.texture.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ soft ground shadows
// The sun's shadow map is only redrawn when the player has moved a good way, so moving
// characters get a soft shadow of their own: a quad on the ground, stretched away from
// the sun, that darkens what is under it.
export class BlobShadows {
  constructor(max) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          vUv = position.xz * 2.0;
          vStrength = instanceColor.r;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          float a = 1.0 - smoothstep( 0.3, 1.0, length( vUv ) );
          gl_FragColor = vec4( vec3( 1.0 - a * vStrength ), 1.0 );
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.max = max;
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  begin() {
    this.count = 0;
  }

  // pos on the ground with normal n; body facing yaw; footprint length x width (m) along
  // the body; the shadow of something `height` tall cast by a sun in direction sun
  push(pos, n, yaw, length, width, height, sun, strength) {
    if (this.count >= this.max) return;
    const k = this.count++;
    // horizontal throw of the shadow, away from the sun
    const el = Math.max(sun.y, 0.08);
    const throwLen = Math.min((height / el) * Math.hypot(sun.x, sun.z), 7);
    this._d.set(-sun.x, 0, -sun.z).normalize().multiplyScalar(throwLen);
    // lay the quad along the throw: the footprint's extent along and across it, plus the throw
    const dir = throwLen > 0.01 ? Math.atan2(-this._d.x, -this._d.z) : yaw;
    const c = Math.cos(dir - yaw), s = Math.sin(dir - yaw);
    const L = Math.hypot(length * c, width * s) + throwLen, W = Math.hypot(length * s, width * c);
    this._p.copy(pos).addScaledVector(this._d, 0.5).addScaledVector(n, 0.04);
    this._q.setFromUnitVectors(UP, n);
    this._q2.setFromAxisAngle(UP, dir);
    this._m.compose(this._p, this._q.multiply(this._q2), this._s.set(W, 1, L));
    this.mesh.setMatrixAt(k, this._m);
    this.mesh.instanceColor.setX(k, strength);
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
