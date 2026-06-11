// 7 · the taste constellation — similarity graph
import { $, el, colorOf, esc } from "../data.js";

export function initConstellation(ctx) {
  const sec = $("#constellation");
  const stage = $("#constellation-stage");
  const simSrc = ctx.data.similarity;
  const peopleData = ctx.data.people;

  const sim = {
    people: simSrc.people,
    matrix: simSrc.matrix,
    shares: Object.fromEntries(simSrc.people.map((p) => [p, peopleData[p]?.totals.shares || 0])),
    colors: Object.fromEntries(simSrc.people.map((p) => [p, colorOf(p)])),
  };

  // CSS fallback: top twins, straight from the matrix
  function buildFallback() {
    const wrap = $("#pairs");
    const pairs = [];
    for (let i = 0; i < sim.people.length; i++)
      for (let j = i + 1; j < sim.people.length; j++)
        pairs.push([sim.people[i], sim.people[j], sim.matrix[i]?.[j] || 0]);
    pairs.sort((a, b) => b[2] - a[2]);
    wrap.append(el("p", "sub", "the closest taste twins:"));
    for (const [a, b, v] of pairs.slice(0, 6)) {
      const row = el("div", "pair");
      const da = el("i"); da.style.setProperty("--pc", colorOf(a));
      const db = el("i"); db.style.setProperty("--pc", colorOf(b));
      row.append(da, el("span", "names", `${esc(a)} ✕ ${esc(b)}`), db,
        el("span", "pct", `${Math.round(v * 100)}%`));
      wrap.append(row);
    }
  }

  ctx.lazyVisual(sec, async () => {
    const mod = await import("../visuals/constellation.js");
    return mod.initConstellation(stage, sim, ctx.visualOpts());
  }, buildFallback);
}
