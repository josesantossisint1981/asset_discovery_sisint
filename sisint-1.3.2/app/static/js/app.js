/* SISINT - frontend (JavaScript simples, sem build nem dependências).
 * Regra de segurança: dados vindos da API entram SEMPRE por textContent, nunca innerHTML. */
"use strict";

const CSRF = document.querySelector('meta[name="csrf-token"]').content;
const ROLE = document.body.dataset.role;
const DEMO = document.body.dataset.demo === "1";
const LEVEL = { viewer: 1, operator: 2, admin: 3 };
const can = role => LEVEL[ROLE] >= LEVEL[role];
const view = document.getElementById("view");
const head = document.getElementById("page-head");

// ------------------------------------------------------------------ utilitários
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Cada navegação invalida os pedidos das vistas anteriores (evita que uma resposta
// atrasada desenhe conteúdo antigo na página nova).
let navToken = 0;

async function api(path, opts = {}) {
  const token = navToken;
  const init = { method: opts.method || "GET", headers: { "X-CSRF-Token": CSRF }, credentials: "same-origin" };
  if (opts.json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.json);
  } else if (opts.form) {
    init.body = opts.form;
  }
  const res = await fetch(path, init);
  if (res.status === 401) { location.href = "/login"; throw new Error("sessão expirada"); }
  const data = await res.json().catch(() => ({}));
  if (!opts.global && token !== navToken) return new Promise(() => {});   // vista já abandonada
  if (!res.ok) throw new Error(data.error || `erro ${res.status}`);
  return data;
}

const fmtDate = s => s ? new Date(s.replace(" ", "T") + "Z").toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—";
const STATUS_PT = { queued: "em fila", running: "a processar", done: "concluída", error: "erro", cancelled: "cancelada" };
const KIND_PT = { switch: "Switch", router: "Router", firewall: "Firewall" };
const badge = s => h("span", { class: `badge ${s}` }, STATUS_PT[s] || s);
const alertBox = (msg, kind = "err") => h("div", { class: `alert ${kind}`, role: kind === "err" ? "alert" : "status" }, msg);

function setHead(title, sub) {
  head.replaceChildren(h("h1", {}, title), sub ? h("p", { class: "sub" }, sub) : "");
  document.title = `${title} · SISINT`;
}

// --------------------------------------------------------------------- router
const routes = { dashboard: Dashboard, discovery: DiscoveryView, inventory: InventoryView, scan: ScanView,
                 assets: AssetsView, devices: DevicesView, history: HistoryView, admin: AdminView };
let cleanup = null;

function navigate() {
  const [, name = "dashboard", param] = location.hash.split("/");
  const fn = routes[name] || Dashboard;
  document.querySelectorAll(".nav a").forEach(a => {
    if (a.dataset.view === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  navToken++;
  if (cleanup) { cleanup(); cleanup = null; }
  document.getElementById("tooltip").classList.add("hidden");
  view.replaceChildren();
  fn(param ? decodeURIComponent(param) : undefined).catch(err => view.append(alertBox(err.message)));
}

document.querySelectorAll(".nav a[data-min-role]").forEach(a => { if (!can(a.dataset.minRole)) a.remove(); });
document.getElementById("logout").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST", global: true }); } finally { location.href = "/login"; }
});
window.addEventListener("hashchange", navigate);

// ----------------------------------------------------- indicador global (topo)
// Mostra, em qualquer página, a recolha/descoberta em curso e o passo atual.
const Live = (() => {
  const btn = document.getElementById("live");
  const text = document.getElementById("live-text");
  const bar = document.getElementById("live-bar");
  let timer = null, cur = null;   // {kind: "scan"|"discovery", id}
  btn.addEventListener("click", () => { if (cur) location.hash = `#/${cur.kind}/${cur.id}`; });

  async function tick() {
    try {
      let steps, status, label;
      if (cur.kind === "scan") {
        const { scan } = await api(`/api/scans/${cur.id}`, { global: true });
        steps = scan.steps; status = scan.status; label = scan.device;
      } else {
        const d = await api(`/api/discovery/${cur.id}`, { global: true });
        steps = d.state.steps || []; status = d.run.status; label = `Levantamento #${cur.id}`;
      }
      const { pct, current } = progressOf(steps);
      text.textContent = `${label}: ${current ? current.label : "a terminar"}`;
      bar.style.width = pct + "%";
      if (!["running", "queued"].includes(status)) { stop(); return; }
    } catch { stop(); return; }
    timer = setTimeout(tick, 1500);
  }
  function track(id, kind = "scan") { cur = { id, kind }; btn.classList.remove("hidden"); clearTimeout(timer); tick(); }
  function stop() { clearTimeout(timer); btn.classList.add("hidden"); }
  function finished(id, kind = "scan") { if (cur && cur.id === id && cur.kind === kind) stop(); }
  return { track, finished };
})();

function progressOf(steps) {
  const finished = steps.filter(s => ["done", "skipped"].includes(s.status)).length;
  const running = steps.some(s => s.status === "running") ? 0.5 : 0;
  return { pct: Math.round(((finished + running) / steps.length) * 100),
           current: steps.find(s => s.status === "running") };
}

// ------------------------------------------------------------------ dashboard
async function Dashboard() {
  setHead("Dashboard", "Inventário consolidado: IP, MAC, Vendor, Model, Firmware/Version e Serial number.");
  const d = await api("/api/dashboard");
  const k = d.kpis;
  const tile = (label, value, hint, bad) => h("div", { class: "card kpi" },
    h("div", { class: "label" }, label), h("div", { class: "value" }, value.toLocaleString("pt-PT")),
    hint ? h("div", { class: `hint${bad ? " bad" : ""}` }, hint) : "");
  const pct = n => (k.assets ? Math.round((n / k.assets) * 100) : 0);
  view.append(h("section", { class: "grid kpis", "aria-label": "Indicadores" },
    tile("Ativos inventariados", k.assets, "IP e/ou MAC conhecidos"),
    tile("Fichas completas", k.complete, `${pct(k.complete)}% com os 6 campos`),
    tile("Switches", k.switches, "com ativos associados a portas"),
    tile("Novos (7 dias)", k.new_7d, "primeira deteção"),
    tile("Levantamentos com erro", k.runs_err, "últimos 7 dias", k.runs_err > 0)));
  if (!k.assets) {
    view.append(h("div", { class: "card" }, h("h2", {}, "Ainda não há ativos"),
      h("p", {}, "Comece por um levantamento de rede: o SISINT determina a rede (ou usa a indicada), encontra os ativos e completa a ficha de cada um."),
      can("operator") ? h("a", { class: "btn primary", href: "#/discovery/new" }, "Novo levantamento") : ""));
    return;
  }
  const covBox = h("div"), swBox = h("div"), venBox = h("div"), typeBox = h("div"), dayBox = h("div");
  view.append(h("section", { class: "grid two" },
    h("div", { class: "card" }, h("h2", {}, "Cobertura dos campos da lista"), covBox),
    h("div", { class: "card" }, h("h2", {}, "Ativos por switch"), swBox)));
  view.append(h("section", { class: "grid two" },
    h("div", { class: "card" }, h("h2", {}, "Ativos por fabricante"), venBox),
    h("div", { class: "card" }, h("h2", {}, "Ativos por tipo"), typeBox)));
  const runsBody = h("tbody");
  view.append(h("section", { class: "grid two" },
    h("div", { class: "card" }, h("h2", {}, "Novos ativos por dia (14 dias)"), dayBox),
    h("div", { class: "card" }, h("h2", {}, "Últimos levantamentos"),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Estado"), h("th", {}, "Ativos"), h("th", {}, "Início"))),
        runsBody)))));
  d.runs.forEach(r => runsBody.append(h("tr", {}, h("td", {}, h("a", { href: `#/discovery/${r.id}` }, `#${r.id}`)),
    h("td", {}, badge(r.status)), h("td", { class: "num" }, r.asset_count), h("td", {}, fmtDate(r.started_at)))));

  const byDay = Object.fromEntries(d.new_per_day.map(r => [r.day, r.total]));
  const days = [...Array(14)].map((_, i) => {
    const dt = new Date(Date.now() - (13 - i) * 864e5);
    return { label: dt.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" }),
             short: dt.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
             value: byDay[dt.toISOString().slice(0, 10)] || 0 };
  });
  const draw = () => {
    Charts.hbar(covBox, d.coverage.map(c => ({ label: c.label, value: pct(c.total),
      display: `${pct(c.total)}% (${c.total}/${k.assets})` })), { title: "Cobertura dos campos", max: 100 });
    Charts.hbar(swBox, d.per_switch.map(x => ({ label: x.label, value: x.total })), { title: "Ativos por switch" });
    Charts.hbar(venBox, d.vendors.map(x => ({ label: x.label, value: x.total })), { title: "Ativos por fabricante" });
    Charts.hbar(typeBox, d.types.map(x => ({ label: x.label, value: x.total })), { title: "Ativos por tipo" });
    Charts.columns(dayBox, days, { title: "Novos ativos por dia", empty: "Sem ativos novos nos últimos 14 dias." });
  };
  draw();
  const onResize = () => { clearTimeout(onResize.t); onResize.t = setTimeout(draw, 150); };
  window.addEventListener("resize", onResize);
  cleanup = () => window.removeEventListener("resize", onResize);
}

// ---------------------------------------------------------- descoberta de rede
const FIELDS = [["ip", "IP"], ["mac", "MAC"], ["vendor", "Vendor"], ["model", "Model"], ["firmware", "Firmware/Version"], ["serial", "Serial number"]];
const DISC_STEPS = ["Validação e âmbito", "Determinar a rede", "Determinar VLANs", "Ativos ativos (IP + MAC)",
  "Portas abertas por ativo", "Protocolos e serviços", "Recolha por protocolo", "Lista final"];

async function DiscoveryView(runId) {
  setHead("Levantamento de rede OT", "IPs e MACs → portas abertas → protocolo (industrial ou IT) → Vendor, Model, Firmware e Serial number.");
  const [ctx, { runs }] = await Promise.all([api("/api/discovery/context"), api("/api/discovery")]);
  if (runId === "new") runId = undefined;
  if (!runId && ctx.running) runId = String(ctx.running);
  view.append(runSelector(runs, runId, ctx.running));
  const wizard = h("ol", { class: "wizard", "aria-label": "Passos do assistente" },
    ["Rede", "Opções", "Autorização", "Processamento"].map(t => h("li", {}, t)));
  const setWizard = idx => [...wizard.children].forEach((li, i) => {
    li.className = i < idx ? "complete" : i === idx ? "current" : "";
    li.toggleAttribute("aria-current", i === idx);
  });
  view.append(wizard);
  if (runId) { setWizard(3); followDiscovery(Number(runId), setWizard); return; }
  if (!can("operator")) { view.append(alertBox("Sem permissão para iniciar levantamentos.")); return; }

  // 1. Rede
  let mode = "auto";
  const modeBtns = [["auto", "Detetar automaticamente", "interfaces, rotas, LLDP/CDP, ARP e VLANs"],
                    ["manual", "Indicar rede(s)", "uma rede CIDR por linha"]].map(([key, t, dsc]) =>
    h("button", { type: "button", class: "method", "aria-pressed": String(key === mode), "data-m": key,
                  onclick: () => pickMode(key) }, h("strong", {}, t), h("span", {}, dsc)));
  const netsBox = h("div", { class: "hidden" }, h("label", { for: "n-nets" }, `Redes (máx. ${ctx.max_hosts} endereços no total)`),
    h("textarea", { id: "n-nets", rows: 3, placeholder: "192.168.1.0/24\n10.0.20.0/24", spellcheck: "false" }));
  const ifPick = interfacePicker(ctx);
  function pickMode(key) {
    mode = key;
    modeBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === key)));
    netsBox.classList.toggle("hidden", key !== "manual");
    refresh();
  }
  // 2. Opções
  const tools = h("div", { class: "chips" }, Object.entries(ctx.tools).map(([t, ok]) =>
    h("span", { class: `chip ${ok ? "ok" : "bad"}` }, `${ok ? "✓" : "✗"} ${t}`)),
    h("span", { class: `chip ${ctx.root ? "ok" : "warn"}` }, ctx.root ? "✓ privilégios de rede" : "! sem privilégios (ARP/UDP/SO limitados)"));
  const opts = h("fieldset", {}, h("legend", {}, "2. Opções"), tools,
    h("div", { class: "row" },
      h("div", {}, h("label", { for: "o-int" }, "Perfil de varrimento"), h("select", { id: "o-int" },
        h("option", { value: "ot", selected: true }, "OT seguro — portas industriais, ≤50 pacotes/s, sem deteção de SO (recomendado)"),
        h("option", { value: "quick" }, "IT rápido — 100 portas TCP"),
        h("option", { value: "normal" }, "IT normal — 1000 portas + SO"),
        h("option", { value: "full" }, "IT completo — todas as portas"))),
      h("div", {}, h("label", { for: "o-listen" }, "Escuta passiva (s)"), h("input", { id: "o-listen", type: "number", min: 5, max: 600, value: 120 }))),
    h("p", { class: "muted", id: "o-int-warn", hidden: true }, "Atenção: os perfis IT enviam mais tráfego e incluem deteção de SO, que pode afetar PLC, RTU e IED sensíveis. Use-os só em segmentos IT."),
    h("label", { for: "o-comm" }, "Communities SNMP a testar (separadas por vírgula)"),
    h("input", { id: "o-comm", type: "password", value: "public", autocomplete: "off" }),
    h("details", {}, h("summary", {}, "Credenciais SNMPv3 (recomendado)"),
      h("div", { class: "row" }, h("div", {}, h("label", { for: "o-v3u" }, "Utilizador"), h("input", { id: "o-v3u", autocomplete: "off" })),
        h("div", {}, h("label", { for: "o-v3ap" }, "Autenticação"), h("select", { id: "o-v3ap" }, ["SHA", "SHA-256", "SHA-512"].map(x => h("option", {}, x))))),
      h("div", { class: "row" }, h("div", {}, h("label", { for: "o-v3a" }, "Passphrase de autenticação"), h("input", { id: "o-v3a", type: "password", autocomplete: "off" })),
        h("div", {}, h("label", { for: "o-v3pp" }, "Cifra"), h("select", { id: "o-v3pp" }, ["AES", "AES-256"].map(x => h("option", {}, x))))),
      h("label", { for: "o-v3p" }, "Passphrase de cifra"), h("input", { id: "o-v3p", type: "password", autocomplete: "off" })),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "o-vlan" }), "Sondar VLANs observadas com tags 802.1Q (arp-scan --vlan; requer porta em trunk)"),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "o-ics", checked: true }), "Identificar pelos protocolos industriais (S7, EtherNet/IP, Modbus, BACnet, Fox, FINS, PCWorx, IEC-104, KNX)"),
    h("p", { class: "muted" }, "As credenciais são usadas só neste levantamento: nunca são gravadas nem aparecem na linha de comandos."));
  // 3. Autorização
  const auth = h("input", { type: "checkbox", id: "o-auth" });
  const err = h("div");
  const submit = h("button", { class: "btn primary", type: "submit", disabled: true }, "Iniciar levantamento");
  const form = h("form", { class: "card", novalidate: true },
    h("fieldset", {}, h("legend", {}, "1. Rede"), h("div", { class: "method-grid" }, modeBtns), netsBox,
      ifPick.node),
    opts,
    h("fieldset", {}, h("legend", {}, "3. Autorização"),
      h("label", { class: "check" }, auth, "Confirmo que tenho autorização para analisar esta rede (fica registado na auditoria).")),
    err, h("div", { class: "toolbar" }, submit));
  view.append(form);
  const refresh = () => {
    const netsOk = (mode === "auto" || document.getElementById("n-nets").value.trim()) && ifPick.value();
    setWizard(!netsOk ? 0 : !auth.checked ? 2 : 2);
    submit.disabled = !(netsOk && auth.checked);
  };
  form.addEventListener("input", refresh);
  document.getElementById("o-int").addEventListener("change", e => { document.getElementById("o-int-warn").hidden = e.target.value === "ot"; });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    err.replaceChildren();
    const val = id => document.getElementById(id).value;
    const v3u = val("o-v3u").trim();
    const body = {
      networks: mode === "manual" ? val("n-nets").split(/[\s,;]+/).filter(Boolean) : [],
      interface: ifPick.value(), intensity: val("o-int"), listen_seconds: Number(val("o-listen")),
      communities: val("o-comm").split(",").map(x => x.trim()).filter(Boolean),
      snmp_v3: v3u ? { user: v3u, auth_proto: val("o-v3ap"), auth_pass: val("o-v3a"), priv_proto: val("o-v3pp"), priv_pass: val("o-v3p") } : null,
      vlan_probe: document.getElementById("o-vlan").checked, ics: document.getElementById("o-ics").checked,
      authorized: auth.checked,
    };
    submit.disabled = true;
    try {
      const { id } = await api("/api/discovery", { method: "POST", json: body });
      form.querySelectorAll("input[type=password]").forEach(i => { i.value = ""; });
      Live.track(id, "discovery");
      location.hash = `#/discovery/${id}`;   // recarrega a vista: o seletor passa a incluir este levantamento
    } catch (ex) { err.append(alertBox(ex.message)); submit.disabled = false; }
  });
  refresh();
}

/** Seletor de levantamentos: os anteriores e "Novo levantamento" (bloqueado se houver um em curso). */
function runSelector(runs, currentId, runningId) {
  const sel = h("select", { id: "run-sel", "aria-label": "Levantamento" });
  const busy = runningId && String(runningId) !== String(currentId || "");
  sel.append(h("option", { value: "new", disabled: Boolean(runningId) },
    runningId ? `+ Novo levantamento (aguarde o fim do #${runningId})` : "+ Novo levantamento"));
  runs.forEach(r => {
    const nets = r.options.networks.length ? r.options.networks.join(", ") : "rede automática";
    const iface = r.options.interface ? ` · ${r.options.interface}` : "";
    sel.append(h("option", { value: r.id },
      `#${r.id} · ${fmtDate(r.started_at)} · ${STATUS_PT[r.status] || r.status} · ${r.asset_count} ativos · ${nets}${iface}`));
  });
  sel.value = currentId ? String(currentId) : "new";
  sel.addEventListener("change", () => { location.hash = sel.value === "new" ? "#/discovery/new" : `#/discovery/${sel.value}`; });
  return h("div", { class: "card run-bar" },
    h("label", { for: "run-sel" }, "Levantamento"), sel,
    h("span", { class: "muted" }, runs.length ? `${runs.length} anterior${runs.length === 1 ? "" : "es"}` : "ainda não existe nenhum: crie o primeiro"),
    busy ? h("a", { class: "btn", href: `#/discovery/${runningId}` }, `Ver o #${runningId} em curso`) : "");
}

const IF_KIND = { ethernet: "Ethernet (física)", wifi: "Wi-Fi (física)", virtual: "virtual" };

/** Cartões com a configuração de cada interface; devolve { node, value() }. */
function interfacePicker(ctx) {
  let selected = ctx.suggested || (ctx.interfaces[0] || {}).name || "";
  let showVirtual = false;
  const grid = h("div", { class: "if-grid", role: "radiogroup", "aria-label": "Interface de rede" });
  const virtCount = ctx.interfaces.filter(i => !i.physical).length;
  const toggle = h("input", { type: "checkbox", id: "if-virt" });
  const hint = h("p", { class: "muted" });

  function stateChip(i) {
    if (!i.admin_up) return h("span", { class: "chip bad" }, "desligada");
    if (i.carrier === false) return h("span", { class: "chip warn" }, "sem cabo / sem ligação");
    return h("span", { class: "chip ok" }, "ligada");
  }
  function card(i) {
    const v4 = i.ipv4_detail || [];
    const v6 = (i.ipv6 || []).filter(x => x.scope === "global").slice(0, 2);
    const speed = i.speed_mbps ? `${i.speed_mbps >= 1000 ? i.speed_mbps / 1000 + " Gb/s" : i.speed_mbps + " Mb/s"}${i.duplex && i.duplex !== "unknown" ? " " + i.duplex : ""}` : "—";
    const rows = [
      ["MAC", h("span", { class: "mono" }, i.mac || "—")],
      ["IPv4", v4.length ? v4.map(a => h("div", { class: "mono" }, `${a.cidr}  (máscara ${a.netmask})`)) : h("span", { class: "muted" }, "sem endereço IPv4")],
      ["Rede", v4.length ? h("span", { class: "mono" }, v4.map(a => a.network).join(", ")) : "—"],
      ["Gateway", i.gateway ? h("span", { class: "mono" }, `${i.gateway} (rota por omissão)`) : "—"],
      ["Endereçamento", v4.length ? (v4.some(a => a.dhcp) ? "DHCP" : "estático") : "—"],
      ["Velocidade", speed],
      ["MTU", i.mtu || "—"],
      ["Driver", i.driver || "—"],
    ];
    if (v6.length) rows.push(["IPv6", v6.map(a => h("div", { class: "mono" }, a.cidr))]);
    if ((i.routes || []).length > (v4.length ? 1 : 0)) rows.push(["Outras redes", h("span", { class: "mono" }, i.routes.join(", "))]);
    const btn = h("button", { type: "button", class: "if-card", role: "radio", "aria-checked": String(i.name === selected),
      onclick: () => { selected = i.name; render(); grid.dispatchEvent(new Event("input", { bubbles: true })); } },
      h("div", { class: "if-head" }, h("strong", { class: "mono" }, i.name),
        h("span", { class: "chip" }, IF_KIND[i.kind] || i.kind), stateChip(i)),
      h("dl", { class: "kv" }, rows.flatMap(([k, val]) => [h("dt", {}, k), h("dd", {}, val)])));
    return btn;
  }
  function render() {
    const list = ctx.interfaces.filter(i => i.physical || showVirtual || i.name === selected);
    grid.replaceChildren(...(list.length ? list.map(card) : [h("p", { class: "empty" }, "Nenhuma interface física encontrada.")]));
    const cur = ctx.interfaces.find(i => i.name === selected);
    hint.textContent = !cur ? "Escolha a interface ligada ao switch / rede a analisar."
      : !cur.ipv4.length ? `A ${cur.name} não tem IPv4: faz escuta passiva (LLDP/CDP, PROFINET, GOOSE) e sondagem ARP, mas não varre redes remotas. Indique a rede manualmente se necessário.`
      : cur.carrier === false ? `A ${cur.name} não tem ligação: confirme o cabo antes de iniciar.`
      : !cur.physical ? `A ${cur.name} é virtual: normalmente deve escolher a placa física ligada ao switch.`
      : `Os testes vão ser feitos pela ${cur.name} (${cur.ipv4.join(", ")}).`;
  }
  toggle.addEventListener("change", () => { showVirtual = toggle.checked; render(); });
  render();
  const node = h("div", {},
    h("div", { class: "toolbar spread" }, h("strong", {}, "Interface de rede para os testes"),
      virtCount ? h("label", { class: "check" }, toggle, `Mostrar interfaces virtuais (${virtCount})`) : ""),
    grid, hint,
    (ctx.dns || []).length ? h("p", { class: "muted" }, `DNS do sistema: ${ctx.dns.join(", ")}`) : "");
  return { node, value: () => selected };
}

function followDiscovery(id, setWizard) {
  const pipe = h("section", { class: "card", "aria-live": "polite", "aria-label": "Progresso do levantamento" });
  const netCard = h("section", { class: "card" });
  const covCard = h("section", { class: "card" });
  const listCard = h("section", { class: "card" });
  const cmdCard = h("section", { class: "card" });
  view.append(h("div", { class: "disc-top" }, pipe, h("div", { class: "grid" }, covCard, netCard)), listCard, cmdCard);
  const expanded = new Set();
  let prev = new Map(), timer = null, alive = true, lastCmdN = -1;

  async function poll() {
    let d;
    try { d = await api(`/api/discovery/${id}`); } catch (ex) { pipe.append(alertBox(ex.message)); return; }
    if (!alive) return;
    const st = d.state || {};
    const steps = st.steps && st.steps.length ? st.steps : DISC_STEPS.map(label => ({ label, status: "pending" }));
    renderSteps(pipe, d.run, steps, st.error);
    renderNetwork(netCard, st.network || {});
    renderCoverage(covCard, d.assets);
    renderAssets(listCard, d, expanded, prev);
    prev = new Map(d.assets.map(a => [a.mac || a.ip, a]));
    const cmds = st.commands || [];
    if (cmds.length && cmds[cmds.length - 1].n !== lastCmdN) { renderCommands(cmdCard, cmds); lastCmdN = cmds[cmds.length - 1].n; }
    else if (!cmds.length) renderCommands(cmdCard, cmds);
    if (["done", "error", "cancelled"].includes(d.run.status)) {
      setWizard(4); Live.finished(id, "discovery");
      // atualiza o estado/n.º de ativos deste levantamento no seletor
      api("/api/discovery").then(({ runs }) => {
        const bar = document.querySelector(".run-bar");
        if (bar && alive) bar.replaceWith(runSelector(runs, id, null));
      }).catch(() => {});
      return;
    }
    timer = setTimeout(poll, 1000);
  }
  poll();
  cleanup = () => { alive = false; clearTimeout(timer); };

  function renderSteps(card, run, steps, error) {
    const { pct } = progressOf(steps);
    const done = run.status === "done";
    card.replaceChildren(
      h("div", { class: "pipe-head" }, h("h2", {}, "Processamento"), badge(run.status)),
      h("div", { class: "muted" }, `Levantamento #${run.id} · ${run.options.networks.length ? run.options.networks.join(", ") : "rede automática"} · perfil ${run.options.intensity}${run.options.interface ? " · interface " + run.options.interface : ""}`),
      h("div", { class: `progress ${run.status}`, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100,
                 "aria-valuenow": done ? 100 : pct, "aria-label": "Progresso" },
        (() => { const i = h("i"); i.style.width = (done ? 100 : pct) + "%"; return i; })()),
      h("ol", { class: "steps" }, steps.map((s, i) => {
        const dot = h("span", { class: "dot", "aria-hidden": "true" });
        if (ICONS[s.status]) dot.append(iconNode(ICONS[s.status])); else dot.append(h("span", {}, i + 1));
        return h("li", { class: `step ${s.status}` }, dot,
          h("div", {}, h("div", { class: "title" }, s.label, h("span", { class: "visually-hidden" }, ` — ${STEP_STATUS_PT[s.status] || s.status}`)),
            s.message ? h("div", { class: "msg" }, s.message) : ""),
          h("div", { class: "time num" }, s.duration != null ? `${s.duration}s` : ""));
      })));
    if (error) card.append(alertBox(`O levantamento terminou: ${error}`));
    if (["running", "queued"].includes(run.status) && can("operator")) {
      card.append(h("div", { class: "toolbar" }, h("button", { class: "btn danger", type: "button", onclick: async () => {
        try { await api(`/api/discovery/${id}/cancel`, { method: "POST" }); } catch (ex) { alert(ex.message); }
      } }, "Cancelar")));
    } else if (can("operator")) {
      card.append(h("div", { class: "toolbar" }, h("a", { class: "btn", href: "#/discovery/new" }, "Novo levantamento")));
    }
  }

  function renderNetwork(card, net) {
    const sw = (net.neighbors || [])[0];
    const vlans = net.vlans || [];
    card.replaceChildren(h("h2", {}, "Rede"),
      h("dl", { class: "kv" },
        h("dt", {}, "Interface"), h("dd", {}, net.interface ? `${net.interface} ${(net.interface_ipv4 || []).join(", ")}` : "—"),
        h("dt", {}, "Switch"), h("dd", {}, sw ? `${sw.name || "?"} · porta ${sw.port || "?"} (${sw.protocol})` : "não identificado (sem LLDP/CDP)"),
        sw && sw.platform ? [h("dt", {}, "Modelo"), h("dd", {}, sw.platform)] : "",
        h("dt", {}, "VLANs"), h("dd", {}, vlans.length ? h("span", { class: "chips" }, vlans.map(v =>
          h("span", { class: `chip${v.native ? " ok" : ""}`, title: (v.sources || []).join(", ") }, `${v.vid}${v.name ? " " + v.name : ""}${v.native ? " (nativa)" : ""}`))) : "—")),
      (net.networks || []).length ? h("ul", { class: "nets" }, net.networks.map(n =>
        h("li", {}, h("span", { class: "mono" }, n.network), " ", h("span", { class: "muted" }, n.reason),
          n.warning ? h("span", { class: "chip warn" }, n.warning) : ""))) : "");
  }

  function renderCoverage(card, assets) {
    const total = assets.length;
    card.replaceChildren(h("h2", {}, `Lista: ${total} ativo${total === 1 ? "" : "s"}`),
      h("div", { class: "meters" }, FIELDS.map(([f, label]) => {
        const n = assets.filter(a => a[f]).length;
        const bar = h("i"); bar.style.width = (total ? (n / total) * 100 : 0) + "%";
        return h("div", { class: "meter" }, h("span", {}, label), h("span", { class: "track" }, bar), h("span", { class: "num" }, `${n}/${total}`));
      })));
  }

  function renderCommands(card, cmds) {
    card.replaceChildren(h("h2", {}, `Comandos executados (${cmds.length})`),
      h("p", { class: "muted" }, "Cada comando acrescenta a informação obtida à lista final (inventario.json / inventario.csv)."),
      cmds.length ? h("ol", { class: "cmdlog", reversed: true }, cmds.slice().reverse().map(c =>
        h("li", {}, h("span", { class: "n num" }, `#${c.n}`), h("code", {}, c.cmd),
          h("span", { class: "muted num" }, `${c.duration}s`),
          c.new_info ? h("span", { class: "chip ok" }, `+${c.new_info} dados`) : h("span", { class: "chip" }, "sem dados novos")))) :
        h("p", { class: "empty" }, "À espera do primeiro comando…"));
  }
}

/** Tabela de ativos: células novas destacadas; clique numa linha mostra origem dos dados e sugestões. */
function renderAssets(card, d, expanded, prev) {
  const running = ["running", "queued"].includes(d.run ? d.run.status : "done");
  const tbody = h("tbody");
  const head = h("div", { class: "toolbar spread" }, h("h2", {}, "Lista de ativos", running ? h("span", { class: "muted" }, " (atualizada a cada comando)") : ""),
    d.run ? h("div", { class: "toolbar" }, ["csv", "json", "log"].map(f =>
      h("a", { class: "btn", href: `/api/discovery/${d.run.id}/download/${f}` }, f === "log" ? "comandos.log" : `inventario.${f}`))) : "");
  card.replaceChildren(head, h("div", { class: "table-wrap" }, h("table", { class: "assets" },
    h("thead", {}, h("tr", {}, ["", ...FIELDS.map(f => f[1]), "VLAN", "Switch / porta", "Portas", "Completo"].map(t => h("th", { scope: "col" }, t)))),
    tbody)));
  if (!d.assets.length) { tbody.append(h("tr", {}, h("td", { colspan: 11, class: "empty" }, running ? "À procura de ativos…" : "Nenhum ativo encontrado."))); return; }
  for (const a of d.assets) {
    const key = a.mac || a.ip;
    const old = prev.get(key);
    const open = expanded.has(key);
    const cell = (f, cls = "") => {
      const fresh = prev.size && (!old || old[f] !== a[f]) && a[f];
      const src = a.sources && a.sources[f];
      return h("td", { class: `${cls}${fresh ? " fresh" : ""}${a[f] ? "" : " missing"}`, title: src ? `origem: ${src.source}` : "" }, a[f] || "—");
    };
    const pct = Math.round(a.completeness * 100);
    const meter = h("span", { class: "track small" }, (() => { const i = h("i"); i.style.width = pct + "%"; if (pct === 100) i.className = "full"; return i; })());
    const toggle = h("button", { class: "btn link", type: "button", "aria-expanded": String(open), "aria-label": `Detalhes de ${key}`,
      onclick: () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); renderAssets(card, d, expanded, new Map()); } }, open ? "▾" : "▸");
    tbody.append(h("tr", { class: old ? "" : (prev.size ? "row-new" : "") },
      h("td", {}, toggle), cell("ip", "mono"), cell("mac", "mono"), cell("vendor"), cell("model"), cell("firmware"), cell("serial", "mono"),
      h("td", { class: "num" }, a.vlan || "—"), h("td", {}, a.switch ? `${a.switch} ${a.switch_port || ""}` : "—"),
      h("td", { class: "mono small" }, a.ports.map(p => `${p.port}/${p.proto}`).join(" ") || (a.l2_only ? "só L2" : "—")),
      h("td", { class: "num" }, meter, ` ${pct}%`)));
    if (open) tbody.append(h("tr", { class: "detail" }, h("td", { colspan: 11 }, assetDetail(a))));
  }
}


function assetDetail(a) {
  const srcs = Object.entries(a.sources || {});

  return h("div", { class: "detail-grid" },

    h("div", {},
      h("h3", {}, "Origem de cada campo"),

      h("table", { class: "mini" },
        h("tbody", {},
          srcs.map(([f, s]) =>
            h("tr", {},
              h("th", {}, f),
              h("td", {}, a[f] || ""),
              h("td", { class: "muted" },
                `${s.source} (${Math.round(s.conf)}%)`
              )
            )
          )
        )
      ),

      a.hostname || a.os
        ? h("p", {},
            a.hostname ? `Nome: ${a.hostname}. ` : "",
            a.os ? `SO: ${a.os}.` : ""
          )
        : ""
    ),

    h("div", {},
      h("h3", {}, "Portas e serviços"),

      a.ports.length
        ? h("ul", {},
            a.ports.map(p =>
              h("li", {},
                h("span", { class: "mono" },
                  `${p.port}/${p.proto}`
                ),
                ` ${p.service || ""} ${p.product || ""} ${p.version || ""}`
              )
            )
          )
        : h("p", { class: "muted" },
            "Nenhuma porta aberta."
          ),

      (a.plan || []).length
        ? [
            h("h3", {}, "Protocolos usados"),
            h("ul", {},
              a.plan.map(p =>
                h("li", {},
                  h("strong", {}, p.probe.toUpperCase()),
                  ` → ${p.fields}: ${p.how}`
                )
              )
            )
          ]
        : ""
    ),

    h("div", {},
      h("h3", {}, "Em falta e como obter"),

      a.missing && a.missing.length
        ? h("p", {},
            `Falta: ${a.missing.map(m =>
              (FIELDS.find(f => f[0] === m) || [m, m])[1]
            ).join(", ")}`
          )
        : h("p", {}, "Ficha completa ✓"),

      (a.suggestions || []).length
        ? h("ul", {},
            a.suggestions.map(s => h("li", {}, s))
          )
        : "",

      (a.evidence || []).length
        ? [
            h("h3", {}, "Evidências"),
            h("ul", { class: "small" },
              a.evidence.slice(-8).map(e =>
                h("li", {},
                  h("span", { class: "muted" },
                    `${e.source}: `
                  ),
                  e.text
                )
              )
            )
          ]
        : ""
    )
  );
}

// ------------------------------------------------------- inventário consolidado
async function InventoryView() {
  setHead("Inventário", "Todos os ativos encontrados nos levantamentos, consolidados por MAC (ou IP).");
  const q = h("input", { id: "i-q", type: "search", placeholder: "IP, MAC, fabricante, modelo, n.º de série, switch…", maxlength: 64 });
  const inc = h("input", { type: "checkbox", id: "i-inc" });
  const exportBtn = h("a", { class: "btn", href: "/api/inventory.csv" }, "Exportar CSV");
  const card = h("section", { class: "card" });
  view.append(h("div", { class: "card" }, h("div", { class: "toolbar" },
    h("div", {}, h("label", { for: "i-q" }, "Pesquisa"), q), h("label", { class: "check" }, inc, "Só fichas incompletas"), exportBtn)), card);
  const expanded = new Set();
  async function load() {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set("q", q.value.trim());
    if (inc.checked) p.set("incomplete", "1");
    exportBtn.href = `/api/inventory.csv?${p}`;
    const { assets } = await api(`/api/inventory?${p}`);
    renderAssets(card, { assets, run: null }, expanded, new Map());
  }
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
  inc.addEventListener("change", load);
  await load();
}

// ------------------------------------------------------------- nova recolha
const METHODS = [
  { key: "snmp", title: "SNMP", desc: "v2c ou v3 (recomendado)" },
  { key: "ssh", title: "SSH", desc: "comandos de leitura" },
  { key: "import", title: "Importar ficheiro", desc: "CSV / output de CLI" },
  { key: "demo", title: "Demonstração", desc: "dados simulados", demo: true },
];

async function ScanView(scanId) {
  setHead("Recolha por equipamento", "Lê a tabela MAC/ARP de um switch, router ou firewall registado (SNMP, SSH ou ficheiro).");
  if (!can("operator") && !scanId) { view.append(alertBox("Sem permissão para iniciar recolhas.")); return; }
  const { devices } = await api("/api/devices");

  const wizard = h("ol", { class: "wizard", "aria-label": "Passos do assistente" },
    ["Equipamento", "Método", "Credenciais", "Processamento"].map(t => h("li", {}, t)));
  const setWizard = idx => [...wizard.children].forEach((li, i) => {
    li.className = i < idx ? "complete" : i === idx ? "current" : "";
    li.toggleAttribute("aria-current", i === idx);
  });

  const formCard = h("form", { class: "card", novalidate: true });
  const pipeCard = h("section", { class: "card", "aria-live": "polite", "aria-label": "Progresso do processamento" });
  const layout = h("div", { class: "scan-layout" }, formCard, pipeCard);
  view.append(wizard, layout);
  renderPipeline(pipeCard, null);

  if (scanId) { setWizard(3); formCard.classList.add("hidden"); layout.classList.add("solo"); followScan(Number(scanId), pipeCard, setWizard); return; }
  if (!devices.length) {
    formCard.append(h("p", {}, "Ainda não existem equipamentos registados. "),
      can("admin") ? h("a", { class: "btn primary", href: "#/devices" }, "Adicionar equipamento") : "Peça a um administrador para os registar.");
    setWizard(0); return;
  }

  // Passo 1 - equipamento
  const devSel = h("select", { id: "f-dev", required: true },
    h("option", { value: "" }, "— escolha —"),
    devices.map(d => h("option", { value: d.id }, `${d.name} · ${KIND_PT[d.kind]} · ${d.mgmt_ip}`)));
  // Passo 2 - método
  let method = null;
  const methodBtns = METHODS.filter(m => !m.demo || DEMO).map(m =>
    h("button", { type: "button", class: "method", "aria-pressed": "false", "data-m": m.key,
                  onclick: () => pick(m.key) }, h("strong", {}, m.title), h("span", {}, m.desc)));
  // Passo 3 - credenciais (por método)
  const credBox = h("div");
  const err = h("div");
  const submit = h("button", { class: "btn primary", type: "submit", disabled: true }, "Iniciar recolha");
  const opts = h("fieldset", {}, h("legend", {}, "Opções"),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "f-uplinks", checked: true }),
      "Excluir uplinks/trunks (portas com muitos MAC)"),
    h("div", { class: "row" }, h("div", {}, h("label", { for: "f-thr" }, "Limiar de MAC por porta"),
      h("input", { id: "f-thr", type: "number", min: 2, max: 1000, value: 10 }))),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "f-dns", checked: true }), "Resolver nomes (DNS inverso)"));

  formCard.append(
    h("fieldset", {}, h("legend", {}, "1. Equipamento"), devSel),
    h("fieldset", {}, h("legend", {}, "2. Método de recolha"), h("div", { class: "method-grid" }, methodBtns)),
    h("fieldset", {}, h("legend", {}, "3. Credenciais / origem"), credBox),
    opts, err, h("div", { class: "toolbar" }, submit));

  const refresh = () => {
    const step = !devSel.value ? 0 : !method ? 1 : 2;
    setWizard(step);
    submit.disabled = step < 2;
  };
  devSel.addEventListener("change", refresh);

  function field(id, label, attrs = {}) {
    return h("div", {}, h("label", { for: id }, label), h("input", { id, autocomplete: "off", spellcheck: "false", ...attrs }));
  }
  function pick(key) {
    method = key;
    methodBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === key)));
    credBox.replaceChildren();
    if (key === "snmp") {
      const ver = h("select", { id: "c-ver" }, h("option", { value: "3" }, "SNMPv3 (authPriv)"), h("option", { value: "2c" }, "SNMPv2c"));
      const v3 = h("div", {}, h("div", { class: "row" }, field("c-user", "Utilizador"),
        h("div", {}, h("label", { for: "c-ap" }, "Autenticação"), h("select", { id: "c-ap" }, ["SHA", "SHA-256", "SHA-512"].map(x => h("option", {}, x))))),
        h("div", { class: "row" }, field("c-apass", "Passphrase de autenticação", { type: "password" }),
        h("div", {}, h("label", { for: "c-pp" }, "Cifra"), h("select", { id: "c-pp" }, ["AES", "AES-256"].map(x => h("option", {}, x))))),
        field("c-ppass", "Passphrase de cifra", { type: "password" }));
      const v2 = h("div", { class: "hidden" }, field("c-comm", "Community (só leitura)", { type: "password" }),
        h("p", { class: "muted" }, "SNMPv2c envia a community em claro. Prefira SNMPv3."));
      ver.addEventListener("change", () => { v3.classList.toggle("hidden", ver.value !== "3"); v2.classList.toggle("hidden", ver.value === "3"); });
      credBox.append(h("label", { for: "c-ver" }, "Versão"), ver, v3, v2);
    } else if (key === "ssh") {
      credBox.append(h("div", { class: "row" }, field("c-suser", "Utilizador"), field("c-port", "Porta", { type: "number", value: 22, min: 1, max: 65535 })),
        field("c-spass", "Palavra-passe", { type: "password" }),
        h("p", { class: "muted" }, "A chave do equipamento tem de estar em data/known_hosts. Use uma conta só de leitura."));
    } else if (key === "import") {
      credBox.append(h("label", { for: "c-file" }, "Ficheiro (.csv, .txt, .log, .out — máx. 2 MB)"),
        h("input", { id: "c-file", type: "file", accept: ".csv,.txt,.log,.out" }),
        h("p", { class: "muted" }, "Aceita CSV (mac, ip, interface, vlan, hostname) ou o output de show mac address-table / show ip arp / ip neigh / arp -a."));
    } else {
      credBox.append(h("p", { class: "muted" }, "Gera dados fictícios para testar a aplicação."));
    }
    credBox.append(h("p", { class: "muted" }, "As credenciais são usadas só nesta recolha e nunca são gravadas."));
    refresh();
  }

  formCard.addEventListener("submit", async e => {
    e.preventDefault();
    err.replaceChildren();
    const val = id => (document.getElementById(id) || {}).value;
    const base = { device_id: devSel.value, method,
      exclude_uplinks: document.getElementById("f-uplinks").checked,
      uplink_threshold: val("f-thr"), reverse_dns: document.getElementById("f-dns").checked };
    let req;
    if (method === "import") {
      const file = document.getElementById("c-file").files[0];
      if (!file) { err.append(alertBox("Escolha um ficheiro.")); return; }
      const fd = new FormData();
      Object.entries(base).forEach(([k, v]) => fd.append(k, v));
      fd.append("file", file);
      req = { method: "POST", form: fd };
    } else {
      let credentials = {};
      if (method === "snmp") {
        credentials = val("c-ver") === "3"
          ? { version: "3", user: val("c-user"), auth_proto: val("c-ap"), auth_pass: val("c-apass"), priv_proto: val("c-pp"), priv_pass: val("c-ppass") }
          : { version: "2c", community: val("c-comm") };
      } else if (method === "ssh") {
        credentials = { username: val("c-suser"), password: val("c-spass"), port: val("c-port") };
      }
      req = { method: "POST", json: { ...base, credentials } };
    }
    submit.disabled = true;
    try {
      const { id } = await api("/api/scans", req);
      formCard.querySelectorAll("input[type=password]").forEach(i => { i.value = ""; });
      history.replaceState(null, "", `#/scan/${id}`);
      formCard.classList.add("hidden");
      layout.classList.add("solo");
      setWizard(3);
      Live.track(id, "scan");
      followScan(id, pipeCard, setWizard);
    } catch (ex) {
      err.append(alertBox(ex.message));
      submit.disabled = false;
    }
  });
  refresh();
}

const ICONS = {
  done: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>',
  error: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  skipped: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 12h12"/></svg>',
};
const STEP_STATUS_PT = { pending: "pendente", running: "em curso", done: "concluído", skipped: "ignorado", error: "falhou", cancelled: "cancelado" };
const iconNode = svg => new DOMParser().parseFromString(svg, "image/svg+xml").documentElement; // ícones estáticos do próprio código

/** Desenha o pipeline: barra de progresso + lista vertical de passos com estado. */
function renderPipeline(card, scan) {
  const steps = scan ? scan.steps : [
    "Validação dos dados", "Ligação ao equipamento", "Recolha da tabela MAC", "Recolha da tabela ARP",
    "Correlação MAC ↔ IP ↔ porta", "Enriquecimento (fabricante, DNS)", "Gravação do inventário",
  ].map(label => ({ label, status: "pending", message: "" }));
  const { pct } = progressOf(steps);
  const status = scan ? scan.status : "idle";
  card.replaceChildren(
    h("div", { class: "pipe-head" }, h("h2", {}, "Processamento"),
      scan ? badge(status) : h("span", { class: "muted" }, "à espera de início")),
    scan ? h("div", { class: "muted" }, `${scan.device} · ${scan.method.toUpperCase()} · recolha #${scan.id}`) : "",
    h("div", { class: `progress ${status}`, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100,
               "aria-valuenow": status === "done" ? 100 : pct, "aria-label": "Progresso" },
      (() => { const i = h("i"); i.style.width = (status === "done" ? 100 : pct) + "%"; return i; })()),
    h("ol", { class: "steps" }, steps.map((s, i) => {
      const dot = h("span", { class: "dot", "aria-hidden": "true" });
      if (ICONS[s.status]) dot.append(iconNode(ICONS[s.status])); else dot.append(h("span", {}, i + 1));
      return h("li", { class: `step ${s.status}` }, dot,
        h("div", {}, h("div", { class: "title" }, s.label,
            h("span", { class: "visually-hidden muted" }, ` — ${STEP_STATUS_PT[s.status]}`)),
          s.message ? h("div", { class: "msg" }, s.message) : ""),
        h("div", { class: "time num" }, s.duration != null ? `${s.duration}s` : ""));
    })));
  if (scan && status === "done") {
    card.append(h("div", { class: "result" }, alertBox(`Recolha concluída: ${scan.asset_count} ativos inventariados.`, "ok"),
      h("div", { class: "toolbar" }, h("a", { class: "btn primary", href: `#/assets/${scan.device_id}` }, "Ver ativos"),
        h("a", { class: "btn", href: `/api/assets.csv?device_id=${scan.device_id}` }, "Exportar CSV"),
        can("operator") ? h("a", { class: "btn", href: "#/scan" }, "Nova recolha") : "")));
  } else if (scan && status === "error") {
    card.append(h("div", { class: "result" }, alertBox(`A recolha falhou: ${scan.error || "erro"}`),
      can("operator") ? h("a", { class: "btn", href: "#/scan" }, "Tentar novamente") : ""));
  }
}

function followScan(id, card, setWizard) {
  let timer = null, alive = true;
  const poll = async () => {
    try {
      const { scan } = await api(`/api/scans/${id}`);
      if (!alive) return;
      renderPipeline(card, scan);
      if (scan.status === "done" || scan.status === "error") { setWizard(4); Live.finished(id, "scan"); return; }
    } catch (ex) { card.append(alertBox(ex.message)); return; }
    timer = setTimeout(poll, 800);
  };
  poll();
  cleanup = () => { alive = false; clearTimeout(timer); };
}

// ------------------------------------------------------------------ inventário
async function AssetsView(deviceId) {
  setHead("Ligações por equipamento", "Ativos vistos na tabela MAC/ARP de cada switch, router ou firewall registado.");
  const { devices } = await api("/api/devices");
  const devSel = h("select", { id: "a-dev" }, h("option", { value: "" }, "Todos os equipamentos"),
    devices.map(d => h("option", { value: d.id, selected: String(d.id) === deviceId }, `${d.name} (${KIND_PT[d.kind]})`)));
  const q = h("input", { id: "a-q", type: "search", placeholder: "MAC, IP, nome, fabricante, porta…", maxlength: 64 });
  const inactive = h("input", { type: "checkbox", id: "a-inact" });
  const exportBtn = h("a", { class: "btn" }, "Exportar CSV");
  const info = h("p", { class: "muted" });
  const tbody = h("tbody");
  view.append(h("div", { class: "card" },
    h("div", { class: "toolbar" },
      h("div", {}, h("label", { for: "a-dev" }, "Equipamento"), devSel),
      h("div", {}, h("label", { for: "a-q" }, "Pesquisa"), q),
      h("label", { class: "check" }, inactive, "Incluir ativos ausentes"),
      exportBtn),
    info,
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Equipamento", "Porta", "VLAN", "MAC", "IP", "Nome", "Fabricante", "Última vez", "Estado"].map(t => h("th", { scope: "col" }, t)))),
      tbody))));

  async function load() {
    const params = new URLSearchParams();
    if (devSel.value) params.set("device_id", devSel.value);
    if (q.value.trim()) params.set("q", q.value.trim());
    params.set("active", inactive.checked ? "0" : "1");
    exportBtn.href = `/api/assets.csv?${params}`;
    try {
      const data = await api(`/api/assets?${params}&limit=1000`);
      info.textContent = `${data.total.toLocaleString("pt-PT")} ativos${data.total > 1000 ? " (a mostrar 1000; use a pesquisa ou exporte CSV)" : ""}`;
      tbody.replaceChildren(...data.assets.map(a => h("tr", {},
        h("td", {}, a.device, " ", h("span", { class: "kind" }, KIND_PT[a.kind])),
        h("td", { class: "mono" }, a.interface || "—"), h("td", { class: "num" }, a.vlan ?? "—"),
        h("td", { class: "mono" }, a.mac), h("td", { class: "mono" }, a.ip || "—"),
        h("td", {}, a.hostname || "—"), h("td", {}, a.vendor || "—"), h("td", {}, fmtDate(a.last_seen)),
        h("td", {}, a.active ? h("span", { class: "badge done" }, "presente") : h("span", { class: "badge" }, "ausente")))));
      if (!data.assets.length) tbody.append(h("tr", {}, h("td", { colspan: 9, class: "empty" }, "Sem ativos para estes filtros.")));
    } catch (ex) { info.textContent = ex.message; }
  }
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
  devSel.addEventListener("change", load);
  inactive.addEventListener("change", load);
  load();
}

// --------------------------------------------------------------- equipamentos
async function DevicesView() {
  setHead("Equipamentos", "Switches, routers e firewalls a partir dos quais se recolhem os ativos.");
  const { devices } = await api("/api/devices");
  if (can("admin")) {
    const msg = h("div");
    const form = h("form", { class: "card", novalidate: true },
      h("h2", {}, "Adicionar equipamento"),
      h("div", { class: "row" },
        h("div", {}, h("label", { for: "d-name" }, "Nome"), h("input", { id: "d-name", required: true, maxlength: 63 })),
        h("div", {}, h("label", { for: "d-kind" }, "Tipo"), h("select", { id: "d-kind" }, Object.entries(KIND_PT).map(([k, v]) => h("option", { value: k }, v)))),
        h("div", {}, h("label", { for: "d-ip" }, "IP / nome de gestão"), h("input", { id: "d-ip", required: true, maxlength: 253 }))),
      h("div", { class: "row" },
        h("div", {}, h("label", { for: "d-plat" }, "Plataforma"), h("select", { id: "d-plat" },
          [["generic", "Genérica"], ["cisco_ios", "Cisco IOS/IOS-XE"], ["cisco_nxos", "Cisco NX-OS"], ["aruba", "Aruba / HPE"], ["fortigate", "FortiGate"], ["linux", "Linux"]]
            .map(([k, v]) => h("option", { value: k }, v)))),
        h("div", {}, h("label", { for: "d-loc" }, "Localização"), h("input", { id: "d-loc", maxlength: 80 }))),
      msg, h("div", { class: "toolbar" }, h("button", { class: "btn primary", type: "submit" }, "Adicionar")));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      msg.replaceChildren();
      const val = id => document.getElementById(id).value;
      try {
        await api("/api/devices", { method: "POST", json: { name: val("d-name"), kind: val("d-kind"), mgmt_ip: val("d-ip"), platform: val("d-plat"), location: val("d-loc") } });
        navigate();
      } catch (ex) { msg.append(alertBox(ex.message)); }
    });
    view.append(form, h("div", { class: "grid" }, h("span")));
  }
  const tbody = h("tbody");
  view.append(h("div", { class: "card" }, h("h2", {}, `Equipamentos registados (${devices.length})`),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Nome", "Tipo", "Gestão", "Plataforma", "Localização", "Ativos", "Última recolha", ""].map(t => h("th", { scope: "col" }, t)))),
      tbody))));
  devices.forEach(d => tbody.append(h("tr", {},
    h("td", {}, h("a", { href: `#/assets/${d.id}` }, d.name)), h("td", {}, KIND_PT[d.kind]),
    h("td", { class: "mono" }, d.mgmt_ip), h("td", {}, d.platform), h("td", {}, d.location || "—"),
    h("td", { class: "num" }, d.assets), h("td", {}, fmtDate(d.last_scan)),
    h("td", {}, can("admin") ? h("button", { class: "btn link danger", type: "button", onclick: async () => {
      if (!confirm(`Remover "${d.name}" e os seus ativos?`)) return;
      try { await api(`/api/devices/${d.id}`, { method: "DELETE" }); navigate(); } catch (ex) { alert(ex.message); }
    } }, "Remover") : ""))));
  if (!devices.length) tbody.append(h("tr", {}, h("td", { colspan: 8, class: "empty" }, "Nenhum equipamento registado.")));
}

// ------------------------------------------------------------------ histórico
async function HistoryView() {
  setHead("Histórico", "Levantamentos de rede e recolhas por equipamento (últimas 50 de cada).");
  const [{ runs }, { scans }] = await Promise.all([api("/api/discovery"), api("/api/scans")]);
  const t1 = h("tbody"), t2 = h("tbody");
  view.append(h("div", { class: "card" }, h("h2", {}, "Levantamentos de rede"), h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["#", "Redes", "Intensidade", "Estado", "Ativos", "Utilizador", "Início"].map(t => h("th", { scope: "col" }, t)))), t1))));
  runs.forEach(r => t1.append(h("tr", {},
    h("td", { class: "num" }, h("a", { href: `#/discovery/${r.id}` }, r.id)),
    h("td", { class: "mono" }, r.options.networks.length ? r.options.networks.join(", ") : "automática"),
    h("td", {}, r.options.intensity), h("td", {}, badge(r.status)), h("td", { class: "num" }, r.asset_count),
    h("td", {}, r.username), h("td", {}, fmtDate(r.started_at)))));
  if (!runs.length) t1.append(h("tr", {}, h("td", { colspan: 7, class: "empty" }, "Sem descobertas.")));
  view.append(h("div", { class: "card spaced" }, h("h2", {}, "Recolhas por equipamento"), h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["#", "Equipamento", "Método", "Estado", "Ativos", "Utilizador", "Início", "Detalhe"].map(t => h("th", { scope: "col" }, t)))), t2))));
  scans.forEach(s => t2.append(h("tr", {},
    h("td", { class: "num" }, h("a", { href: `#/scan/${s.id}` }, s.id)), h("td", {}, s.device), h("td", {}, s.method.toUpperCase()),
    h("td", {}, badge(s.status)), h("td", { class: "num" }, s.asset_count), h("td", {}, s.username),
    h("td", {}, fmtDate(s.started_at)), h("td", { class: "muted" }, s.error || ""))));
  if (!scans.length) t2.append(h("tr", {}, h("td", { colspan: 8, class: "empty" }, "Sem recolhas.")));
}

// --------------------------------------------------------------- segurança
async function AdminView() {
  setHead("Segurança", "Utilizadores, perfis e registo de auditoria (OWASP A09).");
  if (!can("admin")) { view.append(alertBox("Sem permissão.")); return; }
  const [{ users }, { audit }] = await Promise.all([api("/api/users"), api("/api/audit")]);
  const msg = h("div");
  const form = h("form", { class: "card", novalidate: true }, h("h2", {}, "Novo utilizador"),
    h("div", { class: "row" },
      h("div", {}, h("label", { for: "u-name" }, "Utilizador"), h("input", { id: "u-name", maxlength: 32, autocomplete: "off" })),
      h("div", {}, h("label", { for: "u-role" }, "Perfil"), h("select", { id: "u-role" },
        h("option", { value: "viewer" }, "Leitor"), h("option", { value: "operator" }, "Operador"), h("option", { value: "admin" }, "Administrador"))),
      h("div", {}, h("label", { for: "u-pass" }, "Palavra-passe (mín. 12)"), h("input", { id: "u-pass", type: "password", minlength: 12, maxlength: 128, autocomplete: "new-password" }))),
    msg, h("div", { class: "toolbar" }, h("button", { class: "btn primary", type: "submit" }, "Criar")));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    msg.replaceChildren();
    const val = id => document.getElementById(id).value;
    try { await api("/api/users", { method: "POST", json: { username: val("u-name"), role: val("u-role"), password: val("u-pass") } }); navigate(); }
    catch (ex) { msg.append(alertBox(ex.message)); }
  });
  view.append(h("div", { class: "grid two" }, form,
    h("div", { class: "card" }, h("h2", {}, "Utilizadores"), h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Utilizador"), h("th", {}, "Perfil"), h("th", {}, "Criado"))),
      h("tbody", {}, users.map(u => h("tr", {}, h("td", {}, u.username), h("td", {}, u.role), h("td", {}, fmtDate(u.created_at))))))))));
  view.append(h("div", { class: "card" }, h("h2", {}, "Registo de auditoria (últimos 200)"),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Data", "Utilizador", "Ação", "Detalhe", "IP"].map(t => h("th", { scope: "col" }, t)))),
      h("tbody", {}, audit.map(a => h("tr", {}, h("td", {}, fmtDate(a.ts)), h("td", {}, a.username || "—"),
        h("td", { class: "mono" }, a.action), h("td", {}, a.detail || ""), h("td", { class: "mono" }, a.ip || ""))))))));
}

navigate();
// retoma o indicador do topo se houver uma descoberta em curso (p.ex. após recarregar a página)
api("/api/discovery/context", { global: true }).then(c => { if (c.running) Live.track(c.running, "discovery"); }).catch(() => {});
