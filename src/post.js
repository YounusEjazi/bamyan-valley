// Render pipeline: the scene goes into an HDR target (MSAA per tier, float depth so the
// reversed depth buffer keeps kilometres of terrain free of z-fighting without a
// logarithmic depth buffer), then one full-screen pass does light shafts from the sun,
// glare, white balance, tone mapping (Khronos PBR Neutral) and a filmic grade: saturation, S-curve, vignette, grain.
// The internal resolution adapts to the frame rate.
import * as THREE from "three";

const FINAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tColor, tDepth;
uniform float uSkyDepth, uAspect, uTime;
uniform vec2 uSunUV;
uniform float uSunVis, uRays;
uniform vec3 uSunTint;
uniform float uExposure, uSaturation, uContrast, uVignette, uGrain;
uniform vec3 uWhite;
varying vec2 vUv;

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
float isSky( vec2 uv ) { return abs( texture2D( tDepth, uv ).x - uSkyDepth ) < 1e-7 ? 1.0 : 0.0; }

void main() {
  vec3 col = texture2D( tColor, vUv ).rgb;
  if ( uSunVis > 0.001 ) {
    vec2 toSun = uSunUV - vUv;
    float sunDist = length( toSun * vec2( uAspect, 1.0 ) );
    #if RAY_SAMPLES > 0
      // light shafts: march toward the sun, counting open sky
      vec2 stepUV = toSun * ( 0.9 / float( RAY_SAMPLES ) );
      vec2 p = vUv + stepUV * hash( gl_FragCoord.xy + fract( uTime ) * 61.0 );
      float lit = 0.0, w = 1.0, wsum = 0.0;
      for ( int i = 0; i < RAY_SAMPLES; i ++ ) {
        lit += isSky( p ) * w;
        wsum += w;
        w *= 0.93;
        p += stepUV;
      }
      lit /= wsum;
      col += uSunTint * ( lit * lit ) * exp( - sunDist * 2.2 ) * uRays * uSunVis;
    #endif
    // glare around the visible sun
    float open = 0.2 * ( isSky( uSunUV ) + isSky( uSunUV + vec2( 0.012, 0.0 ) ) + isSky( uSunUV - vec2( 0.012, 0.0 ) )
      + isSky( uSunUV + vec2( 0.0, 0.02 ) ) + isSky( uSunUV - vec2( 0.0, 0.02 ) ) );
    col += uSunTint * open * uSunVis * ( exp( - sunDist * 9.0 ) * 0.6 + exp( - sunDist * 2.5 ) * 0.12 );
  }
  col *= uExposure * uWhite;
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = max( mix( vec3( l ), col, uSaturation ), 0.0 );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 c = clamp( gl_FragColor.rgb, 0.0, 1.0 );
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), uContrast );
  vec2 vq = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  c *= mix( 1.0, smoothstep( 1.3, 0.25, length( vq ) ), uVignette );
  c += ( hash( gl_FragCoord.xy + fract( uTime * 7.13 ) * 97.0 ) - 0.5 ) * uGrain;
  gl_FragColor.rgb = c;
}`;

export class Pipeline {
  constructor(renderer, tier) {
    this.renderer = renderer;
    this.tier = tier;
    this.maxScale = tier.scale;
    this.scale = tier.scale;
    this.size = new THREE.Vector2(1, 1);
    this.reversed = renderer.capabilities.reversedDepthBuffer;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: tier.msaa,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    this.uniforms = {
      tColor: { value: this.rt.texture },
      tDepth: { value: this.rt.depthTexture },
      uSkyDepth: { value: this.reversed ? 0 : 1 },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uSunUV: { value: new THREE.Vector2() },
      uSunVis: { value: 0 },
      uRays: { value: 0.55 },
      uSunTint: { value: new THREE.Color(1, 0.85, 0.65) },
      uExposure: { value: 1.0 },
      uWhite: { value: new THREE.Vector3(1.05, 1.0, 0.92) },   // warm white balance
      uSaturation: { value: 1.1 },
      uContrast: { value: 0.22 },
      uVignette: { value: 0.35 },
      uGrain: { value: 0.022 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FINAL_VERT,
      fragmentShader: FINAL_FRAG,
      defines: { RAY_SAMPLES: tier.rays },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.frames = 0;
    this.elapsed = 0;
    this.holdOff = 3;       // seconds before adapting (shader compiles, first shadows)
    this._v = new THREE.Vector3();
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.size.set(w, h);
    this.rt.setSize(Math.max(1, Math.round(w * pr * this.scale)), Math.max(1, Math.round(h * pr * this.scale)));
    this.uniforms.uAspect.value = w / h;
  }

  // lower the internal resolution when frames are slow, raise it again when there is room
  adapt(dt) {
    if (this.holdOff > 0) {
      this.holdOff -= dt;
      return;
    }
    if (dt > 0.25) return;  // a hitch (tab switch, shadow update), not a trend
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 1.5) return;
    const ms = (this.elapsed / this.frames) * 1000;
    this.frames = 0;
    this.elapsed = 0;
    let s = this.scale;
    if (ms > 25) s = Math.max(this.tier.minScale, s - (ms > 40 ? 0.15 : 0.08));
    else if (ms < 17.5) s = Math.min(this.maxScale, s + 0.05);
    if (s !== this.scale) {
      this.scale = s;
      this.setSize(this.size.x, this.size.y);
    }
  }

  pause(seconds = 2) {
    this.holdOff = Math.max(this.holdOff, seconds);
  }

  // sun position on screen for shafts and glare
  updateSun(camera, sunDir, sunElevation) {
    const u = this.uniforms;
    const v = this._v.copy(camera.position).addScaledVector(sunDir, 10000).project(camera);
    const inFront = camera.getWorldDirection(this._v.clone()).dot(sunDir) > 0.05;
    u.uSunUV.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(v.x), Math.abs(v.y));
    u.uSunVis.value = inFront
      ? THREE.MathUtils.smoothstep(1.6 - off, 0, 0.6) * THREE.MathUtils.smoothstep(sunElevation, -1, 6)
      : 0;
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    this.uniforms.uTime.value += dt;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }
}
