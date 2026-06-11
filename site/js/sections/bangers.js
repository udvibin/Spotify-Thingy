// 6 · certified group bangers — crossovers + most re-shared (computed client-side)
// every card is a real link to open.spotify.com
import { $, el, colorOf, esc, trackUrl } from "../data.js";

function trackCard(uri, t, extraHtml = "") {
  const card = el("a", "track");
  card.href = trackUrl(uri);
  card.target = "_blank";
  card.rel = "noopener";
  card.setAttribute("aria-label", `${t.name} — open on Spotify`);
  card.dataset.reveal = "";
  card.innerHTML = `
    ${extraHtml}
    <img src="${t.art}" alt="${esc(t.name)} cover" loading="lazy" width="300" height="300">
    <div class="tmeta">
      <span class="tname">${esc(t.name)}<span class="out">↗</span></span>
      <span class="tartist">${esc((t.artists || []).join(", "))}</span>
    </div>`;
  return card;
}

export function initBangers(ctx) {
  const entries = Object.entries(ctx.data.tracks);

  // (a) crossovers: 2+ distinct sharers
  const cross = entries
    .map(([uri, t]) => ({ uri, t, who: Object.keys(t.shared_by || {}), n: Object.values(t.shared_by || {}).reduce((s, v) => s + v, 0) }))
    .filter((x) => x.who.length >= 2)
    .sort((a, b) => b.who.length - a.who.length || b.n - a.n)
    .slice(0, 12);

  const crossEl = $("#crossovers");
  if (!cross.length) {
    crossEl.replaceWith(el("p", "sub", "no crossovers yet — the bois remain stubbornly individual."));
  } else {
    for (const { uri, t, who } of cross) {
      const card = trackCard(uri, t);
      const chips = el("div", "who");
      chips.title = who.join(", ");
      for (const name of who) {
        const dot = el("i");
        dot.style.setProperty("--pc", colorOf(name));
        chips.append(dot);
      }
      card.querySelector(".tmeta").append(chips);
      crossEl.append(card);
    }
  }

  // (b) most re-shared: highest total share count
  const reshared = entries
    .map(([uri, t]) => ({ uri, t, n: Object.values(t.shared_by || {}).reduce((s, v) => s + v, 0) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);

  if (!reshared.length) {
    $("#reshared-block").remove();
  } else {
    const wrap = $("#reshared");
    for (const { uri, t, n } of reshared) wrap.append(trackCard(uri, t, `<span class="badge">×${n}</span>`));
  }
}
