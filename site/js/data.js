// data loading + shared helpers (no DOM framework, no build step)

/* person palette tuned to the Currents tokens (coral/pink/teal/cyan + warm neighbours) */
export const PERSON_COLORS = {
  Uday: "#e4593b", Shridhar: "#7cc4dc", Pratyush: "#ef8d9c", Ammar: "#e8b15a",
  Dhawal: "#3e8fae", Sameer: "#a8c46f", Dhruvajit: "#d98c66", Kunal: "#6f8fd6",
  Tushar: "#f2d06b", Praneet: "#c4536e", Karan: "#6fc4a8", Shaury: "#a98ad6",
  Ankit: "#9db4bd",
};

export const colorOf = (name) => PERSON_COLORS[name] || "#9db4bd";

/* ---- Spotify deep links ---- */
export const trackUrl = (uri) => "https://open.spotify.com/track/" + uri.split(":").pop();
export const artistSearchUrl = (name) => "https://open.spotify.com/search/" + encodeURIComponent(name);

export async function loadData() {
  const res = await fetch("./data.json");
  if (!res.ok) throw new Error(`data.json fetch failed (${res.status})`);
  return res.json();
}

/* ---- tiny DOM helpers ---- */
export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* person chip (button when onClick given, else inert span) */
export function chip(label, person, onClick) {
  const c = el(onClick ? "button" : "span", "chip");
  c.type = onClick ? "button" : undefined;
  c.style.setProperty("--pc", person ? colorOf(person) : "#f2eefb");
  c.append(el("i", "dot"), document.createTextNode(label));
  if (onClick) c.addEventListener("click", onClick);
  return c;
}

/* ---- math / formatting ---- */
export function argmax(arr) {
  let bi = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[bi]) bi = i;
  return bi;
}

export const fmtDate = (ts) => {
  const d = new Date(ts);
  return isNaN(d) ? String(ts) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const fmtMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

export function monthsDiff(a, b) {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m--;
  return Math.max(0, m);
}

/* number → english words (enough for our counts) */
const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
export function words(n) {
  n = Math.round(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[(n / 10) | 0] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[(n / 100) | 0] + " hundred" + (n % 100 ? " " + words(n % 100) : "");
  return n.toLocaleString("en");
}
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---- instant tooltip (shared singleton; zero transition lag) ---- */
let _tip = null;
export function instantTip() {
  if (!_tip) {
    _tip = el("div", "hover-tip");
    _tip.style.display = "none";
    document.body.append(_tip);
  }
  return {
    show(x, y, html) {
      _tip.innerHTML = html;
      _tip.style.display = "block";
      const r = _tip.getBoundingClientRect();
      const px = Math.min(Math.max(8, x + 14), innerWidth - r.width - 8);
      const py = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
      _tip.style.left = px + "px";
      _tip.style.top = py + "px";
    },
    hide() { _tip.style.display = "none"; },
  };
}

/* eased count-up, runs standalone (no gsap dependency) */
export function countUp(node, target, { duration = 1400, instant = false } = {}) {
  if (instant) { node.textContent = target.toLocaleString("en"); return; }
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
    node.textContent = Math.round(target * e).toLocaleString("en");
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}
