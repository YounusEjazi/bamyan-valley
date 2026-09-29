// Touch controls: a floating joystick on the left half of the screen (push it to the rim
// to run), drag anywhere on the right half to look, buttons for jump / fly up, fly down,
// walk-fly toggle, journal and pause. Pointer events, so several fingers work at once.
const LOOK_SPEED = 2.4;      // relative to mouse sensitivity, per CSS pixel
const STICK_RADIUS = 56;     // px

export class TouchControls {
  constructor(player, el, { onPause, onJournal }) {
    this.player = player;
    this.el = el;
    this.stick = el.querySelector(".stick");
    this.knob = el.querySelector(".stick-knob");
    this.move = null;        // { id, x0, y0 }
    this.looks = new Map();  // pointerId -> { x, y }

    const zone = el.querySelector(".touch-zone");
    zone.addEventListener("pointerdown", (e) => this.down(e));
    zone.addEventListener("pointermove", (e) => this.moveTo(e));
    zone.addEventListener("pointerup", (e) => this.up(e));
    zone.addEventListener("pointercancel", (e) => this.up(e));
    zone.addEventListener("contextmenu", (e) => e.preventDefault());

    const hold = (id, key) => {
      const b = el.querySelector(id);
      const set = (v) => (e) => {
        e.preventDefault();
        player.hold[key] = v;
        b.classList.toggle("held", v);
      };
      b.addEventListener("pointerdown", set(true));
      b.addEventListener("pointerup", set(false));
      b.addEventListener("pointercancel", set(false));
      b.addEventListener("pointerleave", set(false));
    };
    hold(".t-up", "up");
    hold(".t-down", "down");
    const tap = (id, fn) => el.querySelector(id).addEventListener("click", (e) => { e.preventDefault(); fn(); });
    tap(".t-fly", () => player.toggleMode());
    tap(".t-journal", onJournal);
    tap(".t-pause", onPause);
  }

  setMode(mode) {
    this.el.classList.toggle("flying", mode === "fly");
    this.el.querySelector(".t-up").textContent = mode === "fly" ? "▲" : "Jump";
    this.el.querySelector(".t-fly").textContent = mode === "fly" ? "Walk" : "Fly";
  }

  show(on) {
    this.el.hidden = !on;
    if (!on) this.reset();
  }

  reset() {
    this.move = null;
    this.looks.clear();
    this.player.stick.x = this.player.stick.y = 0;
    this.player.hold.up = this.player.hold.down = false;
    this.stick.classList.remove("active");
  }

  down(e) {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    if (e.clientX < window.innerWidth * 0.45 && !this.move) {
      this.move = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add("active");
      this.knob.style.transform = "translate(-50%, -50%)";
    } else {
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  moveTo(e) {
    if (this.move && e.pointerId === this.move.id) {
      e.preventDefault();
      let dx = e.clientX - this.move.x0, dy = e.clientY - this.move.y0;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        dx *= STICK_RADIUS / d;
        dy *= STICK_RADIUS / d;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // small dead zone, then a gentle curve for fine control
      const k = (v) => Math.sign(v) * Math.max(0, (Math.abs(v) / STICK_RADIUS - 0.12) / 0.88) ** 1.3;
      this.player.stick.x = k(dx);
      this.player.stick.y = -k(dy);
      return;
    }
    const l = this.looks.get(e.pointerId);
    if (!l) return;
    e.preventDefault();
    this.player.look(e.clientX - l.x, e.clientY - l.y, LOOK_SPEED);
    l.x = e.clientX;
    l.y = e.clientY;
  }

  up(e) {
    if (this.move && e.pointerId === this.move.id) {
      this.move = null;
      this.player.stick.x = this.player.stick.y = 0;
      this.stick.classList.remove("active");
    }
    this.looks.delete(e.pointerId);
  }
}
