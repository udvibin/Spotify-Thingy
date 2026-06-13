// The time machine — every track plotted by WHEN IT WAS SHARED (x) vs WHEN
// IT WAS RELEASED (y). The glowing diagonal is the release frontier ("shared
// the day it dropped"); the deeper a star sits below it, the older the track
// was when it hit the chat. Deepest cuts get drop-lines + name tags.
// Person chips dim everyone else and show that boi's time-travel stats.
//
// items: [{ name, artists, by, ts(ISO share), release("YYYY[-MM-DD]"),
//           color, popularity }]
// Standard handle: start/pause/resize/dispose (+focusPerson).
import * as THREE from "three";
import { makeRenderer, Loop, dpr, esc, clamp } from "./common.js";

const W = 100, H = 62;            // fixed world-space plot box
const MX = 7, MY = 7;             // margins for labels (world units)

const yearOf = (iso) => {
  const d = new Date(iso);
  return d.getFullYear() + d.getMonth() / 12 + d.getDate() / 365;
};
const relYear = (rel) => {
  const y = parseFloat(String(rel).slice(0, 4));
  if (!isFinite(y) || y < 1900) return null;
  const m = parseFloat(String(rel).slice(5, 7));
  return y + (isFinite(m) ? (m - 1) / 12 : 0.5);
};

const VERT = /* glsl */ `
attribute float size;
attribute vec3 tint;
attribute float phase;
attribute float fade;
uniform float uTime;
uniform float uScale;
varying vec3 vTint;
varying float vFade;
void main() {
  vTint = tint;
  vFade = fade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.86 + 0.2 * sin(uTime * 1.4 + phase);
  gl_PointSize = size * uScale * tw;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec3 vTint;
varying float vFade;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  float a = smoothstep(1.0, 0.25, d);
  float core = smoothstep(0.45, 0.0, d);
  gl_FragColor = vec4(mix(vTint, vec3(1.0), core * 0.75), a * vFade);
}`;

export async function initTimeMachine(container, items, opts = {}) {
  const renderer = makeRenderer(null, { antialias: false, alpha: true });
  renderer.setPixelRatio(dpr(opts.dprCap));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);
  const dom = renderer.domElement;
  let disposed = false;

  /* data prep */
  const pts = [];
  for (const it of items) {
    const ry = relYear(it.release), sy = yearOf(it.ts);
    if (ry == null || !isFinite(sy)) continue;
    pts.push({ ...it, sy, ry: Math.min(ry, sy), age: Math.max(0, sy - ry) });
  }
  if (!pts.length) throw new Error("time machine: no plottable tracks");
  const sy0 = Math.min(...pts.map((p) => p.sy)) - 0.12;
  const sy1 = Math.max(...pts.map((p) => p.sy)) + 0.12;
  const ry0 = Math.floor(Math.min(...pts.map((p) => p.ry)) / 10) * 10;
  const ry1 = sy1;
  const xw = (s) => MX + ((s - sy0) / (sy1 - sy0)) * (W - MX - 3);
  // power-scaled y: recent years get room, the deep past compresses like
  // depth — without it ~80% of points crush against the top edge
  const YP = 2.6;
  const yw = (r) => MY + Math.pow(clamp((r - ry0) / (ry1 - ry0), 0, 1), YP) * (H - MY - 2.5);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, W, H, 0, -10, 10);
  const group = new THREE.Group();
  scene.add(group);

  /* decade bands + boundary lines */
  const bandGeos = [], bandMats = [];
  for (let dec = ry0; dec < ry1; dec += 10) {
    const a = yw(dec), b = yw(Math.min(dec + 10, ry1));
    const geo = new THREE.PlaneGeometry(W - MX - 3, b - a);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbcd8ff, transparent: true,
      opacity: ((dec / 10) % 2 === 0) ? 0.022 : 0.045,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(MX + (W - MX - 3) / 2, (a + b) / 2, -2);
    group.add(mesh);
    bandGeos.push(geo); bandMats.push(mat);
  }

  /* release frontier: released == shared (a curve under the power scale) */
  const fGeo = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 33 }, (_, k) => {
      const s = sy0 + ((sy1 - sy0) * k) / 32;
      return new THREE.Vector3(xw(s), yw(s), 1);
    }));
  const fMat = new THREE.LineBasicMaterial({
    color: 0xfff3d8, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const frontier = new THREE.Line(fGeo, fMat);
  group.add(frontier);

  /* drop-lines for the deepest cuts */
  const deepest = [...pts].sort((a, b) => b.age - a.age).slice(0, 6);
  const dlArr = new Float32Array(deepest.length * 6);
  deepest.forEach((p, k) => {
    dlArr.set([xw(p.sy), yw(p.sy), 0, xw(p.sy), yw(p.ry), 0], k * 6);
  });
  const dlGeo = new THREE.BufferGeometry();
  dlGeo.setAttribute("position", new THREE.BufferAttribute(dlArr, 3));
  const dlMat = new THREE.LineBasicMaterial({
    color: 0x9db4bd, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dropLines = new THREE.LineSegments(dlGeo, dlMat);
  group.add(dropLines);

  /* the stars */
  const n = pts.length;
  const pos = new Float32Array(n * 3), tint = new Float32Array(n * 3);
  const size = new Float32Array(n), phase = new Float32Array(n), fade = new Float32Array(n);
  const colorCache = {};
  pts.forEach((p, i) => {
    pos.set([xw(p.sy), yw(p.ry), 0], i * 3);
    const c = colorCache[p.color] || (colorCache[p.color] = new THREE.Color(p.color || "#8a93a6"));
    tint.set([c.r, c.g, c.b], i * 3);
    size[i] = 3.3 + 2.9 * Math.sqrt((p.popularity || 30) / 100);
    phase[i] = (i * 2.39996) % (Math.PI * 2);
    fade[i] = 0.9;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
  const fadeAttr = new THREE.BufferAttribute(fade, 1);
  fadeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("fade", fadeAttr);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false;
  group.add(stars);

  /* DOM overlay: axis labels, frontier tag, deep-cut tags, tooltip, chips */
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;z-index:10;pointer-events:none;" +
    "font:11px/1.4 system-ui,sans-serif;color:#9db4bd";
  container.appendChild(overlay);
  const place = (xPct, yPct, html, extra = "") => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${xPct}%;top:${yPct}%;${extra}`;
    d.innerHTML = html;
    overlay.appendChild(d);
    return d;
  };
  const X = (wx) => (wx / W) * 100, Y = (wy) => (1 - wy / H) * 100;

  for (let dec = ry0; dec < ry1; dec += 10)
    place(X(MX) - 1, Y(yw(dec + 5)), `${dec}s`,
      "transform:translate(-100%,-50%);opacity:.55;letter-spacing:.06em");
  for (let y = Math.ceil(sy0); y <= Math.floor(sy1); y++)
    place(X(xw(y)), Y(MY) + 2, String(y), "transform:translateX(-50%);opacity:.55");
  place(X(MX) - 1, Y(yw((ry0 + ry1) / 2)) , "when it was made",
    "transform:translate(-100%,-50%) rotate(180deg);writing-mode:vertical-rl;opacity:.35;letter-spacing:.2em;text-transform:uppercase;font-size:10px;margin-left:-26px");
  place(50, Y(MY) + 6.5, "when it hit the chat",
    "transform:translateX(-50%);opacity:.35;letter-spacing:.2em;text-transform:uppercase;font-size:10px");
  place(X(xw(sy0 + (sy1 - sy0) * 0.45)), Y(yw(sy0 + (sy1 - sy0) * 0.45)) - 3.5,
    "⟋ fresh off the press — shared the day it dropped",
    "transform:translateX(-50%);color:#fff3d8;opacity:.6;font-size:10.5px;letter-spacing:.04em");

  const deepTags = deepest.slice(0, 5).map((p) =>
    place(X(xw(p.sy)) + 0.6, Y(yw(p.ry)) - 0.5,
      `<span style="color:#dfe7ea">${esc(p.name)}</span> <span style="opacity:.6">· ${Math.round(p.ry)} · ${Math.round(p.age)} yrs deep</span>`,
      "white-space:nowrap;font-size:10.5px;text-shadow:0 1px 4px rgba(0,0,0,.9)"));

  /* tooltip */
  const tip = document.createElement("div");
  tip.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:12;padding:8px 12px;" +
    "border-radius:10px;background:rgba(12,9,24,.92);color:#fff;font:12px/1.5 system-ui,sans-serif;" +
    "border:1px solid rgba(255,255,255,.14);max-width:250px;opacity:0;transition:opacity .12s;" +
    "transform:translate(-50%,-130%);box-shadow:0 6px 24px rgba(0,0,0,.5)";
  container.appendChild(tip);

  /* person chips + readout */
  const people = [...new Set(pts.map((p) => p.by))].sort(
    (a, b) => pts.filter((p) => p.by === b).length - pts.filter((p) => p.by === a).length);
  const chipBar = document.createElement("div");
  chipBar.style.cssText = "position:absolute;left:0;right:0;bottom:12px;z-index:11;display:flex;" +
    "flex-wrap:wrap;gap:6px;justify-content:center;padding:0 12px;pointer-events:none";
  container.appendChild(chipBar);
  const readout = document.createElement("div");
  readout.style.cssText = "position:absolute;right:14px;top:12px;z-index:11;max-width:250px;" +
    "padding:8px 12px;border-radius:10px;background:rgba(8,14,20,.66);border:1px solid rgba(255,255,255,.1);" +
    "color:#cfdbe0;font:12px/1.5 system-ui,sans-serif;pointer-events:none";
  container.appendChild(readout);

  let focus = null, sticky = false;
  const chips = {};
  for (const p of people) {
    const col = (opts.personColors && opts.personColors[p]) || pts.find((x) => x.by === p).color || "#8a93a6";
    const chip = document.createElement("button");
    chip.style.cssText = "pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:6px;" +
      "padding:4px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.16);" +
      "background:rgba(8,14,20,.72);color:#dfe7ea;font:600 12px/1.4 system-ui,sans-serif;" +
      "transition:all .15s;user-select:none";
    chip.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${col};flex:none"></span>${esc(p)}`;
    chip.onmouseenter = () => { if (!opts.mobile && !sticky) applyFocus(p); };
    chip.onmouseleave = () => { if (!opts.mobile && !sticky) applyFocus(null); };
    chip.onclick = () => { sticky = !(sticky && focus === p); applyFocus(sticky ? p : null); };
    chipBar.appendChild(chip);
    chips[p] = chip;
  }

  const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const fmtAge = (a) => a < 1 ? `${Math.round(a * 12)} mo` : `${a.toFixed(1)} yrs`;

  function updateReadout() {
    for (const [name, chip] of Object.entries(chips)) {
      chip.style.boxShadow = name === focus ? "0 0 0 1.5px rgba(255,255,255,.55) inset" : "none";
      chip.style.opacity = focus && name !== focus ? 0.55 : 1;
    }
    const set = focus ? pts.filter((p) => p.by === focus) : pts;
    const med = median(set.map((p) => p.age));
    const fresh = set.filter((p) => p.age < 0.25).length;
    const deep = set.reduce((a, b) => (b.age > a.age ? b : a), set[0]);
    readout.innerHTML =
      `<strong style="color:#eee9dd">${focus ? esc(focus) : "the chat"}</strong>` +
      `<div style="opacity:.85;margin-top:2px">${set.length} tracks · median age when shared: <b>${fmtAge(med)}</b></div>` +
      `<div style="opacity:.85">${fresh} shared within 3 months of release</div>` +
      `<div style="opacity:.85">deepest cut: ${esc(deep.name)} (${Math.round(deep.ry)})</div>`;
  }

  function applyFocus(p) {
    focus = p;
    pts.forEach((q, i) => { fade[i] = !p || q.by === p ? 0.95 : 0.06; });
    fadeAttr.needsUpdate = true;
    updateReadout();
  }
  updateReadout();

  /* hover picking: nearest projected point (camera is static, parallax excluded) */
  let screen = null;
  function project() {
    const rect = dom.getBoundingClientRect();
    screen = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      screen[i * 2] = (pos[i * 3] / W) * rect.width;
      screen[i * 2 + 1] = (1 - pos[i * 3 + 1] / H) * rect.height;
    }
  }
  const onMove = (e) => {
    if (!screen) project();
    const rect = dom.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < n; i++) {
      if (focus && pts[i].by !== focus) continue;
      const dx = screen[i * 2] - mx, dy = screen[i * 2 + 1] - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const p = pts[best];
      const col = (opts.personColors && opts.personColors[p.by]) || p.color;
      tip.innerHTML = `<strong style="font-size:13px">${esc(p.name)}</strong>` +
        `<div style="opacity:.7">${esc(p.artists)}</div>` +
        `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">` +
        `<span style="width:7px;height:7px;border-radius:50%;background:${col};flex:none"></span>` +
        `<span>${esc(p.by)}</span></div>` +
        `<div style="opacity:.75;margin-top:3px">released ${Math.round(p.ry)} · shared ${Math.floor(p.sy)}` +
        `${p.age >= 1 ? ` → <b>${fmtAge(p.age)} deep</b>` : " · fresh"}</div>`;
      tip.style.left = mx + "px"; tip.style.top = my + "px"; tip.style.opacity = "1";
      dom.style.cursor = "pointer";
    } else {
      tip.style.opacity = "0";
      dom.style.cursor = "";
    }
  };
  const onLeave = () => { tip.style.opacity = "0"; };
  dom.addEventListener("pointermove", onMove);
  dom.addEventListener("pointerleave", onLeave);

  /* parallax */
  let par = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPar = (e) => {
    const rect = container.getBoundingClientRect();
    par.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 1.6;
    par.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 1.0;
  };
  if (!opts.reducedMotion && !opts.mobile) container.addEventListener("pointermove", onPar);

  const doResize = () => {
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    mat.uniforms.uScale.value = ((container.clientHeight || 600) / 620) * dpr(opts.dprCap);
    screen = null;
  };
  doResize();

  const loop = new Loop((dt, t) => {
    if (!opts.reducedMotion) {
      mat.uniforms.uTime.value = t;
      par.x += (par.tx - par.x) * (1 - Math.exp(-5 * dt));
      par.y += (par.ty - par.y) * (1 - Math.exp(-5 * dt));
      camera.position.x = -par.x; camera.position.y = par.y;
    }
    renderer.render(scene, camera);
  });

  return {
    start() { if (!disposed) loop.start(); },
    pause() { loop.pause(); },
    resize() { if (!disposed) doResize(); },
    focusPerson(p) { sticky = !!p; applyFocus(p || null); },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointermove", onPar);
      overlay.remove(); tip.remove(); chipBar.remove(); readout.remove();
      geo.dispose(); mat.dispose();
      fGeo.dispose(); fMat.dispose(); dlGeo.dispose(); dlMat.dispose();
      bandGeos.forEach((g) => g.dispose()); bandMats.forEach((m) => m.dispose());
      renderer.dispose();
      dom.remove();
    },
  };
}
