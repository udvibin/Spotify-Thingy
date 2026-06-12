// Dev-only frosted-glass tuner — open index.html?glass to use it.
// Drives the --glass-* custom properties live; "copy" puts the values on the
// clipboard so they can be pasted into :root in style.css.
const KNOBS = [
  // label, css var, min, max, step, format
  ["fill", "--glass-fill", 0, 2, 0.05, (v) => String(v)],
  ["blur", "--glass-blur", 0, 32, 1, (v) => `${v}px`],
  ["saturate", "--glass-sat", 100, 220, 5, (v) => `${v}%`],
];

export function initGlassLab() {
  const root = document.documentElement;
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:80;width:230px;" +
    "background:rgba(8,6,16,.92);border:1px solid rgba(255,255,255,.14);" +
    "border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:7px;" +
    "font:12px/1.5 'Space Grotesk',system-ui,sans-serif;color:#eee9dd";
  panel.innerHTML = `<b style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7">glass lab</b>`;

  const current = {};
  for (const [label, cssVar, min, max, step, fmt] of KNOBS) {
    const raw = parseFloat(getComputedStyle(root).getPropertyValue(cssVar)) || min;
    current[cssVar] = fmt(raw);
    const row = document.createElement("label");
    row.style.cssText = "display:grid;grid-template-columns:58px 1fr 44px;gap:8px;align-items:center";
    row.innerHTML =
      `<span style="opacity:.85">${label}</span>` +
      `<input type="range" min="${min}" max="${max}" step="${step}" value="${raw}" style="width:100%;accent-color:#e4593b">` +
      `<span style="text-align:right;opacity:.7;font-variant-numeric:tabular-nums">${fmt(raw)}</span>`;
    const slider = row.querySelector("input");
    const val = row.lastElementChild;
    slider.addEventListener("input", () => {
      const v = fmt(parseFloat(slider.value));
      current[cssVar] = v;
      val.textContent = v;
      root.style.setProperty(cssVar, v);
    });
    panel.appendChild(row);
  }

  const copy = document.createElement("button");
  copy.textContent = "copy values";
  copy.style.cssText =
    "margin-top:4px;background:#1b1430;color:#eee9dd;border:1px solid rgba(255,255,255,.2);" +
    "border-radius:7px;padding:5px 10px;font:inherit;cursor:pointer";
  copy.addEventListener("click", async () => {
    const text = KNOBS.map(([, v]) => `  ${v}:${current[v]};`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "copied ✓";
    } catch {
      copy.textContent = text; // clipboard blocked — show inline instead
    }
    setTimeout(() => (copy.textContent = "copy values"), 1600);
  });
  panel.appendChild(copy);

  document.body.appendChild(panel);
}
