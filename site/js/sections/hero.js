// 1 · hero — computed headline + vinyl visual
import { $, words, cap, monthsDiff } from "../data.js";

export function initHero(ctx) {
  const { meta, tracks } = ctx.data;
  const t = meta.totals;
  const [start, end] = meta.range.map((d) => new Date(d + "T12:00"));

  // overline: "… · EST. AUG 2021"
  const est = start.toLocaleDateString("en-GB", { month: "short", year: "numeric" }).toUpperCase();
  $("#hero-overline").textContent = `MANDATORY VIBE COMPLIANCE · EST. ${est}`;

  // headline: "Four years, ten months, nine hundred eighty-nine songs."
  let m = monthsDiff(start, end);
  const y = Math.floor(m / 12); m %= 12;
  const span = [];
  if (y) span.push(`${words(y)} year${y === 1 ? "" : "s"}`);
  if (m) span.push(`${words(m)} month${m === 1 ? "" : "s"}`);
  $("#hero-line").textContent = cap(`${span.join(", ")}, ${words(t.shares)} songs.`);

  // spinning vinyl (visuals module, CSS disc as fallback)
  const sec = $("#hero");
  const stage = $("#vinyl-stage");
  const firstTrack = Object.values(tracks)[0];
  ctx.lazyVisual(sec, async () => {
    const mod = await import("../visuals/vinyl.js");
    return mod.initVinyl(stage, ctx.visualOpts({
      labelTitle: "Mandatory Vibe Compliance",
      labelSubtitle: `est. ${est.toLowerCase()} · ${t.shares} tracks`,
      coverUrl: firstTrack?.art,
    }));
  });

  // entrance flourish
  if (ctx.gsap && !ctx.reduced) {
    ctx.gsap.from("#hero .overline, #hero .hero-line, #hero .vinyl-stage", {
      y: 36, opacity: 0, duration: 1, stagger: 0.12, ease: "power3.out", delay: 0.15,
    });
  }
}
