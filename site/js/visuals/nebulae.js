// Genre nebulae — constellation v2.
//
// Artists are stars. Genre families are nebula clouds the stars cluster inside.
// People are constellations: focus a person (chips at the bottom, or hover a
// star) and a minimum-spanning-tree of glowing lines is traced through every
// artist they've shared, in their color.
//
// Input `neb`:
//   families: { name: { shares, artists, top_genres } }   (display order = Object order)
//   artists:  { name: { family, genres:[..], shares, by:{person:count} } }
//   people:   [names]            colors: { person: cssColor }
// Layout is precomputed at init (anchor relaxation + intra-cluster repulsion);
// no per-frame physics. Standard handle: start/pause/resize/dispose (+focusPerson).
import * as THREE from "three";
import { makeRenderer, makeTooltip, makeOrbit, Loop, dpr, esc, mulberry32, clamp } from "./common.js";
import { FAMILY_COLORS } from "./family-colors.js";

export { FAMILY_COLORS };

/* ── textures ─────────────────────────────────────────────────────────── */

function radialTexture(stops, size = 128) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const tx = new THREE.CanvasTexture(cv);
  return tx;
}
// Tighter glow than v1 — a real point of light, not a fuzzy ball.
const glowTexture = () => radialTexture([
  [0, "rgba(255,255,255,1)"], [0.11, "rgba(255,255,255,.95)"],
  [0.26, "rgba(255,255,255,.42)"], [0.5, "rgba(255,255,255,.12)"],
  [1, "rgba(255,255,255,0)"]]);
const coreTexture = () => radialTexture([
  [0, "rgba(255,255,255,1)"], [0.4, "rgba(255,255,255,.92)"],
  [0.62, "rgba(255,255,255,.12)"], [1, "rgba(255,255,255,0)"]], 64);

// 4-point diffraction spike for the brightest anchor stars.
function spikeTexture() {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d");
  c.translate(S / 2, S / 2);
  for (const ang of [0, Math.PI / 2]) {
    c.save();
    c.rotate(ang);
    const g = c.createLinearGradient(-S / 2, 0, S / 2, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(-S / 2, -1, S, 2);
    c.restore();
  }
  return new THREE.CanvasTexture(cv);
}

/* value-noise fBm for wispy fog (vs. v1's hard offset circles) */
function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (ix, iy) => perm[(perm[ix & 255] + (iy & 255)) & 255] / 255;
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const a = val(x0, y0) * (1 - fx) + val(x0 + 1, y0) * fx;
    const b = val(x0, y0 + 1) * (1 - fx) + val(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}
function fbm(noise, x, y, oct = 4) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise(x * f, y * f); norm += a; a *= 0.5; f *= 2; }
  return sum / norm;
}
// Domain-warped fBm cloud → the swirling filament structure of a real emission
// nebula (vs. a smooth blob). White RGB, alpha = gas density under a soft radial
// mask + faint hot core. Tinted per-cluster by the sprite color; baked once.
function fogTexture(seed) {
  const S = 192;
  const n1 = makeNoise2D(seed * 131 + 7);
  const n2 = makeNoise2D(seed * 977 + 31);
  const n3 = makeNoise2D(seed * 613 + 53);
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d");
  const img = c.createImageData(S, S);
  const d = img.data;
  const cx = S / 2, cy = S / 2, sc = 3.0 / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const dx = (x - cx) / cx, dy = (y - cy) / cy;
      const rr = Math.sqrt(dx * dx + dy * dy);
      if (rr >= 1) { d[i + 3] = 0; continue; }
      const mask = (1 - rr) * (1 - rr);                        // soft rounded falloff
      const px = x * sc + seed, py = y * sc - seed;
      // two-level domain warp: fbm(p + W·fbm(p + W·fbm(p)))
      const qx = fbm(n1, px, py, 4), qy = fbm(n2, px + 5.2, py + 1.3, 4);
      const wx = px + 3.4 * qx, wy = py + 3.4 * qy;
      const rx = fbm(n1, wx + 1.7, wy + 9.2, 4), ry = fbm(n2, wx + 8.3, wy + 2.8, 4);
      let f = fbm(n3, wx + 2.8 * rx, wy + 2.8 * ry, 5);
      f = Math.pow(Math.max(0, f * 1.4 - 0.27), 1.3);          // contrast → cloud texture
      const core = Math.pow(Math.max(0, 1 - rr * 1.5), 2.2) * 0.4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.min(1, (f + core) * mask) * 255;
    }
  }
  c.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

function textSprite(text, { px = 30, weight = 600, color = "#eee9dd", alpha = 1,
                            spacing = 0, scale = 0.016, stroke = 0.16 } = {}) {
  const cv = document.createElement("canvas");
  const c = cv.getContext("2d");
  const font = `${weight} ${px}px system-ui, sans-serif`;
  c.font = font;
  const chars = [...text];
  const w = c.measureText(text).width + spacing * Math.max(0, chars.length - 1);
  const pad = 18 + px * stroke;
  cv.width = Math.ceil(w) + pad * 2;
  cv.height = px + pad * 2;
  c.font = font;
  c.textBaseline = "middle";
  // crisp dark outline + soft halo so labels stay readable over bright gas
  c.lineJoin = "round";
  c.strokeStyle = "rgba(2,5,10,.92)";
  c.lineWidth = Math.max(2, px * stroke);
  c.shadowColor = "rgba(0,0,0,.7)";
  c.shadowBlur = px * 0.18;
  const y = cv.height / 2;
  let x = pad;
  for (const ch of chars) {            // pass 1: outline (with shadow)
    if (stroke) c.strokeText(ch, x, y);
    x += c.measureText(ch).width + spacing;
  }
  c.shadowBlur = 0;
  c.fillStyle = color;
  x = pad;
  for (const ch of chars) {            // pass 2: fill on top
    c.fillText(ch, x, y);
    x += c.measureText(ch).width + spacing;
  }
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tx, transparent: true, opacity: alpha, depthTest: false,
  }));
  sp.scale.set(cv.width * scale, cv.height * scale, 1);
  return sp;
}

/* ── layout ───────────────────────────────────────────────────────────── */

function layout(famNames, artistsByFam, rng) {
  const nf = famNames.length;
  // cluster radius from member count
  const radius = {};
  for (const f of famNames) radius[f] = 2.2 + 1.25 * Math.sqrt(artistsByFam[f].length);
  // anchors: fibonacci sphere, flattened, then pairwise relaxation
  const anchors = {};
  const GA = Math.PI * (3 - Math.sqrt(5));
  famNames.forEach((f, i) => {
    const y = nf === 1 ? 0 : 1 - (2 * i) / (nf - 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y)), th = GA * i;
    anchors[f] = new THREE.Vector3(
      Math.cos(th) * r * 14, y * 7.5, Math.sin(th) * r * 14);
  });
  for (let it = 0; it < 120; it++) {
    for (let i = 0; i < nf; i++) {
      for (let j = i + 1; j < nf; j++) {
        const a = anchors[famNames[i]], b = anchors[famNames[j]];
        const want = radius[famNames[i]] + radius[famNames[j]] + 2.5;
        const d = a.distanceTo(b);
        if (d < want && d > 1e-4) {
          const push = b.clone().sub(a).multiplyScalar((want - d) / d * 0.25);
          push.y *= 0.5;
          a.sub(push); b.add(push);
        }
      }
    }
  }
  // artists: random point in a flattened ball, then local repulsion
  const pos = {};
  for (const f of famNames) {
    const members = artistsByFam[f], r = radius[f];
    for (const m of members) {
      const u = rng(), v = rng(), w = Math.cbrt(rng());
      const th = u * Math.PI * 2, ph = Math.acos(v * 2 - 1);
      pos[m.name] = new THREE.Vector3(
        anchors[f].x + r * w * Math.sin(ph) * Math.cos(th),
        anchors[f].y + r * w * Math.cos(ph) * 0.55,
        anchors[f].z + r * w * Math.sin(ph) * Math.sin(th));
    }
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = pos[members[i].name], b = pos[members[j].name];
          const want = (members[i].size + members[j].size) * 0.62;
          const d = a.distanceTo(b);
          if (d < want && d > 1e-4) {
            const push = b.clone().sub(a).multiplyScalar((want - d) / d * 0.4);
            a.sub(push); b.add(push);
          }
        }
        // soft pull back into the cluster
        const p = pos[members[i].name], off = p.clone().sub(anchors[f]);
        if (off.length() > r) p.copy(anchors[f]).add(off.multiplyScalar(r / off.length()));
      }
    }
  }
  return { anchors, radius, pos };
}

// Prim MST over a set of Vector3s; returns pairs of indices in build order.
function mst(points) {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity), bestFrom = new Array(n).fill(0);
  inTree[0] = true;
  for (let i = 1; i < n; i++) best[i] = points[0].distanceToSquared(points[i]);
  const edges = [];
  for (let k = 1; k < n; k++) {
    let pick = -1, pd = Infinity;
    for (let i = 0; i < n; i++) if (!inTree[i] && best[i] < pd) { pd = best[i]; pick = i; }
    inTree[pick] = true;
    edges.push([bestFrom[pick], pick]);
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) {
        const d = points[pick].distanceToSquared(points[i]);
        if (d < best[i]) { best[i] = d; bestFrom[i] = pick; }
      }
    }
  }
  return edges;
}

/* ── main ─────────────────────────────────────────────────────────────── */

export async function initNebulae(container, neb, opts = {}) {
  const renderer = makeRenderer(null, { antialias: true, alpha: true });
  renderer.setPixelRatio(dpr(opts.dprCap));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);
  const dom = renderer.domElement;
  let disposed = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  const group = new THREE.Group();
  scene.add(group);
  // No opaque backdrop here — the canvas stays transparent and the page's
  // fractal bg (dimmed near-black by #bg-dim, same as the galaxy) shows through;
  // the gas is layered on top. The fractal triangle is kept down by the dim.

  const rng = mulberry32(42);
  const famNames = Object.keys(neb.families)
    .filter((f) => Object.values(neb.artists).some((a) => a.family === f));
  const artists = Object.entries(neb.artists).map(([name, a]) => ({
    name, ...a,
    size: 0.55 + 1.9 * Math.sqrt(a.shares / 30),
  }));
  const artistsByFam = {};
  for (const f of famNames) artistsByFam[f] = artists.filter((a) => a.family === f);
  const { anchors, radius, pos } = layout(famNames, artistsByFam, rng);
  const WHITE = new THREE.Color(0xffffff);
  const WARM = new THREE.Color(0xffe2b0), COOL = new THREE.Color(0xbcd6ff);
  const famColor = (f) => new THREE.Color(FAMILY_COLORS[f] || "#8a93a6");

  /* ── background starfield (layered, varied brightness) ─────────────────── */
  const bgStarTex = radialTexture([
    [0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,.7)"],
    [0.7, "rgba(255,255,255,.12)"], [1, "rgba(255,255,255,0)"]], 64);
  const starLayers = [];
  function starShell(count, rIn, rOut, size, opacity, tint) {
    const arr = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 2 - 1);
      const r = rIn + rng() * (rOut - rIn);
      arr[i * 3] = r * Math.sin(ph) * Math.cos(th);
      arr[i * 3 + 1] = r * Math.cos(ph) * 0.7;
      arr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      // most stars white, a few warm/cool — subtle temperature spread
      const c = WHITE.clone();
      const t = rng();
      if (t > 0.82) c.lerp(WARM, 0.5);
      else if (t < 0.16) c.lerp(COOL, 0.5);
      const b = 0.55 + rng() * 0.45;
      col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      map: bgStarTex, size, transparent: true, opacity, vertexColors: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    if (tint) mat.color.set(tint);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    starLayers.push(pts);
  }
  starShell(620, 90, 230, 0.55, 0.75);                       // far dim field
  starShell(240, 70, 180, 1.05, 0.9);                        // mid stars
  starShell(70, 55, 150, 1.9, 0.95);                         // near bright stars
  // faint colored deep dust
  starShell(160, 60, 180, 2.6, 0.16, 0x35506e);

  /* ── nebula fog + family labels ───────────────────────────────────────── */
  const fogTex = [fogTexture(11), fogTexture(23), fogTexture(57)];
  const fogSprites = [], famLabels = [];
  for (const f of famNames) {
    const col = famColor(f), r = radius[f];
    const coreCol = col.clone().lerp(WHITE, 0.42);     // hot, brighter centre
    const nFog = 7 + Math.min(8, artistsByFam[f].length >> 2);
    for (let i = 0; i < nFog; i++) {
      const central = i < 2;
      // per-sprite temperature drift gives the cloud a natural hue gradient
      const tint = (central ? coreCol : col).clone();
      if (!central) {
        const tj = rng();
        if (tj > 0.66) tint.lerp(WARM, 0.2);
        else if (tj < 0.33) tint.lerp(COOL, 0.2);
      }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fogTex[(rng() * fogTex.length) | 0],
        color: tint, transparent: true,
        opacity: (central ? 0.18 : 0.13) + rng() * 0.06,
        depthWrite: false, blending: THREE.AdditiveBlending,
        rotation: rng() * Math.PI * 2,
      }));
      const th = rng() * Math.PI * 2, rr = r * (central ? 0.2 : 0.62) * Math.sqrt(rng());
      sp.position.set(
        anchors[f].x + Math.cos(th) * rr,
        anchors[f].y + (rng() - 0.5) * r * 0.5,
        anchors[f].z + Math.sin(th) * rr);
      const s = r * (central ? 2.9 + rng() * 0.9 : 1.9 + rng() * 1.4);
      sp.scale.set(s, s * (0.6 + rng() * 0.38), 1);
      sp.userData.baseOpacity = sp.material.opacity;
      group.add(sp);
      fogSprites.push(sp);
    }
    // clear region caption — bright tint + outline so it's readable over gas
    const lb = textSprite(f.toUpperCase(), {
      px: 32, weight: 700, spacing: 5, alpha: 0.92, scale: 0.022, stroke: 0.2,
      color: "#" + col.clone().lerp(WHITE, 0.78).getHexString(),
    });
    lb.position.copy(anchors[f]);
    lb.position.y += radius[f] * 0.62 + 1.6;
    lb.renderOrder = 6;
    lb.userData.baseOpacity = lb.material.opacity;
    group.add(lb);
    famLabels.push(lb);
  }

  /* ── stars ────────────────────────────────────────────────────────────── */
  const glowTex = glowTexture(), coreTex = coreTexture(), spikeTex = spikeTexture();
  const stars = [], cores = [], spikes = [], nameLabels = [];
  const sortedShares = [...artists].sort((a, b) => b.shares - a.shares);
  const labelCut = sortedShares[Math.min(15, artists.length - 1)].shares;   // ~top 16 named
  const spikeCut = sortedShares[Math.min(9, artists.length - 1)].shares;    // ~top 10 spiked
  artists.forEach((a, i) => {
    // family color, nudged by a per-star colour temperature so the field has life
    const baseCol = famColor(a.family);
    const tj = rng();
    if (tj > 0.7) baseCol.lerp(WARM, 0.16);
    else if (tj < 0.3) baseCol.lerp(COOL, 0.16);
    a._col = baseCol;

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: baseCol.clone().lerp(WHITE, 0.08), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.copy(pos[a.name]);
    glow.scale.set(a.size, a.size, 1);
    glow.userData.idx = i;
    group.add(glow);
    stars.push(glow);

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: coreTex, color: baseCol.clone().lerp(WHITE, 0.78),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    core.position.copy(glow.position);
    core.scale.set(a.size * 0.34, a.size * 0.34, 1);
    group.add(core);
    cores.push(core);

    if (a.shares >= Math.max(spikeCut, 5)) {
      const sk = new THREE.Sprite(new THREE.SpriteMaterial({
        map: spikeTex, color: baseCol.clone().lerp(WHITE, 0.5),
        transparent: true, opacity: 0.6, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      sk.position.copy(glow.position);
      const ss = a.size * 3.4;
      sk.scale.set(ss, ss, 1);
      sk.userData.idx = i;
      group.add(sk);
      spikes.push(sk);
    }

    if (a.shares >= Math.max(labelCut, 4)) {
      const lb = textSprite(a.name, { px: 25, weight: 600, alpha: 0.96, scale: 0.0125, stroke: 0.22 });
      lb.position.copy(glow.position);
      lb.position.y += a.size * 0.55 + 0.7;
      lb.renderOrder = 8;
      lb.userData.baseOpacity = lb.material.opacity;
      lb.userData.idx = i;
      group.add(lb);
      nameLabels.push(lb);
    }
  });

  /* ── person constellations (lazy MST, cached) ─────────────────────────── */
  const people = neb.people || [];
  const personArtists = {};
  for (const p of people)
    personArtists[p] = artists.map((a, i) => ({ a, i })).filter((x) => (x.a.by[p] || 0) > 0);
  const mstCache = {};
  let lines = null, lineEdges = 0, lineReveal = 0;
  let focus = null;

  function buildLines(p) {
    if (!mstCache[p]) {
      const pts = personArtists[p].map((x) => pos[x.a.name]);
      mstCache[p] = mst(pts);
    }
    const edges = mstCache[p];
    const pts = personArtists[p].map((x) => pos[x.a.name]);
    const arr = new Float32Array(edges.length * 6);
    edges.forEach(([u, v], k) => {
      arr.set([pts[u].x, pts[u].y, pts[u].z, pts[v].x, pts[v].y, pts[v].z], k * 6);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color((neb.colors && neb.colors[p]) || "#ffffff"),
      transparent: true, opacity: 0.6, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ls = new THREE.LineSegments(geo, mat);
    ls.frustumCulled = false;
    ls.renderOrder = 4;
    return { ls, n: edges.length };
  }

  function clearLines() {
    if (lines) {
      group.remove(lines);
      lines.geometry.dispose();
      lines.material.dispose();
      lines = null;
    }
  }

  function applyFocus(p) {
    focus = p;
    clearLines();
    const owned = p ? new Set(personArtists[p].map((x) => x.i)) : null;
    const pCol = p && new THREE.Color((neb.colors && neb.colors[p]) || "#ffffff");
    artists.forEach((a, i) => {
      const on = !p || owned.has(i);
      stars[i].material.opacity = on ? 1 : 0.06;
      cores[i].material.opacity = on ? 1 : 0.06;
      if (p && on) stars[i].material.color.copy(a._col).lerp(pCol, 0.5);
      else stars[i].material.color.copy(a._col).lerp(WHITE, 0.08);
    });
    for (const sk of spikes)
      sk.material.opacity = (!p || owned.has(sk.userData.idx)) ? 0.6 : 0.04;
    for (const lb of nameLabels)
      lb.material.opacity = (!p || owned.has(lb.userData.idx)) ? lb.userData.baseOpacity : 0.07;
    for (const sp of fogSprites)
      sp.material.opacity = sp.userData.baseOpacity * (p ? 0.35 : 1);
    for (const lb of famLabels)
      lb.material.opacity = lb.userData.baseOpacity * (p ? 0.5 : 1);
    if (p && personArtists[p].length > 1) {
      const built = buildLines(p);
      lines = built.ls;
      lineEdges = built.n;
      lineReveal = opts.reducedMotion ? lineEdges : 0;
      lines.geometry.setDrawRange(0, lineReveal * 2);
      group.add(lines);
    }
    updateReadout();
  }

  /* ── chips + readout (DOM) ─────────────────────────────────────────────── */
  const ui = document.createElement("div");
  ui.style.cssText = "position:absolute;left:0;right:0;bottom:14px;z-index:11;display:flex;" +
    "flex-wrap:wrap;gap:6px;justify-content:center;padding:0 12px;pointer-events:none";
  const chips = {};
  const chipCss = "pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:6px;" +
    "padding:4px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.16);" +
    "background:rgba(8,14,20,.72);color:#dfe7ea;font:600 12px/1.4 system-ui,sans-serif;" +
    "transition:all .15s;user-select:none";
  for (const p of people) {
    const c = (neb.colors && neb.colors[p]) || "#8a93a6";
    const chip = document.createElement("button");
    chip.style.cssText = chipCss;
    chip.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${c};flex:none"></span>${esc(p)}`;
    chip.onmouseenter = () => { if (!opts.mobile && !sticky && focus !== p) applyFocus(p); };
    chip.onmouseleave = () => { if (!opts.mobile && !sticky) applyFocus(null); };
    chip.onclick = () => {
      sticky = !(sticky && focus === p);
      applyFocus(sticky ? p : null);
    };
    ui.appendChild(chip);
    chips[p] = chip;
  }
  let sticky = false;
  container.appendChild(ui);

  const readout = document.createElement("div");
  readout.style.cssText = `position:absolute;right:14px;top:${opts.mobile ? 64 : 12}px;z-index:11;max-width:240px;` +
    "padding:8px 12px;border-radius:10px;background:rgba(8,14,20,.66);border:1px solid rgba(255,255,255,.1);" +
    "color:#cfdbe0;font:12px/1.5 system-ui,sans-serif;pointer-events:none;transition:opacity .2s";
  container.appendChild(readout);

  // soft cinematic vignette (CSS, on top of the canvas) — darkens edges for depth
  const vignette = document.createElement("div");
  vignette.style.cssText = "position:absolute;inset:0;z-index:10;pointer-events:none;" +
    "background:radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 42%, rgba(2,4,8,.55) 100%)";
  container.appendChild(vignette);

  function updateReadout() {
    for (const [name, chip] of Object.entries(chips)) {
      chip.style.boxShadow = name === focus ? "0 0 0 1.5px rgba(255,255,255,.55) inset" : "none";
      chip.style.opacity = focus && name !== focus ? 0.55 : 1;
    }
    // on mobile the unfocused overview collides with the section title (and just
    // repeats the subtitle hint) — only surface the readout once a boi is picked.
    readout.style.opacity = (opts.mobile && !focus) ? "0" : "1";
    if (!focus) {
      readout.innerHTML = `<strong style="color:#eee9dd">${artists.length} artists · ${famNames.length} nebulae</strong>` +
        `<div style="opacity:.75;margin-top:2px">hover a star · pick a boi to trace their constellation</div>`;
      return;
    }
    const mine = personArtists[focus];
    const famCount = {};
    let shares = 0;
    for (const { a } of mine) {
      famCount[a.family] = (famCount[a.family] || 0) + (a.by[focus] || 0);
      shares += a.by[focus] || 0;
    }
    const home = Object.entries(famCount).sort((x, y) => y[1] - x[1])[0];
    readout.innerHTML = `<strong style="color:#eee9dd">${esc(focus)}</strong>` +
      `<div style="opacity:.85;margin-top:2px">${mine.length} artists · ${shares} shares here</div>` +
      (home ? `<div style="opacity:.85">home nebula: <span style="color:${FAMILY_COLORS[home[0]] || "#fff"}">${esc(home[0])}</span></div>` : "");
  }
  updateReadout();

  /* ── hover tooltips on stars ──────────────────────────────────────────── */
  const orbit = makeOrbit(dom, {
    radius: opts.mobile ? 90 : 60, minR: 22, maxR: 140, theta: 0.55, phi: 1.2,
    touchAction: opts.mobile ? "pan-y" : "none",
  });
  const tooltip = makeTooltip(container);
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  let hoverIdx = -1;

  function starTooltip(i) {
    const a = artists[i];
    const ppl = Object.entries(a.by).sort((x, y) => y[1] - x[1]).slice(0, 4);
    let html = `<strong style="font-size:13px">${esc(a.name)}</strong>` +
      `<div style="opacity:.65;margin-top:1px">${esc((a.genres || []).join(", ") || a.family)}</div>` +
      `<div style="opacity:.85;margin-top:4px">${a.shares} share${a.shares === 1 ? "" : "s"}</div>`;
    for (const [p, c] of ppl) {
      const col = (neb.colors && neb.colors[p]) || "#8a93a6";
      html += `<div style="display:flex;align-items:center;gap:6px;margin-top:2px">` +
        `<span style="width:7px;height:7px;border-radius:50%;background:${col};flex:none"></span>` +
        `<span>${esc(p)}</span><span style="margin-left:auto;opacity:.7">${c}</span></div>`;
    }
    return html;
  }

  function pick(e) {
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1,
             -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    const hits = raycaster.intersectObjects(stars, false);
    for (const h of hits) {
      if (h.object.material.opacity > 0.5) return h.object.userData.idx;
    }
    return -1;
  }
  const onMove = (e) => {
    if (opts.mobile || orbit.dragging) return;
    const rect = dom.getBoundingClientRect();
    const k = pick(e);
    if (k !== hoverIdx) {
      hoverIdx = k;
      dom.style.cursor = k >= 0 ? "pointer" : "";
    }
    if (k >= 0) tooltip.show(starTooltip(k), e.clientX - rect.left, e.clientY - rect.top);
    else tooltip.hide();
  };
  const onUp = (e) => {
    if (!opts.mobile || orbit.justDragged) return;
    const rect = dom.getBoundingClientRect();
    const k = pick(e);
    hoverIdx = k === hoverIdx ? -1 : k;
    if (hoverIdx >= 0) tooltip.show(starTooltip(hoverIdx), e.clientX - rect.left, e.clientY - rect.top);
    else tooltip.hide();
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

  /* ── loop ─────────────────────────────────────────────────────────────── */
  let t0 = 0;
  const loop = new Loop((dt) => {
    orbit.update(dt);
    orbit.apply(camera);
    t0 += dt;
    if (!opts.reducedMotion) {
      group.rotation.y += dt * 0.03;
      for (let i = 0; i < stars.length; i++) {
        const pulse = 1 + 0.06 * Math.sin(t0 * 0.9 + i * 2.1);
        stars[i].scale.set(artists[i].size * pulse, artists[i].size * pulse, 1);
      }
      for (let i = 0; i < spikes.length; i++) {
        const tw = 0.5 + 0.5 * Math.sin(t0 * 1.7 + i * 3.3);
        spikes[i].material.rotation = 0.04 * Math.sin(t0 * 0.4 + i);
        if (spikes[i].material.opacity > 0.2)
          spikes[i].material.opacity = 0.4 + 0.3 * tw;
      }
      for (const sp of fogSprites) sp.material.rotation += dt * 0.01;
    }
    if (lines && lineReveal < lineEdges) {
      lineReveal = Math.min(lineEdges, lineReveal + dt * Math.max(24, lineEdges * 1.4));
      lines.geometry.setDrawRange(0, Math.floor(lineReveal) * 2);
    }
    renderer.render(scene, camera);
  });

  return {
    start() { if (!disposed) loop.start(); },
    pause() { loop.pause(); },
    resize() { if (!disposed) doResize(); },
    focusPerson(p) { sticky = !!p; applyFocus(p || null); },
    // scroll choreography: fade + drift the whole nebula (canvas + chips) in as
    // the section enters the viewport and back out as it leaves. k in [0,1].
    setReveal(k) {
      if (disposed) return;
      const e = clamp(k, 0, 1);
      dom.style.opacity = e.toFixed(3);
      ui.style.opacity = e.toFixed(3);
      if (!opts.reducedMotion) {
        dom.style.transformOrigin = "50% 44%";
        dom.style.transform = `translateY(${((1 - e) * 5).toFixed(2)}%) scale(${(0.955 + 0.045 * e).toFixed(4)})`;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      orbit.dispose();
      tooltip.dispose();
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      ui.remove(); readout.remove(); vignette.remove();
      clearLines();
      const shared = new Set([glowTex, coreTex, spikeTex, bgStarTex, ...fogTex]);
      for (const pts of starLayers) { pts.geometry.dispose(); pts.material.dispose(); }
      for (const s of [...stars, ...cores, ...spikes, ...fogSprites, ...famLabels, ...nameLabels]) {
        if (s.material.map && !shared.has(s.material.map)) s.material.map.dispose();
        s.material.dispose();
      }
      for (const t of shared) t.dispose();
      renderer.dispose();
      dom.remove();
    },
  };
}
