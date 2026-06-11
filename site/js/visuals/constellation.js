// 3D taste constellation v2: one glowing node per person, ribbon edges whose
// width AND brightness encode shared-artist similarity with strong nonlinear
// contrast, so the closest taste-twins clearly pop. Hovering / tapping a node
// highlights its edges, dims everything else and shows top partners (plus top
// shared artists when `sim.topArtists` is provided — optional, additive).
// Layout precomputed with a tiny 3D force simulation at init (no per-frame physics).
import * as THREE from "three";
import { makeRenderer, makeTooltip, makeOrbit, Loop, dpr, esc, mulberry32 } from "./common.js";

function forceLayout(M, n) {
  const rng = mulberry32(7);
  const P = new Float32Array(n * 3), F = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) P[i] = (rng() - 0.5) * 12;
  for (let it = 0; it < 150; it++) {
    F.fill(0);
    const step = 0.5 * (1 - it / 160);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
        const d2 = Math.max(dx * dx + dy * dy + dz * dz, 0.01), d = Math.sqrt(d2);
        dx /= d; dy /= d; dz /= d;
        const s = (M[i] && M[i][j]) || 0;
        const desired = 6 + (1 - s) * 16;
        let f = (d - desired) * 0.05 * (0.3 + s) - 18 / d2; // spring minus repulsion
        F[i * 3] += dx * f; F[i * 3 + 1] += dy * f; F[i * 3 + 2] += dz * f;
        F[j * 3] -= dx * f; F[j * 3 + 1] -= dy * f; F[j * 3 + 2] -= dz * f;
      }
      F[i * 3] -= P[i * 3] * 0.012; F[i * 3 + 1] -= P[i * 3 + 1] * 0.012; F[i * 3 + 2] -= P[i * 3 + 2] * 0.012;
    }
    for (let i = 0; i < n * 3; i++) P[i] += F[i] * step;
  }
  let max = 1e-6;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  const k = 13 / max;
  for (let i = 0; i < n * 3; i++) P[i] *= k;
  return P;
}

function glowTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,.95)");
  g.addColorStop(0.42, "rgba(255,255,255,.32)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

function coreTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,.9)");
  g.addColorStop(0.62, "rgba(255,255,255,.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// Name + share-count label, always readable (dark pill behind cream text).
function labelSprite(name, shares, mobile) {
  const cv = document.createElement("canvas");
  const c = cv.getContext("2d");
  const fs = 46, fs2 = 30, pad = 26;
  c.font = `700 ${fs}px system-ui, sans-serif`;
  const w1 = c.measureText(name).width;
  c.font = `500 ${fs2}px system-ui, sans-serif`;
  const sub = `${shares} shares`;
  const w2 = c.measureText(sub).width;
  cv.width = Math.ceil(Math.max(w1, w2)) + pad * 2;
  cv.height = fs + fs2 + pad * 1.6;
  // pill
  const r = 18;
  c.fillStyle = "rgba(10,22,29,.72)";
  c.beginPath();
  c.roundRect(2, 2, cv.width - 4, cv.height - 4, r);
  c.fill();
  c.textAlign = "center";
  c.font = `700 ${fs}px system-ui, sans-serif`;
  c.fillStyle = "#eee9dd";
  c.textBaseline = "alphabetic";
  c.fillText(name, cv.width / 2, pad * 0.4 + fs);
  c.font = `500 ${fs2}px system-ui, sans-serif`;
  c.fillStyle = "#9db4bd";
  c.fillText(sub, cv.width / 2, pad * 0.55 + fs + fs2);
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false }));
  const k = mobile ? 0.026 : 0.019;
  sp.scale.set(cv.width * k, cv.height * k, 1);
  sp.renderOrder = 10;
  return sp;
}

// Ribbon edges: one quad per edge, expanded perpendicular to the segment in the
// vertex shader (cross of edge axis and view dir) => real screen-facing width.
const EDGE_VERT = /* glsl */ `
attribute vec3 other;     // the opposite endpoint
attribute float side;     // -1 / +1 across the ribbon
attribute float width;
attribute vec3 tint;
attribute float alpha;
varying vec3 vTint;
varying float vAlpha;
varying float vSide;
void main() {
  vTint = tint; vAlpha = alpha; vSide = side;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 wo = modelMatrix * vec4(other, 1.0);
  vec3 axis = normalize(wo.xyz - wp.xyz);
  vec3 view = normalize(cameraPosition - wp.xyz);
  vec3 perp = normalize(cross(axis, view));
  wp.xyz += perp * side * width;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const EDGE_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vAlpha;
varying float vSide;
void main() {
  float core = 1.0 - abs(vSide);                  // soft falloff across the ribbon
  float glow = pow(core, 1.6);
  gl_FragColor = vec4(vTint * (0.55 + 0.45 * glow), vAlpha * glow);
}`;

export async function initConstellation(container, sim, opts = {}) {
  const renderer = makeRenderer(null, { antialias: true, alpha: true });
  renderer.setPixelRatio(dpr(opts.dprCap));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);
  const dom = renderer.domElement;

  const people = sim.people || [];
  const M = sim.matrix || [];
  const n = people.length;
  let disposed = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  const group = new THREE.Group();
  scene.add(group);

  const P = forceLayout(M, n);
  const maxShares = Math.max(1, ...people.map((p) => (sim.shares && sim.shares[p]) || 0));
  const colors = people.map((p) => {
    const c = new THREE.Color(0x8a93a6);
    try { c.set((sim.colors && sim.colors[p]) || (opts.personColors && opts.personColors[p]) || "#8a93a6"); } catch {}
    return c;
  });

  // --- background dust for depth ---
  const rng = mulberry32(33);
  const DUST = 260;
  const dPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 2 - 1), r = 18 + rng() * 50;
    dPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    dPos[i * 3 + 1] = r * Math.cos(ph) * 0.7;
    dPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x3e5a6a, size: 0.9, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  group.add(dust);

  // --- nodes: outer glow + bright core + label ---
  const glow = glowTexture();
  const core = coreTexture();
  const nodes = [], cores = [], labels = [], sizes = [];
  for (let i = 0; i < n; i++) {
    const shares = (sim.shares && sim.shares[people[i]]) || 1;
    const size = 1.9 + 3.6 * Math.sqrt(shares / maxShares);
    sizes.push(size);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: colors[i], transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sp.position.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    sp.scale.set(size, size, 1);
    sp.userData.idx = i;
    group.add(sp);
    nodes.push(sp);
    const co = new THREE.Sprite(new THREE.SpriteMaterial({
      map: core, color: new THREE.Color().copy(colors[i]).lerp(new THREE.Color(0xffffff), 0.55),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    co.position.copy(sp.position);
    co.scale.set(size * 0.34, size * 0.34, 1);
    group.add(co);
    cores.push(co);
    const lb = labelSprite(people[i], shares, opts.mobile);
    lb.position.set(P[i * 3], P[i * 3 + 1] + size * 0.55 + 1.1, P[i * 3 + 2]);
    group.add(lb);
    labels.push(lb);
  }

  // --- edges: min/max-normalized similarity through a power curve ---
  const off = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off.push((M[i] && M[i][j]) || 0);
  const sMin = off.length ? Math.min(...off) : 0;
  const sMax = off.length ? Math.max(...off) : 1;
  const norm = (s) => Math.pow(Math.max(0, (s - sMin) / Math.max(sMax - sMin, 1e-6)), 2.6);
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = (M[i] && M[i][j]) || 0;
      const t = norm(s);
      if (t < 0.02) continue;             // weakest pairs: not drawn at all
      edges.push({
        i, j, s, t,
        width: 0.05 + 0.46 * t,           // ribbon half-width (world units)
        alpha: 0.05 + 0.92 * t,           // brightness
      });
    }
  }
  const m = edges.length;
  const ePos = new Float32Array(m * 12), eOther = new Float32Array(m * 12);
  const eSide = new Float32Array(m * 4), eWidth = new Float32Array(m * 4);
  const eTint = new Float32Array(m * 12), eAlpha = new Float32Array(m * 4);
  const eIndex = new Uint16Array(m * 6);
  edges.forEach((e, k) => {
    const A = [P[e.i * 3], P[e.i * 3 + 1], P[e.i * 3 + 2]];
    const B = [P[e.j * 3], P[e.j * 3 + 1], P[e.j * 3 + 2]];
    // 4 verts: A-left, A-right, B-left, B-right
    const verts = [A, A, B, B], others = [B, B, A, A], side = [-1, 1, -1, 1];
    for (let v = 0; v < 4; v++) {
      ePos.set(verts[v], k * 12 + v * 3);
      eOther.set(others[v], k * 12 + v * 3);
      eSide[k * 4 + v] = side[v];
      eWidth[k * 4 + v] = e.width;
      const cc = v < 2 ? colors[e.i] : colors[e.j];
      eTint[k * 12 + v * 3] = cc.r; eTint[k * 12 + v * 3 + 1] = cc.g; eTint[k * 12 + v * 3 + 2] = cc.b;
      eAlpha[k * 4 + v] = e.alpha;
    }
    eIndex.set([k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 1, k * 4 + 2, k * 4 + 3], k * 6);
  });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setIndex(new THREE.BufferAttribute(eIndex, 1));
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
  edgeGeo.setAttribute("other", new THREE.BufferAttribute(eOther, 3));
  edgeGeo.setAttribute("side", new THREE.BufferAttribute(eSide, 1));
  const widthAttr = new THREE.BufferAttribute(eWidth, 1);
  widthAttr.setUsage(THREE.DynamicDrawUsage);
  edgeGeo.setAttribute("width", widthAttr);
  edgeGeo.setAttribute("tint", new THREE.BufferAttribute(eTint, 3));
  const alphaAttr = new THREE.BufferAttribute(eAlpha, 1);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  edgeGeo.setAttribute("alpha", alphaAttr);
  const edgeMat = new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const ribbons = new THREE.Mesh(edgeGeo, edgeMat);
  ribbons.frustumCulled = false;
  group.add(ribbons);

  function paintEdges(focusIdx) {
    edges.forEach((e, k) => {
      let a = e.alpha, w = e.width;
      if (focusIdx >= 0) {
        if (e.i === focusIdx || e.j === focusIdx) { a = Math.min(1, e.alpha * 1.6 + 0.25); w = e.width * 1.25 + 0.05; }
        else { a = e.alpha * 0.04; }
      }
      for (let v = 0; v < 4; v++) { eAlpha[k * 4 + v] = a; eWidth[k * 4 + v] = w; }
    });
    alphaAttr.needsUpdate = true;
    widthAttr.needsUpdate = true;
  }
  paintEdges(-1);

  // --- top shared artists per pair (optional, from sim.topArtists) ---
  // sim.topArtists: { name: [[artist, count], ...] } — intersect lists per pair.
  function sharedArtists(a, b, k) {
    const ta = sim.topArtists && sim.topArtists[a], tb = sim.topArtists && sim.topArtists[b];
    if (!ta || !tb) return null;
    const mapB = new Map(tb.map((x) => [x[0], x[1]]));
    const out = [];
    for (const [art, ca] of ta) {
      if (mapB.has(art)) out.push([art, Math.min(ca, mapB.get(art))]);
    }
    out.sort((x, y) => y[1] - x[1]);
    return out.slice(0, k).map((x) => x[0]);
  }

  // --- interaction ---
  const orbit = makeOrbit(dom, {
    radius: 34, minR: 14, maxR: 80, theta: 0.4, phi: 1.25,
    touchAction: opts.mobile ? "pan-y" : "none",
  });
  const tooltip = makeTooltip(container);
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  let hover = -1;

  function tooltipHtml(k) {
    const row = (M[k] || []).map((v, i) => ({ v: i === k ? -1 : v || 0, i }));
    row.sort((a, b) => b.v - a.v);
    const top = row.slice(0, 3).filter((r) => r.v > 0);
    let html = `<strong style="font-size:13px">${esc(people[k])}</strong>` +
      `<span style="opacity:.6"> · ${(sim.shares && sim.shares[people[k]]) || 0} shares</span>`;
    if (top.length) {
      html += `<div style="margin-top:5px;opacity:.85">closest taste:</div>`;
      for (const r of top) {
        const pct = Math.round(r.v * 100);
        const cc = "#" + colors[r.i].getHexString();
        html += `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">` +
          `<span style="width:8px;height:8px;border-radius:50%;background:${cc};flex:none"></span>` +
          `<span>${esc(people[r.i])}</span>` +
          `<span style="margin-left:auto;opacity:.7">${pct}%</span></div>`;
        const arts = sharedArtists(people[k], people[r.i], 2);
        if (arts && arts.length) {
          html += `<div style="margin-left:14px;opacity:.55;font-size:11px">${esc(arts.join(", "))}</div>`;
        }
      }
    }
    return html;
  }

  function setHighlight(k, x, y) {
    if (k === hover && k < 0) return;
    hover = k;
    paintEdges(k);
    const neigh = new Set();
    if (k >= 0) for (const e of edges) { if (e.i === k) neigh.add(e.j); if (e.j === k) neigh.add(e.i); }
    for (let i = 0; i < n; i++) {
      const on = k < 0 || i === k || neigh.has(i);
      nodes[i].material.opacity = on ? 1 : 0.14;
      cores[i].material.opacity = on ? 1 : 0.14;
      labels[i].material.opacity = k < 0 || i === k ? 1 : on ? 0.7 : 0.15;
    }
    if (k >= 0) tooltip.show(tooltipHtml(k), x, y);
    else tooltip.hide();
    dom.style.cursor = k >= 0 ? "pointer" : "";
  }

  function pick(e) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    const hits = raycaster.intersectObjects(nodes, false);
    return hits.length ? hits[0].object.userData.idx : -1;
  }
  const onMove = (e) => {
    if (opts.mobile || orbit.dragging) return;
    const rect = dom.getBoundingClientRect();
    setHighlight(pick(e), e.clientX - rect.left, e.clientY - rect.top);
  };
  const onUp = (e) => {
    if (!opts.mobile || orbit.justDragged) return;
    const rect = dom.getBoundingClientRect();
    const k = pick(e);
    setHighlight(k === hover ? -1 : k, e.clientX - rect.left, e.clientY - rect.top);
  };
  dom.addEventListener("pointermove", onMove);
  dom.addEventListener("pointerup", onUp);

  const doResize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  doResize();
  orbit.apply(camera);

  // gentle node breathing (glow pulse only — positions stay fixed so edges hold)
  let t0 = 0;
  const loop = new Loop((dt) => {
    orbit.update(dt);
    orbit.apply(camera);
    t0 += dt;
    if (!opts.reducedMotion) {
      group.rotation.y += dt * 0.045;
      for (let i = 0; i < n; i++) {
        const pulse = 1 + 0.06 * Math.sin(t0 * 0.8 + i * 1.7);
        nodes[i].scale.set(sizes[i] * pulse, sizes[i] * pulse, 1);
      }
    }
    renderer.render(scene, camera);
  });

  return {
    start() { if (!disposed) loop.start(); },
    pause() { loop.pause(); },
    resize() { if (!disposed) doResize(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      orbit.dispose();
      tooltip.dispose();
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      edgeGeo.dispose(); edgeMat.dispose();
      dustGeo.dispose(); dustMat.dispose();
      for (const s of nodes) s.material.dispose();
      for (const s of cores) s.material.dispose();
      for (const l of labels) { l.material.map.dispose(); l.material.dispose(); }
      glow.dispose(); core.dispose();
      renderer.dispose();
      dom.remove();
    },
  };
}
