// 7 · the genre nebulae — artists as stars, genre families as nebula clouds,
// each boi a constellation traced through the artists they've shared.
// (Replaces the v1 similarity graph; data comes from data.json["genres"].)
import { $, el, colorOf, esc } from "../data.js";
import { FAMILY_COLORS } from "../visuals/family-colors.js";

export function initConstellation(ctx) {
  const sec = $("#constellation");
  const stage = $("#constellation-stage");
  const genres = ctx.data.genres;
  const hasGenres = genres && genres.artists && Object.keys(genres.artists).length;

  const people = (ctx.data.similarity && ctx.data.similarity.people) || Object.keys(ctx.data.people || {});
  const colors = Object.fromEntries(people.map((p) => [p, colorOf(p)]));

  // CSS fallback: the genre families, biggest first
  function buildFallback() {
    const wrap = $("#pairs");
    if (!hasGenres) { wrap.append(el("p", "sub", "taste, mapped by genre.")); return; }
    wrap.append(el("p", "sub", "the group's genre nebulae:"));
    const fams = Object.entries(genres.families).sort((a, b) => b[1].shares - a[1].shares);
    for (const [name, f] of fams.slice(0, 7)) {
      const row = el("div", "pair");
      const dot = el("i"); dot.style.setProperty("--pc", FAMILY_COLORS[name] || "#8a93a6");
      row.append(dot, el("span", "names", esc(name)),
        el("span", "pct", `${f.artists}`));
      wrap.append(row);
    }
  }

  if (!hasGenres) { buildFallback(); return; }

  const neb = { families: genres.families, artists: genres.artists, people, colors };

  // scroll choreography: fade + drift the nebula in as the section enters the
  // viewport and out as it leaves (mirrors the #bg-dim ramp timing).
  let handle = null, queued = false;
  const reveal = () => {
    queued = false;
    if (!handle || !handle.setReveal) return;
    const r = sec.getBoundingClientRect();
    const vh = innerHeight || 1;
    const enter = (vh * 0.92 - r.top) / (vh * 0.5);
    const exit = (r.bottom - vh * 0.08) / (vh * 0.5);
    handle.setReveal(Math.max(0, Math.min(1, enter, exit)));
  };
  const onReveal = () => { if (!queued) { queued = true; requestAnimationFrame(reveal); } };

  ctx.lazyVisual(sec, async () => {
    const mod = await import("../visuals/nebulae.js");
    return mod.initNebulae(stage, neb, ctx.visualOpts());
  }, buildFallback, (h) => {
    handle = h;
    addEventListener("scroll", onReveal, { passive: true });
    addEventListener("resize", onReveal);
    reveal();
  });
}
