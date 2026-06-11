// Shared helpers for Mandatory Vibe Compliance visuals.
import * as THREE from "three";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dpr = (cap) => Math.min(window.devicePixelRatio || 1, cap || 2);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Creates a WebGLRenderer; throws early if context creation fails (host shows CSS fallback).
export function makeRenderer(canvas, o = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas || undefined,
      antialias: o.antialias !== false,
      alpha: o.alpha !== false,
      powerPreference: "high-performance",
    });
  } catch (e) {
    throw new Error("WebGL unavailable: " + (e && e.message));
  }
  if (!renderer.getContext()) {
    renderer.dispose();
    throw new Error("WebGL context creation failed");
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

// Single rAF loop with visibility-pause and internal error trapping.
export class Loop {
  constructor(fn) {
    this.fn = fn;
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this._onVis = () => {
      if (document.hidden) this._halt();
      else if (this.running) this._go();
    };
    document.addEventListener("visibilitychange", this._onVis);
  }
  start() { this.running = true; this._go(); }
  pause() { this.running = false; this._halt(); }
  _go() {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    const tick = (t) => {
      this.raf = requestAnimationFrame(tick);
      const dt = clamp((t - this.last) / 1000, 0, 0.1);
      this.last = t;
      try { this.fn(dt, t / 1000); } catch (e) { console.error("[visuals]", e); this.pause(); }
    };
    this.raf = requestAnimationFrame(tick);
  }
  _halt() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }
  dispose() { this.pause(); document.removeEventListener("visibilitychange", this._onVis); }
}

// Styled HTML tooltip living inside a container.
export function makeTooltip(container) {
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;left:0;top:0;pointer-events:none;z-index:12;padding:8px 12px;border-radius:10px;" +
    "background:rgba(12,9,24,.9);color:#fff;font:12px/1.5 system-ui,sans-serif;border:1px solid rgba(255,255,255,.14);" +
    "max-width:240px;opacity:0;transition:opacity .15s;transform:translate(-50%,-120%);box-shadow:0 6px 24px rgba(0,0,0,.5)";
  container.appendChild(el);
  return {
    show(html, x, y) {
      el.innerHTML = html;
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.opacity = "1";
    },
    hide() { el.style.opacity = "0"; },
    dispose() { el.remove(); },
  };
}

// Hand-rolled orbit state: drag (inertia), wheel zoom, pinch zoom. No OrbitControls dependency.
export function makeOrbit(el, o = {}) {
  const s = {
    theta: o.theta ?? 0.5,
    phi: o.phi ?? 1.1,
    radius: o.radius ?? 100,
    targetRadius: o.radius ?? 100,
    minR: o.minR ?? 20, maxR: o.maxR ?? 300,
    minPhi: o.minPhi ?? 0.2, maxPhi: o.maxPhi ?? Math.PI - 0.2,
    vTheta: 0, vPhi: 0, dragging: false, justDragged: false,
  };
  const ptrs = new Map();
  let lastPinch = 0, moved = 0;
  // "pan-y" on mobile keeps vertical page scroll alive; pinch/drag still reach us.
  el.style.touchAction = o.touchAction || "none";

  const down = (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { s.dragging = true; s.justDragged = false; moved = 0; s.vTheta = 0; s.vPhi = 0; }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
    try { el.setPointerCapture(e.pointerId); } catch {}
  };
  const move = (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      s.theta -= dx * 0.005;
      s.phi = clamp(s.phi - dy * 0.005, s.minPhi, s.maxPhi);
      s.vTheta = -dx * 0.12;
      s.vPhi = -dy * 0.12;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch > 0 && d > 0) s.targetRadius = clamp(s.targetRadius * (lastPinch / d), s.minR, s.maxR);
      lastPinch = d;
    }
  };
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) { s.dragging = false; s.justDragged = moved > 6; }
    if (ptrs.size < 2) lastPinch = 0;
  };
  const wheel = (e) => {
    // plain wheel must keep scrolling the page; zoom only on ctrl+wheel
    // (which is also what desktop trackpads send for pinch gestures)
    if (!e.ctrlKey) return;
    e.preventDefault();
    s.targetRadius = clamp(s.targetRadius * (1 + e.deltaY * 0.0012), s.minR, s.maxR);
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", wheel, { passive: false });

  s.update = (dt) => {
    if (!s.dragging) {
      s.theta += s.vTheta * dt;
      s.phi = clamp(s.phi + s.vPhi * dt, s.minPhi, s.maxPhi);
      const k = Math.exp(-3.2 * dt);
      s.vTheta *= k; s.vPhi *= k;
    }
    s.radius += (s.targetRadius - s.radius) * (1 - Math.exp(-6 * dt));
  };
  s.apply = (camera, target) => {
    const t = target || { x: 0, y: 0, z: 0 };
    camera.position.set(
      t.x + s.radius * Math.sin(s.phi) * Math.sin(s.theta),
      t.y + s.radius * Math.cos(s.phi),
      t.z + s.radius * Math.sin(s.phi) * Math.cos(s.theta)
    );
    camera.lookAt(t.x, t.y, t.z);
  };
  s.dispose = () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("wheel", wheel);
  };
  return s;
}

// Deterministic small PRNG for stable layouts.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
