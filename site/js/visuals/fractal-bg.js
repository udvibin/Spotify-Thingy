// Ambient "vortex shedding" background — Tame Impala "Eventually" composition
// in the "Currents" palette. Horizontal streamlines part symmetrically around a
// central faceted triangle (grey, like the Currents chrome ball); a red→yellow
// streak rides the center streamline; lavender/violet lines on near-black with
// dark vignetted edges. Everything moves at a geological, psychedelic pace:
// waves are slowly born at the centerline and drift outward around the shape.
// Very dark by design (luminance capped) so overlaid cream text stays readable.
import * as THREE from "three";
import { makeRenderer, Loop, clamp } from "./common.js";

// All tunables live here so bg-lab.html can drive them live via setParams().
export const BG_DEFAULTS = {
  // Defaults = Uday's FINAL tuned values (11 Jun, locked).
  speed: 2.9,      // global time multiplier (JS-side)
  lineFreq: 40,    // stripe density
  triSize: 0.52,   // triangle circumradius (fraction of half-viewport-height)
  squeeze: 1.9,    // how tightly lines hug the triangle
  wakeAmp: 0.0,    // vortex-street undulation strength
  wakeFreq: 2.0,   // vortex-street wavelength
  warpAmt: 0.0,    // fbm domain warp (psychedelic wobble)
  waveAmt: 0.03,   // hand-drawn waviness of the lines
  lineAmp: 0.61,   // line brightness
  redAmt: 1.0,     // red→yellow center streak intensity
  triAmt: 1.0,     // triangle brightness
  drift: 3.1,      // outward wave-emanation rate
  lumCap: 0.265,   // luminance soft-cap (text readability)
  vortStr: 0.245,  // magnetic vortex-pair ring strength
  vortX: 0.31,     // vortex centers x (in triangle radii)
  vortY: 0.52,     // vortex centers ±y (in triangle radii)
  vortSoft: 0.071, // vortex core softening (ring tightness)
  vortBend: 1.0,   // how much the vortices bend the flow lines (1 = one unified field)
  ringAmt: 0.0,    // separate vortex-ring overlay (the "weave") — 0 = off
  ringTint: 0.6,   // vortex-ring color: 0 = same violet as lines, 1 = rose
};

const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform float uLineFreq;
uniform float uTriSize;
uniform float uSqueeze;
uniform float uWakeAmp;
uniform float uWakeFreq;
uniform float uWarpAmt;
uniform float uWaveAmt;
uniform float uLineAmp;
uniform float uRedAmt;
uniform float uTriAmt;
uniform float uDrift;
uniform float uLumCap;
uniform float uVortStr;
uniform float uVortX;
uniform float uVortY;
uniform float uVortSoft;
uniform float uVortBend;
uniform float uRingAmt;
uniform float uRingTint;

#define PI 3.14159265

// ---- value noise / fbm -----------------------------------------------------
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.3; a *= 0.5; }
  return v;
}

// Equilateral triangle SDF, apex pointing LEFT (rotated iq classic).
float sdTriLeft(vec2 p, float r) {
  p = vec2(p.y, -p.x); // rotate so "up" SDF points left
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y; // y in [-1,1], x aspect-wide
  float aspect = uRes.x / uRes.y;

  // Geological-pace clocks.
  float t1 = uTime * 0.0045;  // light sweep / halo mood (~minutes)
  float t2 = uTime * 0.010;   // noise breathing
  float t3 = uTime * 0.060;   // wave emanation phase

  // Triangle radius: shrink on narrow (portrait) viewports, faint breathing.
  float R = uTriSize * clamp(aspect * 0.9, 0.55, 1.0);
  R *= 1.0 + 0.012 * sin(uTime * 0.05);

  // Domain warp: slow organic wobble of the whole field.
  vec2 warp = vec2(fbm(uv * 1.35 + vec2(t2, -t2 * 0.8)),
                   fbm(uv * 1.35 + vec2(-t2 * 0.7, t2) + 31.7)) - 0.5;
  vec2 q = uv + warp * uWarpAmt;

  float d = sdTriLeft(q, R);     // signed distance to triangle (<0 inside)
  float dd = max(d, 0.0);

  // Streamfunction: horizontal far away, hugging the triangle up close.
  float g = 1.0 - exp(-dd * uSqueeze / max(R, 1e-3));
  float psi = q.y * g;
  // hand-drawn waviness
  psi += uWaveAmt * fbm(q * 2.2 + vec2(0.0, t2 * 0.5)) * (0.4 + 0.6 * g);
  // vortex-street undulation, symmetric on both sides of the shape
  float ax = abs(q.x);
  float env = smoothstep(R * 0.55, R * 1.6, ax) * exp(-(ax - R) * 0.7);
  float yenv = exp(-q.y * q.y * 7.0);
  psi += uWakeAmp * (1.0 + 0.4 * uScroll)
       * sin(ax * uWakeFreq - uTime * 0.18 + 2.2 * fbm(q * 1.3 + t2 * 0.3))
       * env * yenv;
  // The red line/rim follows the flow-only field, so the vortices never pull
  // red separatrices around themselves — red belongs to the triangle.
  float psiStreak = psi;

  // Two counter-rotating "magnetic" vortices mirrored about the centerline.
  // Iso-lines of the pair potential are circles around each core (Apollonius);
  // the pair self-cancels at distance so the far field stays calm.
  vec2 vc = vec2(uVortX, uVortY) * R;
  vc += 0.02 * vec2(sin(uTime * 0.041), sin(uTime * 0.057 + 1.7)); // slow wander
  vec2 dv1 = q - vc;
  vec2 dv2 = q - vec2(vc.x, -vc.y);
  float soft2 = max(uVortSoft, 1e-3); soft2 *= soft2;
  float phi = uVortStr * 0.5 * log((dot(dv1, dv1) + soft2) / (dot(dv2, dv2) + soft2));
  psi += phi * uVortBend; // vortices gently bend the flow lines

  float outside = smoothstep(0.0, 0.012, d); // no lines inside the triangle
  float lw = 0.42 + 0.16 * fbm(uv * 2.0 + 5.1); // line width varies a touch

  // Family A — flow lines: mirror-symmetric stripes born at the centerline,
  // drifting outward around the shape.
  float sA = abs(psi) * uLineFreq - t3 * uDrift;
  float bandA = abs(fract(sA) - 0.5) * 2.0;
  float aaA = fwidth(sA) * 1.2 + 1e-4;
  float lines = (1.0 - smoothstep(lw - aaA, lw + aaA, bandA)) * outside;

  // Family B — vortex rings: a separate set of circles around the cores that
  // CROSSES the flow lines (the cover's swirl-over-stripes weave). Rings fade
  // in near the cores and drift inward, getting swallowed by them.
  float sB = abs(phi) * uLineFreq - t3 * uDrift;
  float bandB = abs(fract(sB) - 0.5) * 2.0;
  float aaB = fwidth(sB) * 1.2 + 1e-4;
  float rings = (1.0 - smoothstep(lw - aaB, lw + aaB, bandB)) * outside;
  rings *= smoothstep(0.05, 0.22, abs(phi)); // rings live near the cores

  // ---- palette (Currents: purple & black) -----------------------------------
  vec3 BG0    = vec3(0.014, 0.010, 0.026);
  vec3 BG1    = vec3(0.055, 0.040, 0.090);
  vec3 VIOLET = vec3(0.357, 0.282, 0.541);  // #5b488a
  vec3 LAV    = vec3(0.725, 0.639, 0.890);  // #b9a3e3
  vec3 RED    = vec3(0.851, 0.255, 0.180);  // #d9412e
  vec3 YEL    = vec3(0.918, 0.737, 0.310);  // #eabc4f

  // Near-black purple bg with the faintest nebular drift.
  float neb = fbm(uv * 1.6 + vec2(0.0, uTime * 0.003));
  vec3 col = mix(BG0, BG1, clamp(0.25 + 0.5 * neb - 0.3 * length(uv), 0.0, 1.0));

  // Lines: violet -> lavender by slow-breathing shade; scroll warms the hue.
  float shade = fbm(uv * 1.2 + vec2(t2 * 0.4, 0.0));
  vec3 lineCol = mix(VIOLET, LAV, smoothstep(0.2, 0.85, shade));
  lineCol = mix(lineCol, vec3(0.86, 0.55, 0.62), uScroll * 0.35);
  col += lineCol * lines * uLineAmp * (0.75 + 0.25 * shade);
  // Optional vortex-ring overlay (the "weave"), slightly rose so crossings read.
  vec3 ringCol = mix(lineCol, vec3(0.80, 0.48, 0.58), uRingTint);
  col += ringCol * rings * uLineAmp * uRingAmt * (0.75 + 0.25 * shade);

  // Red→yellow streak on the flow centerline (solid, like the cover's line).
  // psi compresses near the body, so a constant-psi width balloons spatially
  // there — fade the streak with g to keep it a thin line, not a red flood.
  float cs = abs(psiStreak) * uLineFreq;
  float thin = smoothstep(0.10, 0.45, g);
  float streak = (1.0 - smoothstep(0.18, 0.62, cs)) * smoothstep(0.0, 0.012, d) * thin;
  // ...and a thin red rim hugging the triangle itself (the stagnation
  // streamline IS the body surface — the cover's outline).
  float rim = 1.0 - smoothstep(0.012, 0.012 + max(fwidth(dd) * 1.5, 0.005), dd);
  vec3 streakCol = mix(RED, YEL, smoothstep(R, aspect * 0.95, q.x));
  float redMask = max(streak, rim);
  col = mix(col, streakCol, redMask * clamp(uRedAmt, 0.0, 1.0) * 0.85);
  // soft warm glow around the line and the body
  col += streakCol * (exp(-cs * 1.4) * thin + exp(-dd * 10.0)) * 0.08 * uRedAmt;

  // Slow-hue halo hugging the triangle (the cover's purple-pink aura).
  float halo = exp(-dd * 18.0);
  col += mix(LAV, vec3(0.95, 0.45, 0.50), 0.5 + 0.5 * sin(t1 * 4.0)) * halo * 0.16;

  // Faceted triangle — muted "Eventually" orange, light sweeping at a crawl.
  float ia = fwidth(d) * 1.5 + 1e-4;
  float inside = 1.0 - smoothstep(-ia, ia, d);
  if (inside > 0.0) {
    float ang = atan(q.y, q.x);
    float fa = 0.0;                       // facet normal angle (right face)
    if (ang > PI / 3.0) fa = 2.0943951;   // upper face
    else if (ang < -PI / 3.0) fa = -2.0943951;
    float lt = uTime * 0.03 + 0.6;
    float b = 0.5 + 0.5 * cos(fa - lt);
    vec3 triCol = mix(vec3(0.33, 0.16, 0.11), vec3(0.88, 0.55, 0.32), b);
    float hgt = clamp(-d / max(R * 0.45, 1e-3), 0.0, 1.0); // pyramid apex
    triCol += vec3(0.95, 0.68, 0.44) * pow(hgt, 3.0) * 0.35;
    triCol *= 0.92 + 0.16 * noise(q * 60.0); // print grain
    col = mix(col, triCol * uTriAmt, inside);
  }

  // Dark outsides: vignette to near-black at the edges.
  float vig = 1.0 - smoothstep(0.5, 1.45, length(uv * vec2(0.78, 1.05)));
  col *= mix(0.22, 1.0, vig);

  // Luminance soft-cap keeps cream text readable on top. The triangle gets a
  // looser cap so its orange doesn't turn to mud (text rarely sits dead-center).
  float capEff = uLumCap * (1.0 + 1.2 * inside);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col *= mix(1.0, capEff / max(l, 1e-4), smoothstep(capEff * 0.8, capEff * 1.7, l));
  gl_FragColor = vec4(col, 1.0);
}
`;

export async function initFractalBg(canvas, opts = {}) {
  const renderer = makeRenderer(canvas, { antialias: false, alpha: false });
  renderer.setPixelRatio(1); // resolution handled via `scale` below
  // Crisp lines want near-full res (the old bg was deliberately blurry at 0.5).
  const scale = opts.mobile ? 0.6 : 1.0;

  const params = { ...BG_DEFAULTS, ...(opts.params || {}) };

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: opts.reducedMotion ? 200.0 : 0.0 },
    uScroll: { value: 0 },
    uLineFreq: { value: params.lineFreq },
    uTriSize: { value: params.triSize },
    uSqueeze: { value: params.squeeze },
    uWakeAmp: { value: params.wakeAmp },
    uWakeFreq: { value: params.wakeFreq },
    uWarpAmt: { value: params.warpAmt },
    uWaveAmt: { value: params.waveAmt },
    uLineAmp: { value: params.lineAmp },
    uRedAmt: { value: params.redAmt },
    uTriAmt: { value: params.triAmt },
    uDrift: { value: params.drift },
    uLumCap: { value: params.lumCap },
    uVortStr: { value: params.vortStr },
    uVortX: { value: params.vortX },
    uVortY: { value: params.vortY },
    uVortSoft: { value: params.vortSoft },
    uVortBend: { value: params.vortBend },
    uRingAmt: { value: params.ringAmt },
    uRingTint: { value: params.ringTint },
  };
  const UNIFORM_OF = {
    lineFreq: "uLineFreq", triSize: "uTriSize", squeeze: "uSqueeze",
    wakeAmp: "uWakeAmp", wakeFreq: "uWakeFreq", warpAmt: "uWarpAmt",
    waveAmt: "uWaveAmt", lineAmp: "uLineAmp", redAmt: "uRedAmt",
    triAmt: "uTriAmt", drift: "uDrift", lumCap: "uLumCap",
    vortStr: "uVortStr", vortX: "uVortX", vortY: "uVortY", vortSoft: "uVortSoft",
    vortBend: "uVortBend", ringAmt: "uRingAmt", ringTint: "uRingTint",
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
    extensions: { derivatives: true }, // fwidth AA on WebGL1 contexts
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);

  let scrollTarget = 0;
  let disposed = false;

  const doResize = () => {
    const w = Math.max(1, Math.round((canvas.clientWidth || window.innerWidth) * scale));
    const h = Math.max(1, Math.round((canvas.clientHeight || window.innerHeight) * scale));
    renderer.setSize(w, h, false); // keep CSS size, render small
    uniforms.uRes.value.set(w, h);
  };
  doResize();

  const renderOnce = () => {
    if (disposed) return;
    try { renderer.render(scene, camera); } catch (e) { console.error("[fractal-bg]", e); }
  };

  const loop = new Loop((dt) => {
    uniforms.uTime.value += dt * params.speed;
    uniforms.uScroll.value += (scrollTarget - uniforms.uScroll.value) * (1 - Math.exp(-4 * dt));
    renderer.render(scene, camera);
  });

  if (opts.reducedMotion) renderOnce();

  return {
    start() {
      if (disposed) return;
      if (opts.reducedMotion) renderOnce(); // mostly static: draw once, no continuous loop
      else loop.start();
    },
    pause() { loop.pause(); },
    resize() {
      if (disposed) return;
      doResize();
      if (opts.reducedMotion) renderOnce();
    },
    setScroll(p) {
      scrollTarget = clamp(Number(p) || 0, 0, 1);
      if (opts.reducedMotion) { uniforms.uScroll.value = scrollTarget; renderOnce(); }
    },
    setParams(patch) {
      if (disposed) return;
      for (const [k, v] of Object.entries(patch || {})) {
        if (!(k in params) || !Number.isFinite(Number(v))) continue;
        params[k] = Number(v);
        if (UNIFORM_OF[k]) uniforms[UNIFORM_OF[k]].value = params[k];
      }
      if (opts.reducedMotion) renderOnce();
    },
    getParams() { return { ...params }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      quad.geometry.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
