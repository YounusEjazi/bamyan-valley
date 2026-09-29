// Discoverable places: light beams over undiscovered places, a compass strip, toasts,
// a journal and fast travel. Progress is kept in localStorage (when available).
import * as THREE from "three";

const STORE_KEY = "bamyan.discovered.v1";
const BEAM_HEIGHT = 140;

function loadProgress() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveProgress(set) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode etc.: progress lasts for this visit only */
  }
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.72, 0.35) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
      void main() {
        float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float fade = pow(1.0 - vUv.y, 1.6);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.0 - vUv.y * 12.0);
        gl_FragColor = vec4(uColor * pulse, edge * edge * fade * 0.55);
      }`,
  });
}

export class Discovery {
  constructor(scene, pois, ui) {
    this.pois = pois;
    this.ui = ui;
    this.found = loadProgress();
    this.beams = new Map();
    this.onChange = () => {};
    const geo = new THREE.CylinderGeometry(2.2, 2.2, BEAM_HEIGHT, 12, 1, true).translate(0, BEAM_HEIGHT / 2, 0);
    this.beamMat = beamMaterial();
    for (const p of pois) {
      const beam = new THREE.Mesh(geo, this.beamMat);
      beam.position.set(p.position[0], p.y, p.position[1]);
      beam.visible = !this.found.has(p.id);
      beam.frustumCulled = false;
      beam.renderOrder = 10;
      scene.add(beam);
      this.beams.set(p.id, beam);
    }
    this.lastCheck = 0;
    this.buildCompass();
    this.renderJournal();
    this.updateCounter();
  }

  get count() {
    return this.found.size;
  }

  update(now, playerPos, heading) {
    this.beamMat.uniforms.uTime.value = now / 1000;
    // beams get wider with distance so they stay visible from afar
    for (const [id, beam] of this.beams) {
      if (!beam.visible) continue;
      const d = Math.hypot(beam.position.x - playerPos.x, beam.position.z - playerPos.z);
      const s = THREE.MathUtils.clamp(d / 300, 1, 12);
      beam.scale.set(s, 1, s);
    }
    this.updateCompass(playerPos, heading);
    if (now - this.lastCheck < 250) return;
    this.lastCheck = now;
    for (const p of this.pois) {
      if (this.found.has(p.id)) continue;
      const d = Math.hypot(p.position[0] - playerPos.x, p.position[1] - playerPos.z);
      if (d < p.radius && Math.abs(playerPos.y - p.y) < p.radius + 40) this.discover(p);
    }
  }

  discover(p) {
    this.found.add(p.id);
    saveProgress(this.found);
    this.beams.get(p.id).visible = false;
    this.ui.toast(p, this.found.size, this.pois.length);
    this.renderJournal();
    this.updateCounter();
    this.onChange(p);
  }

  reset() {
    this.found.clear();
    saveProgress(this.found);
    for (const b of this.beams.values()) b.visible = true;
    this.renderJournal();
    this.updateCounter();
  }

  updateCounter() {
    document.getElementById("found-count").textContent = `${this.found.size} / ${this.pois.length}`;
  }

  // ---------------------------------------------------------------- compass
  buildCompass() {
    const strip = document.getElementById("compass-strip");
    strip.innerHTML = "";
    const labels = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
    this.ticks = [];
    for (let a = 0; a < 360; a += 15) {
      const el = document.createElement("div");
      el.className = labels[a] ? "tick major" : "tick";
      el.textContent = labels[a] || "";
      strip.appendChild(el);
      this.ticks.push({ el, a });
    }
    this.markers = this.pois.map((p) => {
      const el = document.createElement("div");
      el.className = "poi-marker";
      strip.appendChild(el);
      return { el, p };
    });
  }

  updateCompass(pos, heading) {
    const strip = document.getElementById("compass-strip");
    const w = strip.clientWidth;
    const fov = 180; // degrees shown across the strip
    const place = (el, bearing) => {
      let rel = ((bearing - heading + 540) % 360) - 180;
      const vis = Math.abs(rel) < fov / 2;
      el.style.display = vis ? "" : "none";
      if (vis) el.style.left = `${(0.5 + rel / fov) * w}px`;
    };
    for (const t of this.ticks) place(t.el, t.a);
    for (const { el, p } of this.markers) {
      const dx = p.position[0] - pos.x, dz = p.position[1] - pos.z;
      const d = Math.hypot(dx, dz);
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const found = this.found.has(p.id);
      if (found && d > 1500) { el.style.display = "none"; continue; }
      place(el, (bearing + 360) % 360);
      const dist = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
      el.classList.toggle("found", found);
      el.innerHTML = found ? `<span>${p.title}</span>` : `<b>◆</b><span>${dist}</span>`;
    }
  }

  // ---------------------------------------------------------------- journal
  renderJournal() {
    const list = document.getElementById("journal-list");
    list.innerHTML = "";
    for (const p of this.pois) {
      const found = this.found.has(p.id);
      const li = document.createElement("li");
      li.className = found ? "found" : "locked";
      if (found) {
        li.innerHTML = `<h3>${p.title}</h3><div class="sub">${p.subtitle}</div><p>${p.text}</p>
          <div class="row"><button data-travel="${p.id}">Travel here</button>
          <a href="${p.source}" target="_blank" rel="noopener">Source</a></div>`;
      } else {
        li.innerHTML = `<h3>Undiscovered</h3><p class="hint">Hint: ${p.hint}</p>`;
      }
      list.appendChild(li);
    }
    document.getElementById("journal-progress").textContent =
      `${this.found.size} of ${this.pois.length} places discovered`;
  }
}
