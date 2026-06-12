// Hero vinyl: direct top-down record with analytic groove shading.
// The disc is a custom shader (micro grooves + anisotropic sheen + track lands
// + edge bevel) so it stays crisp at any resolution; the paper label spins.
import * as THREE from "three";
import { makeRenderer, Loop, dpr } from "./common.js";

const DISC_R = 1.6;          // world radius of the record
const LABEL_R = 0.535;       // label radius (fraction of unit disc ~0.334)

const VERT = /* glsl */ `
varying vec2 vP;             // local disc coords, -1..1
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uSpin;         // platter angle (rad)
uniform float uTime;
uniform vec3 uCam;           // camera position in disc-local space
varying vec2 vP;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float r = length(vP);
  float aa = fwidth(r) * 1.2;
  if (r > 1.0 + aa) discard;
  vec2 dir = r > 1e-4 ? vP / r : vec2(1.0, 0.0);
  float ang = atan(vP.y, vP.x) + uSpin;     // rotates with the platter

  // ---- regions ---------------------------------------------------------------
  float LABEL = 0.345;                       // under the label mesh
  float groovesIn = LABEL + 0.025, groovesOut = 0.962;
  // 4 quiet "lands" between tracks (slightly irregular spacing)
  float land = 0.0;
  land += smoothstep(0.012, 0.004, abs(r - 0.475));
  land += smoothstep(0.011, 0.004, abs(r - 0.615));
  land += smoothstep(0.012, 0.004, abs(r - 0.742));
  land += smoothstep(0.011, 0.004, abs(r - 0.868));
  land = clamp(land, 0.0, 1.0);
  float inGrooves = smoothstep(groovesIn, groovesIn + 0.012, r) *
                    (1.0 - smoothstep(groovesOut, groovesOut + 0.01, r));

  // ---- groove micro-rings (irregular spacing via low-freq jitter) -------------
  float jit = noise(vec2(r * 47.0, 3.7)) * 5.0;
  float gph = r * 720.0 + jit;
  float saw = sin(gph);
  float amp = inGrooves * (1.0 - 0.85 * land) * 0.55;   // lands are smoother
  // perturbed normal: grooves tilt the surface radially
  float slope = cos(gph) * amp;
  vec3 N = normalize(vec3(dir * slope, 1.0));

  vec3 P = vec3(vP * 1.6, 0.0);
  vec3 V = normalize(uCam - P);
  vec3 T = vec3(-dir.y, dir.x, 0.0);        // circumferential tangent

  // ---- lighting ----------------------------------------------------------------
  // key + a slowly sweeping sheen light (sells the spin together with sparkle)
  vec3 L1 = normalize(vec3(0.55, 0.75, 0.85));
  float sw = uTime * 0.13;
  vec3 L2 = normalize(vec3(0.9 * cos(sw), 0.9 * sin(sw), 0.62));
  vec3 L3 = normalize(vec3(-0.7, -0.4, 0.55));            // cool rim fill

  vec3 base = vec3(0.030, 0.034, 0.040);                  // vinyl black
  base += vec3(0.010, 0.014, 0.016) * (0.5 + 0.5 * saw) * inGrooves; // ring micro-tone
  base += vec3(0.012, 0.020, 0.024) * land * inGrooves;   // lands catch more light
  // dead wax between label and grooves: smooth, slightly glossier-looking band
  float dead = smoothstep(LABEL, LABEL + 0.01, r) * (1.0 - smoothstep(groovesIn, groovesIn + 0.012, r));
  base += vec3(0.008, 0.010, 0.012) * dead;

  float diff = max(dot(N, L1), 0.0) * 0.55 + max(dot(N, L3), 0.0) * 0.18 + 0.30;
  vec3 col = base * diff;

  // anisotropic (Kajiya-Kay) specular: highlight streaks run ACROSS the grooves
  float rough = mix(0.0, 1.0, inGrooves) * (1.0 - 0.6 * land);
  float shin = mix(420.0, 48.0, rough);                  // lands & dead wax = sharper
  float specAmp = mix(0.55, 0.34, rough);
  vec3 specCol = vec3(0.62, 0.74, 0.80);                 // cool cyan-tinted sheen

  vec3 H1 = normalize(L1 + V);
  vec3 H2 = normalize(L2 + V);
  float th1 = dot(T, H1), th2 = dot(T, H2);
  float s1 = pow(max(1.0 - th1 * th1, 0.0), shin * 0.5);
  float s2 = pow(max(1.0 - th2 * th2, 0.0), shin * 0.5);
  // sparkle: per-groove glints that rotate with the record
  float glint = 0.65 + 0.7 * noise(vec2(ang * 38.0, r * 230.0));
  col += specCol * (s1 * 0.8 + s2 * 0.9) * specAmp * glint * (0.25 + 0.75 * inGrooves);

  // broad soft "window" reflection sweeping very slowly
  float refl = pow(max(dot(reflect(-V, N), L2), 0.0), 6.0);
  col += vec3(0.10, 0.13, 0.15) * refl * 0.30;

  // ---- edge bevel + outer rim ----------------------------------------------------
  float bevel = smoothstep(0.962, 0.985, r) * (1.0 - smoothstep(0.992, 1.0, r));
  col += vec3(0.16, 0.20, 0.23) * bevel * (0.35 + 0.65 * s2 + 0.4 * s1);
  col *= 1.0 - 0.55 * smoothstep(0.992, 1.0, r);          // darken the very edge

  // under-label area: matte dark (label mesh sits on top)
  col = mix(vec3(0.02, 0.022, 0.026), col, smoothstep(LABEL - 0.01, LABEL, r));

  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---- paper label (Currents palette: cream paper, coral + teal print) ----------
function drawLabel(cv, title, sub, coverImg) {
  const c = cv.getContext("2d");
  const S = cv.width, H = S / 2;
  c.clearRect(0, 0, S, S);
  // cream paper with a hint of radial shading
  const g = c.createRadialGradient(H * 0.92, H * 0.9, S * 0.1, H, H, H);
  g.addColorStop(0, "#f4efe2");
  g.addColorStop(0.75, "#eee9dd");
  g.addColorStop(1, "#ddd5c4");
  c.fillStyle = g;
  c.beginPath(); c.arc(H, H, H, 0, 7); c.fill();
  // paper grain
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * H;
    c.fillStyle = Math.random() < 0.5 ? "rgba(120,105,80,.05)" : "rgba(255,255,255,.06)";
    c.fillRect(H + Math.cos(a) * rr, H + Math.sin(a) * rr, 1.4, 1.4);
  }
  if (coverImg) {
    c.save();
    c.beginPath(); c.arc(H, H, H - 10, 0, 7); c.clip();
    c.globalAlpha = 0.10;
    c.drawImage(coverImg, 0, 0, S, S);
    c.restore();
  }
  // coral edge band + thin teal pinline (Currents print colors)
  c.strokeStyle = "#e4593b";
  c.lineWidth = S * 0.030;
  c.beginPath(); c.arc(H, H, H - S * 0.024, 0, 7); c.stroke();
  c.strokeStyle = "#3e8fae";
  c.lineWidth = S * 0.006;
  c.beginPath(); c.arc(H, H, H - S * 0.052, 0, 7); c.stroke();

  const navy = "#0a161d";
  c.textAlign = "center";
  c.textBaseline = "middle";
  // curved "SIDE A · 33 1/3 RPM" around the top
  c.fillStyle = "#a8472f";
  c.font = `600 ${S * 0.042}px system-ui, sans-serif`;
  const arc = "SIDE A · 33⅓ RPM · LONG PLAY";
  const arcR = H - S * 0.105, a0 = -Math.PI / 2 - 0.85;
  for (let i = 0; i < arc.length; i++) {
    const a = a0 + (1.7 * i) / Math.max(arc.length - 1, 1);
    c.save();
    c.translate(H + Math.cos(a) * arcR, H + Math.sin(a) * arcR);
    c.rotate(a + Math.PI / 2);
    c.fillText(arc[i], 0, 0);
    c.restore();
  }
  // title (wrap to two lines if needed)
  let fs = S * 0.085;
  c.fillStyle = navy;
  c.font = `700 ${fs}px Georgia, 'Times New Roman', serif`;
  const wordsArr = String(title).split(/\s+/);
  let lines = [String(title)];
  if (c.measureText(title).width > S * 0.62 && wordsArr.length > 1) {
    const mid = Math.ceil(wordsArr.length / 2);
    lines = [wordsArr.slice(0, mid).join(" "), wordsArr.slice(mid).join(" ")];
  }
  while (lines.some((ln) => c.measureText(ln).width > S * 0.62) && fs > S * 0.03) {
    fs -= 2; c.font = `700 ${fs}px Georgia, 'Times New Roman', serif`;
  }
  lines.forEach((ln, i) => c.fillText(ln, H, H - S * 0.075 + i * fs * 1.12));
  // divider
  c.strokeStyle = "#e4593b";
  c.lineWidth = S * 0.004;
  c.beginPath(); c.moveTo(H - S * 0.14, H + S * 0.052); c.lineTo(H + S * 0.14, H + S * 0.052); c.stroke();
  // subtitle
  c.fillStyle = "#3e6e84";
  let fs2 = S * 0.046;
  c.font = `400 ${fs2}px system-ui, sans-serif`;
  while (c.measureText(sub).width > S * 0.60 && fs2 > S * 0.02) {
    fs2 -= 2; c.font = `400 ${fs2}px system-ui, sans-serif`;
  }
  if (sub) c.fillText(sub, H, H + S * 0.118);
  c.fillStyle = "rgba(10,22,29,.62)";
  c.font = `500 ${S * 0.034}px system-ui, sans-serif`;
  c.fillText("STEREO · MVC RECORDS", H, H + S * 0.195);
  // spindle hole with paper rim shadow
  c.fillStyle = "rgba(0,0,0,.18)";
  c.beginPath(); c.arc(H, H + 1.5, S * 0.035, 0, 7); c.fill();
  c.fillStyle = "#0b0d10";
  c.beginPath(); c.arc(H, H, S * 0.030, 0, 7); c.fill();
  c.fillStyle = "rgba(255,255,255,.16)";
  c.beginPath(); c.arc(H - S * 0.008, H - S * 0.008, S * 0.008, 0, 7); c.fill();
}

function shadowTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(128, 128, 30, 128, 128, 128);
  g.addColorStop(0, "rgba(0,0,0,.55)");
  g.addColorStop(0.7, "rgba(0,0,0,.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}

export async function initVinyl(container, opts = {}) {
  const renderer = makeRenderer(null, { antialias: true, alpha: true });
  renderer.setPixelRatio(dpr(opts.dprCap));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 4.6, 0);           // straight down — symmetric disc
  camera.up.set(0, 0, -1);                  // screen-up = label-up when looking down
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();   // pointer tilt + wobble
  const platter = new THREE.Group(); // spin (label, specs rotate via uSpin)
  group.add(platter);
  scene.add(group);

  // soft drop shadow under the record (depth cue on the page background)
  const shadowTex = shadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(DISC_R * 2.55, DISC_R * 2.55);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.10, -0.10, 0.16);
  group.add(shadow);

  // the record itself: analytic shader disc
  const uniforms = {
    uSpin: { value: 0 },
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
  };
  const discGeo = new THREE.CircleGeometry(DISC_R, 128);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  group.add(disc); // NOT in platter: the shader pattern is radially symmetric and
                   // lights must stay world-fixed; rotation cues come from uSpin + label

  // thin dark side wall so the edge reads when tilted
  const rimGeo = new THREE.CylinderGeometry(DISC_R, DISC_R, 0.035, 128, 1, true);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x05070a });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.y = -0.018;
  group.add(rim);

  // paper label (spins with the platter — primary rotation cue)
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = labelCanvas.height = 1024;
  const title = opts.labelTitle || "MANDATORY VIBE COMPLIANCE";
  const sub = opts.labelSubtitle || "";
  drawLabel(labelCanvas, title, sub);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.anisotropy = 8;
  const labelGeo = new THREE.CircleGeometry(LABEL_R, 96);
  const label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
  label.rotation.x = -Math.PI / 2;
  label.position.y = 0.004;
  platter.add(label);

  let disposed = false;
  if (opts.coverUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (disposed) return;
      drawLabel(labelCanvas, title, sub, img);
      labelTex.needsUpdate = true;
      if (opts.reducedMotion) renderOnce();
    };
    img.src = opts.coverUrl;
  }

  const baseTilt = { x: 0, z: 0 };          // rests dead-symmetric top-down
  const tiltTarget = { x: 0, z: 0 };
  const onPointer = (e) => {
    tiltTarget.x = (e.clientY / window.innerHeight - 0.5) * 0.09;
    tiltTarget.z = -(e.clientX / window.innerWidth - 0.5) * 0.09;
  };
  const interactive = !opts.mobile && !opts.reducedMotion;
  if (interactive) window.addEventListener("pointermove", onPointer, { passive: true });

  if (opts.reducedMotion) {
    platter.rotation.y = 0.8;
    uniforms.uSpin.value = 0.8;
    uniforms.uTime.value = 5.0;
  }

  const camDir = camera.position.clone().normalize();
  const doResize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // Back the camera off so the FULL disc always fits with margin, whatever
    // the stage's aspect (it used to clip at a fixed distance).
    const vt = Math.tan((camera.fov * Math.PI) / 360);
    const margin = 1.18;
    const dV = (DISC_R * margin) / vt;                   // vertical
    const dH = (DISC_R * margin) / (vt * camera.aspect); // horizontal
    camera.position.copy(camDir).multiplyScalar(Math.max(dV, dH));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  doResize();

  const _camLocal = new THREE.Vector3();
  const updateCamUniform = () => {
    // camera position in disc-local space (disc plane = local XY in shader terms)
    _camLocal.copy(camera.position);
    disc.updateMatrixWorld();
    disc.worldToLocal(_camLocal);
    // shader space: vP maps to local XZ (after rotateX), so swizzle: x->x, z->y, y->z
    uniforms.uCam.value.set(_camLocal.x, -_camLocal.z, _camLocal.y);
  };
  updateCamUniform();

  const renderOnce = () => {
    if (disposed) return;
    try { updateCamUniform(); renderer.render(scene, camera); } catch (e) { console.error("[vinyl]", e); }
  };

  const SPIN = (Math.PI * 2) / 12;   // lazy, hypnotic spin (~1 rev / 12 s)
  let t = 0;
  const loop = new Loop((dt) => {
    t += dt;
    platter.rotation.y += SPIN * dt;
    uniforms.uSpin.value = platter.rotation.y;
    uniforms.uTime.value = t;
    // very subtle warped-record wobble
    const wob = Math.sin(platter.rotation.y) * 0.006;
    const k = 1 - Math.exp(-5 * dt);
    group.rotation.x += (baseTilt.x + tiltTarget.x + wob - group.rotation.x) * k;
    group.rotation.z += (baseTilt.z + tiltTarget.z - wob * 0.7 - group.rotation.z) * k;
    updateCamUniform();
    renderer.render(scene, camera);
  });

  if (opts.reducedMotion) renderOnce();

  return {
    start() {
      if (disposed) return;
      if (opts.reducedMotion) renderOnce();
      else loop.start();
    },
    pause() { loop.pause(); },
    resize() {
      if (disposed) return;
      doResize();
      if (opts.reducedMotion) renderOnce();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      if (interactive) window.removeEventListener("pointermove", onPointer);
      discGeo.dispose(); discMat.dispose();
      rimGeo.dispose(); rimMat.dispose();
      labelGeo.dispose(); label.material.dispose(); labelTex.dispose();
      shadowGeo.dispose(); shadowMat.dispose(); shadowTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
