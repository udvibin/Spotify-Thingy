// Mandatory Vibe Compliance — orchestrator.
// Loads data, wires GSAP (optional), inits sections, lazily mounts visuals.
import { loadData, PERSON_COLORS, $ } from "./data.js";
import { initHero } from "./sections/hero.js";
import { initNumbers } from "./sections/numbers.js";
import { initGalaxy } from "./sections/galaxy.js";
import { initLeaderboard } from "./sections/leaderboard.js";
import { initBois } from "./sections/bois.js";
import { initBangers } from "./sections/bangers.js";
import { initConstellation } from "./sections/constellation.js";
import { initTimeline } from "./sections/timeline.js";
import { initTrendsetters } from "./sections/trendsetters.js";
import { initOutro } from "./sections/outro.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = matchMedia("(max-width: 820px)").matches || matchMedia("(pointer: coarse)").matches;

/* fire once when a node nears the viewport */
function onEnter(node, cb, margin = "300px") {
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { io.disconnect(); cb(); }
  }, { rootMargin: margin });
  io.observe(node);
}

/* keep calling cb(visible) as a node toggles visibility */
function watchVisible(node, cb) {
  new IntersectionObserver((es) => es.forEach((e) => cb(e.isIntersecting)), { threshold: 0.02 }).observe(node);
}

/* lazily import + init a visuals module for a section; never let it break the page.
   loader: async () => handle | onFail: build CSS fallback | onReady: receive handle */
function lazyVisual(section, loader, onFail, onReady) {
  onEnter(section, async () => {
    try {
      const handle = await loader();
      if (!handle || typeof handle.start !== "function") throw new Error("bad visuals handle");
      section.classList.add("viz-on");
      watchVisible(section, (v) => { try { v ? handle.start() : handle.pause(); } catch {} });
      addEventListener("resize", () => { try { handle.resize(); } catch {} });
      onReady?.(handle);
    } catch (err) {
      console.warn(`[viz fallback] #${section.id}:`, err);
      section.classList.add("viz-fail");
      try { onFail?.(); } catch (e) { console.warn(e); }
    }
  });
}

const ctx = {
  data: null, gsap: null, ScrollTrigger: null, reduced, mobile,
  onEnter, watchVisible, lazyVisual,
  visualOpts: (extra = {}) => ({
    mobile, dprCap: mobile ? 1.5 : 2, reducedMotion: reduced, personColors: PERSON_COLORS, ...extra,
  }),
};

/* simple class-based reveal for all [data-reveal] (works with or without gsap) */
function setupReveals() {
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "-6% 0px" });
  document.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
}

/* fixed fractal background behind everything */
async function initBg() {
  const canvas = $("#bg-canvas");
  try {
    const mod = await import("./visuals/fractal-bg.js");
    const h = await mod.initFractalBg(canvas, ctx.visualOpts());
    if (!h) throw new Error("no handle");
    document.body.classList.add("bg-live");
    h.start?.();
    let queued = false;
    addEventListener("scroll", () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const max = document.documentElement.scrollHeight - innerHeight;
        try { h.setScroll?.(max > 0 ? scrollY / max : 0); } catch {}
      });
    }, { passive: true });
    addEventListener("resize", () => { try { h.resize(); } catch {} });
  } catch (err) {
    console.warn("[viz fallback] fractal background:", err); // CSS gradient stays
  }
}

/* galaxy darkness choreography: scrub the fixed #bg-dim overlay with scroll so
   the background fades to near-black while the galaxy owns the viewport and
   comes back on the way out — both directions, no animation timers. */
function initGalaxyDim() {
  const sec = $("#galaxy"), dim = $("#bg-dim");
  if (!sec || !dim) return;
  let queued = false;
  const update = () => {
    queued = false;
    const r = sec.getBoundingClientRect();
    const vh = innerHeight || 1;
    // ramp in while the section top rises 85%→35% of the viewport, ramp out
    // while its bottom sinks 65%→15% (the desktop pin holds it at full dim)
    const enter = (vh * 0.85 - r.top) / (vh * 0.5);
    const exit = (r.bottom - vh * 0.15) / (vh * 0.5);
    const k = Math.max(0, Math.min(1, enter, exit));
    dim.style.opacity = (k * 0.88).toFixed(3);
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  update();
}

async function boot() {
  // 1. data is mandatory
  try {
    ctx.data = await loadData();
  } catch (err) {
    console.error(err);
    const l = $("#loader");
    l.classList.add("error");
    $("#loader-msg").textContent = "couldn't load the archive — try a refresh.";
    return;
  }

  // 2. gsap is a nice-to-have
  try {
    const g = await import("gsap");
    const s = await import("gsap/ScrollTrigger");
    ctx.gsap = g.gsap || g.default;
    ctx.ScrollTrigger = s.ScrollTrigger || s.default;
    ctx.gsap.registerPlugin(ctx.ScrollTrigger);
  } catch (err) {
    console.warn("gsap unavailable, CSS fallbacks active:", err);
    ctx.gsap = ctx.ScrollTrigger = null;
  }

  // 3. sections — each isolated so one bug never kills the story
  for (const init of [initHero, initNumbers, initGalaxy, initLeaderboard, initBois,
    initBangers, initConstellation, initTimeline, initTrendsetters, initOutro]) {
    try { init(ctx); } catch (err) { console.error(`section ${init.name} failed:`, err); }
  }

  setupReveals();
  initGalaxyDim();

  // dev: ?glass opens the frosted-glass tuner panel
  if (new URLSearchParams(location.search).has("glass")) {
    import("./glass-lab.js").then((m) => m.initGlassLab()).catch((e) => console.warn(e));
  }

  // 4. drop loader, then start the background
  const loader = $("#loader");
  loader.classList.add("done");
  setTimeout(() => loader.remove(), 700);
  initBg();
}

boot();
