/* Gráficos SVG minimalistas, sem bibliotecas externas.
 * Todos os textos entram via textContent (dados não confiáveis). */
"use strict";

const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const tip = () => document.getElementById("tooltip");

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function showTip(evt, value, label) {
    const t = tip();
    t.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = value;
    const row = document.createElement("div");
    const key = document.createElement("span");
    key.className = "k";
    row.append(key, document.createTextNode(label));
    t.append(strong, row);
    t.classList.remove("hidden");
    let x, y;
    if (evt.type === "focus") {
      const r = evt.target.getBoundingClientRect();
      x = r.right; y = r.top;
    } else { x = evt.clientX; y = evt.clientY; }
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(x + 14, window.innerWidth - w - 8) + "px";
    t.style.top = Math.max(8, y - h - 10) + "px";
  }
  const hideTip = () => tip().classList.add("hidden");

  // Retângulo com cantos de 4px só na extremidade de dados (a base fica reta)
  function barPath(x, y, w, h, horizontal) {
    const r = Math.min(4, horizontal ? w / 2 : h / 2, horizontal ? h / 2 : w / 2);
    if (horizontal) {
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}` +
             `Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    }
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}` +
           `V${y + h}Z`;
  }

  function niceMax(v) {
    if (v <= 5) return 5;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
  }

  /** Barras horizontais: data = [{label, value}] */
  function hbar(container, data, opts = {}) {
    container.replaceChildren();
    if (!data.length) { emptyState(container, opts.empty); return; }
    const width = Math.max(280, container.clientWidth);
    const labelW = Math.min(150, width * 0.36);
    const rowH = 28, gap = 2, top = 4;
    const height = top + data.length * rowH + 4;
    const max = opts.max || niceMax(Math.max(...data.map(d => d.value)));
    const plotW = width - labelW - (data.some(d => d.display) ? 96 : 44);
    const svg = el("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, role: "img",
                            "aria-label": opts.title || "gráfico de barras" }, container);
    el("line", { class: "baseline", x1: labelW, x2: labelW, y1: 0, y2: height }, svg);
    data.forEach((d, i) => {
      const y = top + i * rowH;
      const g = el("g", { class: "row" }, svg);
      const lbl = el("text", { x: labelW - 8, y: y + rowH / 2 + 4, "text-anchor": "end" }, g);
      lbl.textContent = truncate(d.label, labelW / 7);
      const w = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * plotW);
      const hit = el("rect", { class: "hit", x: 0, y, width, height: rowH - gap, tabindex: 0,
                               "aria-label": `${d.label}: ${d.display || d.value}` }, g);
      el("path", { class: "mark", d: barPath(labelW + 1, y + 5, w, rowH - 10 - gap, true) }, g);
      const val = el("text", { class: "val num", x: labelW + w + 6, y: y + rowH / 2 + 4 }, g);
      const shown = d.display || d.value.toLocaleString("pt-PT");
      val.textContent = shown;
      for (const ev of ["pointermove", "focus"]) hit.addEventListener(ev, e => showTip(e, shown, d.label));
      for (const ev of ["pointerleave", "blur"]) hit.addEventListener(ev, hideTip);
      if (opts.onClick) {
        hit.style.cursor = "pointer";
        hit.addEventListener("click", () => opts.onClick(d));
        hit.addEventListener("keydown", e => { if (e.key === "Enter") opts.onClick(d); });
      }
    });
  }

  /** Colunas por dia: data = [{label, value}] (eixo temporal contínuo) */
  function columns(container, data, opts = {}) {
    container.replaceChildren();
    if (!data.some(d => d.value > 0)) { emptyState(container, opts.empty); return; }
    const width = Math.max(280, container.clientWidth);
    const height = 190, left = 34, bottom = 24, top = 10;
    const plotW = width - left - 4, plotH = height - top - bottom;
    const max = niceMax(Math.max(...data.map(d => d.value)));
    const svg = el("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, role: "img",
                            "aria-label": opts.title || "gráfico de colunas" }, container);
    for (let t = 0; t <= 4; t++) {
      const v = (max / 4) * t, y = top + plotH - (v / max) * plotH;
      el("line", { class: t ? "grid-line" : "baseline", x1: left, x2: width - 4, y1: y, y2: y }, svg);
      const tx = el("text", { class: "num", x: left - 6, y: y + 4, "text-anchor": "end" }, svg);
      tx.textContent = Number.isInteger(v) ? v : v.toFixed(1);
    }
    const slot = plotW / data.length, bw = Math.max(4, Math.min(28, slot - 2));
    data.forEach((d, i) => {
      const x = left + i * slot + (slot - bw) / 2;
      const h = (d.value / max) * plotH;
      const g = el("g", { class: "row" }, svg);
      const hit = el("rect", { class: "hit", x: left + i * slot, y: top, width: slot, height: plotH,
                               tabindex: 0, "aria-label": `${d.label}: ${d.value}` }, g);
      if (h > 0) el("path", { class: "mark", d: barPath(x, top + plotH - h, bw, h, false) }, g);
      if ((data.length - 1 - i) % Math.ceil(data.length / 7) === 0) {  // ancorado no último dia
        const tx = el("text", { x: x + bw / 2, y: height - 6, "text-anchor": "middle" }, svg);
        tx.textContent = d.short || d.label;
      }
      for (const ev of ["pointermove", "focus"]) hit.addEventListener(ev, e => showTip(e, String(d.value), d.label));
      for (const ev of ["pointerleave", "blur"]) hit.addEventListener(ev, hideTip);
    });
  }

  function emptyState(container, text) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text || "Sem dados ainda.";
    container.appendChild(p);
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, Math.max(3, n - 1)) + "…" : s;
  }

  return { hbar, columns };
})();
