// 2 · the numbers — count-up stats
import { $, el, countUp } from "../data.js";

export function initNumbers(ctx) {
  const { totals } = ctx.data.meta;
  const [a, b] = ctx.data.meta.range.map((d) => new Date(d + "T12:00"));
  const days = Math.round((b - a) / 864e5) + 1;

  const stats = [
    [totals.shares, "songs shared"],
    [totals.unique_tracks, "unique tracks"],
    [totals.artists, "artists"],
    [totals.messages, "messages"],
    [totals.media, "memes & media"],
    [days, "days of compliance"],
  ];

  const wrap = $("#stats");
  const nums = stats.map(([value, label]) => {
    const s = el("div", "stat");
    s.dataset.reveal = "";
    const num = el("span", "num grad", "0");
    s.append(num, el("span", "lbl", label));
    wrap.append(s);
    return { num, value };
  });

  ctx.onEnter(wrap, () => {
    nums.forEach(({ num, value }, i) =>
      setTimeout(() => countUp(num, value, { instant: ctx.reduced }), i * 110));
  }, "-60px");
}
