// 9 · who put you on? — top trendsetters
import { $, el, chip, fmtDate, esc, artistSearchUrl } from "../data.js";

export function initTrendsetters(ctx) {
  const wrap = $("#trend-rows");
  const top = (ctx.data.trendsetters || []).slice(0, 8);

  top.forEach((t, i) => {
    const row = el("div", "trend");
    row.dataset.reveal = "";
    const main = el("div");
    // no artist id in data.json — deep-link to a Spotify search instead
    main.append(el("div", "artist",
      `<a class="ext" href="${artistSearchUrl(t.artist)}" target="_blank" rel="noopener">${esc(t.artist)}<span class="out">↗</span></a>`));
    const meta = el("div", "meta");
    meta.append(chip(t.first_by, t.first_by));
    meta.append(el("span", null, `first played it ${fmtDate(t.first_ts)}`));
    main.append(meta);
    const tally = el("div", "tally",
      `<b>${t.adopters}</b><small>adopter${t.adopters === 1 ? "" : "s"} · ${t.total_shares} shares</small>`);
    row.append(el("span", "rank", String(i + 1).padStart(2, "0")), main, tally);
    wrap.append(row);
  });
}
