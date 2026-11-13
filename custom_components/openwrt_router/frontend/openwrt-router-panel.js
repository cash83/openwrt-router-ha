/* OpenWrt Router — sidebar page for Home Assistant.
 * Plain custom element, no build step and nothing loaded from the internet:
 * it must open the same way at home and through a VPN.
 */

const TEXT = {
  it: {
    title: "Wi-Fi di casa", online: "Internet attivo", offline: "Internet assente",
    publicIp: "IP pubblico", download: "Download", upload: "Upload", devices: "Dispositivi",
    nodes: "Nodi", main: "Router principale", satellite: "Nodo mesh", unreachable: "Non raggiungibile",
    link: "Collegamento", cable: "via cavo", cpu: "CPU", ram: "Memoria", up: "Acceso da",
    lights: "Luci", restart: "Riavvia", wifi: "Reti Wi-Fi", channel: "Canale", width: "Larghezza",
    standard: "Standard", power: "Potenza", hidden: "Rete nascosta", isolate: "Isola i dispositivi",
    settings: "Impostazioni", allNodes: "su tutti i nodi", clients: "Dispositivi collegati",
    search: "Cerca per nome, IP o MAC", all: "Tutti", wired: "Cavo", sortSignal: "Segnale",
    sortTraffic: "Traffico", sortName: "Nome", sortBy: "Ordina", none: "Nessun dispositivo",
    connectedTo: "Collegato a", since: "da", signal: "Segnale", address: "Indirizzo",
    internet: "Accesso a internet", blocked: "Bloccato", kick: "Scollega e fai riagganciare",
    close: "Chiudi", confirm: "Conferma", cancel: "Annulla",
    askReboot: "Riavviare {name}? I dispositivi collegati a questo nodo perdono la rete per un paio di minuti.",
    askWifiOff: "Spegnere la rete {name} su tutti i nodi? I dispositivi che la usano si scollegano.",
    askWifiChange: "Cambiare {what} della rete {name}? Il Wi-Fi di quella banda si interrompe per circa mezzo minuto.",
    askKick: "Scollegare {name}? Si ricollega da solo al nodo che sente meglio.",
    working: "Sto applicando…", done: "Fatto", failed: "Non riuscito: ",
    updated: "Aggiornato {n} s fa", noData: "Il router non risponde.", weak: "debole",
    fair: "discreto", good: "buono", excellent: "ottimo", excellentLink: "ottimo",
    day: "g", peers: "nodi collegati", peer: "nodo collegato", auto: "Automatico", powerMax: "Massima", powerMedium: "Media", powerLow: "Bassa", total: "Totale scaricato", totalUp: "Totale caricato",
    topDown: "Scarica di più", topUp: "Carica di più", refresh: "Aggiorna",
  },
  en: {
    title: "Home Wi-Fi", online: "Internet is up", offline: "No internet",
    publicIp: "Public IP", download: "Download", upload: "Upload", devices: "Devices",
    nodes: "Nodes", main: "Main router", satellite: "Mesh node", unreachable: "Unreachable",
    link: "Link", cable: "by cable", cpu: "CPU", ram: "Memory", up: "Running for",
    lights: "Lights", restart: "Restart", wifi: "Wi-Fi networks", channel: "Channel", width: "Width",
    standard: "Standard", power: "Power", hidden: "Hidden network", isolate: "Isolate devices",
    settings: "Settings", allNodes: "on every node", clients: "Connected devices",
    search: "Search by name, IP or MAC", all: "All", wired: "Cable", sortSignal: "Signal",
    sortTraffic: "Traffic", sortName: "Name", sortBy: "Sort", none: "No devices",
    connectedTo: "Connected to", since: "for", signal: "Signal", address: "Address",
    internet: "Internet access", blocked: "Blocked", kick: "Disconnect and let it rejoin",
    close: "Close", confirm: "Confirm", cancel: "Cancel",
    askReboot: "Restart {name}? Devices on this node lose the network for a couple of minutes.",
    askWifiOff: "Turn off {name} on every node? Devices using it will disconnect.",
    askWifiChange: "Change the {what} of {name}? That band drops for about half a minute.",
    askKick: "Disconnect {name}? It rejoins by itself on the node it hears best.",
    working: "Applying…", done: "Done", failed: "Failed: ",
    updated: "Updated {n} s ago", noData: "The router does not answer.", weak: "weak",
    fair: "fair", good: "good", excellent: "excellent", excellentLink: "excellent",
    day: "d", peers: "linked nodes", peer: "linked node", auto: "Auto", powerMax: "Maximum", powerMedium: "Medium", powerLow: "Low", total: "Total downloaded", totalUp: "Total uploaded",
    topDown: "Top downloader", topUp: "Top uploader", refresh: "Refresh",
  },
};

const ICON = {
  menu: "M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2z",
  refresh: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  router: "M20 13H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2M6 18.5A1.5 1.5 0 1 1 6 15.5a1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3M12 3a9 9 0 0 0-6.36 2.64l1.41 1.41A7 7 0 0 1 12 5a7 7 0 0 1 4.95 2.05l1.41-1.41A9 9 0 0 0 12 3m0 4a5 5 0 0 0-3.54 1.46l1.42 1.42A3 3 0 0 1 12 9a3 3 0 0 1 2.12.88l1.42-1.42A5 5 0 0 0 12 7z",
  down: "M11 4h2v12l5.5-5.5 1.42 1.42L12 19.84l-7.92-7.92L5.5 10.5 11 16V4z",
  up: "M13 20h-2V8l-5.5 5.5-1.42-1.42L12 4.16l7.92 7.92-1.42 1.42L13 8v12z",
  cable: "M4 1h16v8h-3v2h-2V9h-2v2h-2V9H9v2H7V9H4V1m3 12h2v3a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-3h2v3a5 5 0 0 1-4 4.9V23h-2v-2.1A5 5 0 0 1 7 16v-3z",
  light: "M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1z",
  power: "M16.56 5.44l-1.45 1.45A5.97 5.97 0 0 1 18 12a6 6 0 0 1-12 0c0-2.17 1.16-4.06 2.88-5.12L7.44 5.44A7.96 7.96 0 0 0 4 12a8 8 0 0 0 16 0c0-2.72-1.36-5.12-3.44-6.56M13 3h-2v10h2V3z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
  chevron: "M7.41 8.58L12 13.17l4.59-4.59L18 10l-6 6-6-6 1.41-1.42z",
};

const svg = (name, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${ICON[name]}"/></svg>`;

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const level = (dbm) => (dbm == null ? 0 : dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1);
const levelWord = (t, dbm) => [null, t.weak, t.fair, t.good, t.excellent][level(dbm)];

const bars = (dbm) => {
  const lit = level(dbm);
  const tone = lit >= 3 ? "ok" : lit === 2 ? "mid" : "low";
  return `<span class="bars ${tone}" role="img" aria-label="${dbm ?? ""} dBm">${[1, 2, 3, 4]
    .map((i) => `<i class="${i <= lit ? "on" : ""}" style="height:${4 + i * 3}px"></i>`)
    .join("")}</span>`;
};

const rate = (mbit) => {
  if (!mbit) return "0";
  if (mbit < 1) return `${Math.round(mbit * 1000)} kb/s`;
  return `${mbit < 10 ? mbit.toFixed(1) : Math.round(mbit)} Mb/s`;
};

const size = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb || 0)} MB`);

const duration = (seconds, t) => {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} ${t.day} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
};

const STYLE = `
:host{display:block;min-height:100vh;background:var(--primary-background-color,#111);color:var(--primary-text-color,#eee);
  font-family:var(--paper-font-body1_-_font-family,Roboto,system-ui,sans-serif);
  --ok:var(--success-color,#2e9d5b);--mid:var(--warning-color,#e0a100);--low:var(--error-color,#d6453d);
  --card:var(--card-background-color,#1c1c1e);--line:var(--divider-color,rgba(127,127,127,.25));
  --soft:var(--secondary-text-color,#9a9a9f);--accent:var(--primary-color,#03a9f4)}
*{box-sizing:border-box}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;height:56px;padding:0 8px;
  background:var(--app-header-background-color,var(--accent));color:var(--app-header-text-color,#fff)}
header h1{flex:1;margin:0;font-size:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header small{font-size:12px;opacity:.8;white-space:nowrap}
.icon{display:inline-grid;place-items:center;width:44px;height:44px;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer}
.icon:active{background:rgba(255,255,255,.16)}
.icon.spin svg{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
main{max-width:1040px;margin:0 auto;padding:14px 14px 96px;display:grid;gap:18px}
h2{margin:6px 2px -6px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--soft)}
.card{background:var(--card);border-radius:18px;padding:16px;box-shadow:var(--ha-card-box-shadow,0 1px 3px rgba(0,0,0,.18))}
.hero{display:grid;gap:14px;background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 26%,var(--card)),var(--card) 70%)}
.hero .state{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:600}
.dot{width:12px;height:12px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 5px color-mix(in srgb,var(--ok) 25%,transparent)}
.dot.off{background:var(--low);box-shadow:0 0 0 5px color-mix(in srgb,var(--low) 25%,transparent)}
.hero .ip{margin-left:auto;font-size:12px;font-weight:400;color:var(--soft);text-align:right}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.tile{background:color-mix(in srgb,var(--card) 70%,transparent);border:1px solid var(--line);border-radius:14px;padding:10px 12px;min-width:0}
.tile b{display:flex;align-items:center;gap:3px;font-size:19px;font-weight:650;white-space:nowrap;overflow:hidden}
.tile b svg{color:var(--accent);flex:none}
.tile span{display:block;font-size:12px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.facts{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--soft)}
.facts b{color:var(--primary-text-color);font-weight:500}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.node .top{display:flex;align-items:center;gap:12px}
.avatar{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;flex:none;
  background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.node.off .avatar{background:color-mix(in srgb,var(--low) 18%,transparent);color:var(--low)}
.node h3,.band h3{margin:0;font-size:17px;font-weight:600}
.sub{font-size:12.5px;color:var(--soft)}
.count{margin-left:auto;text-align:right}
.count b{display:block;font-size:26px;font-weight:650;line-height:1}
.split{display:flex;height:8px;margin:14px 0 6px;border-radius:99px;overflow:hidden;background:var(--line)}
.split i{display:block}
.split .a{background:var(--mid)}.split .b{background:var(--accent)}.split .c{background:var(--soft)}
.legend{display:flex;gap:14px;font-size:12px;color:var(--soft)}
.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.linkrow{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-size:13.5px}
.linkrow .sub{margin-left:auto;text-align:right}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 13px;border:1px solid var(--line);border-radius:99px;
  background:none;color:inherit;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.chip.on{background:color-mix(in srgb,var(--accent) 20%,transparent);border-color:var(--accent);color:var(--accent)}
.chip.static{cursor:default;color:var(--soft)}
.chip.danger{color:var(--low)}
.bars{display:inline-flex;align-items:flex-end;gap:2px;height:16px;flex:none}
.bars i{width:4px;border-radius:2px;background:var(--line)}
.bars.ok i.on{background:var(--ok)}.bars.mid i.on{background:var(--mid)}.bars.low i.on{background:var(--low)}
.band .top{display:flex;align-items:center;gap:12px}
.toggle{position:relative;margin-left:auto;width:52px;height:32px;border:0;border-radius:99px;background:var(--line);cursor:pointer;flex:none;transition:background .15s}
.toggle::after{content:"";position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.toggle.on{background:var(--accent)}.toggle.on::after{transform:translateX(20px)}
.toggle.small{width:44px;height:26px}.toggle.small::after{width:18px;height:18px}.toggle.small.on::after{transform:translateX(18px)}
details{margin-top:12px;border-top:1px solid var(--line)}
summary{display:flex;align-items:center;gap:6px;min-height:44px;font-size:13.5px;color:var(--soft);cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary svg{margin-left:auto;transition:transform .15s}
details[open] summary svg{transform:rotate(180deg)}
.field{display:flex;align-items:center;gap:10px;min-height:46px;font-size:14px}
.field label{flex:1}.field small{display:block;color:var(--soft);font-size:11.5px}
select{max-width:58%;min-height:38px;padding:0 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;font:inherit;font-size:14px}
.tools{display:grid;gap:10px}
input[type=search]{width:100%;height:46px;padding:0 14px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:inherit;font:inherit;font-size:15px;outline:none}
input[type=search]:focus{border-color:var(--accent)}
.scroll{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.scroll::-webkit-scrollbar{display:none}
.list{padding:4px 0}
.row{display:flex;align-items:center;gap:12px;width:100%;min-height:62px;padding:8px 16px;border:0;border-bottom:1px solid var(--line);
  background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.row:last-child{border-bottom:0}
.row:active{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.row .who{flex:1;min-width:0}
.row .who b{display:block;font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .who span{display:block;font-size:12px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .flow{text-align:right;font-size:11.5px;color:var(--soft);white-space:nowrap;flex:none}
.row .flow b{display:block;font-weight:500;color:var(--primary-text-color)}
.row.blocked .who b{color:var(--low);text-decoration:line-through}
.empty{padding:28px;text-align:center;color:var(--soft)}
.veil{position:fixed;inset:0;z-index:20;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55)}
.veil.open{display:flex}
.sheet{width:100%;max-width:520px;max-height:88vh;overflow:auto;padding:8px 18px calc(18px + env(safe-area-inset-bottom));
  background:var(--card);border-radius:22px 22px 0 0;animation:rise .18s ease-out}
@keyframes rise{from{transform:translateY(24px)}}
.grip{width:40px;height:4px;margin:6px auto 12px;border-radius:9px;background:var(--line)}
.sheet h3{margin:0 0 2px;font-size:19px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:16px 0;font-size:14px}
.kv dt{color:var(--soft)}.kv dd{margin:0;text-align:right;word-break:break-all}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin-top:10px;border:0;border-radius:14px;
  background:var(--accent);color:#fff;font:inherit;font-size:15px;font-weight:500;cursor:pointer}
.btn.ghost{background:none;border:1px solid var(--line);color:inherit}
.btn.danger{background:var(--low)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));z-index:30;transform:translate(-50%,120px);
  max-width:92vw;padding:12px 18px;border-radius:99px;background:#222;color:#fff;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.4);transition:transform .2s}
.toast.show{transform:translate(-50%,0)}
.toast.bad{background:var(--low)}
@media (max-width:420px){main{padding:12px 10px 96px}.tile{padding:10px 9px}.tile b{font-size:16.5px}.card{padding:14px}.row{padding:8px 14px}}
`;

class OpenWrtRouterPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._networks = [];
    this._filter = "all";
    this._sort = "signal";
    this._query = "";
    this._busy = false;
    this._loadedAt = 0;
    this._openDetails = new Set();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._build();
      this._load();
    }
  }

  set narrow(value) {
    this._narrow = value;
    const menu = this.shadowRoot.getElementById("menu");
    if (menu) menu.style.display = value ? "" : "none";
  }

  get t() {
    const language = (this._hass && this._hass.language) || "en";
    return TEXT[language.startsWith("it") ? "it" : "en"];
  }

  connectedCallback() {
    this._timer = setInterval(() => this._load(true), 5000);
    this._clock = setInterval(() => this._stamp(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearInterval(this._clock);
  }

  _build() {
    const t = this.t;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <header>
        <button class="icon" id="menu" aria-label="Menu">${svg("menu", 24)}</button>
        <h1>${esc(t.title)}</h1><small id="stamp"></small>
        <button class="icon" id="refresh" aria-label="${esc(t.refresh)}">${svg("refresh", 22)}</button>
      </header>
      <main>
        <section class="card hero" id="hero"></section>
        <h2>${esc(t.nodes)}</h2><section class="grid" id="nodes"></section>
        <h2>${esc(t.wifi)}</h2><section class="grid" id="wifi"></section>
        <h2 id="clientsTitle">${esc(t.clients)}</h2>
        <section class="tools">
          <input type="search" id="search" placeholder="${esc(t.search)}" autocomplete="off">
          <div class="scroll" id="filters"></div>
        </section>
        <section class="card list" id="clients" style="padding:0"></section>
      </main>
      <div class="veil" id="veil"><div class="sheet" id="sheet"></div></div>
      <div class="toast" id="toast"></div>`;
    const root = this.shadowRoot;
    root.getElementById("menu").style.display = this._narrow ? "" : "none";
    root.getElementById("menu").addEventListener("click", () =>
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })));
    root.getElementById("refresh").addEventListener("click", () => this._act({ action: "refresh" }, false));
    root.getElementById("search").addEventListener("input", (event) => {
      this._query = event.target.value.trim().toLowerCase();
      this._renderClients();
    });
    root.getElementById("veil").addEventListener("click", (event) => {
      if (event.target.id === "veil") this._close();
    });
    root.addEventListener("click", (event) => this._click(event));
    root.addEventListener("change", (event) => this._change(event));
    root.addEventListener("toggle", (event) => {
      const id = event.target.dataset && event.target.dataset.keep;
      if (!id) return;
      if (event.target.open) this._openDetails.add(id);
      else this._openDetails.delete(id);
    }, true);
  }

  get net() { return this._networks[0]; }
  get data() { return this.net && this.net.data; }

  async _load(quiet = false) {
    if (!this._hass || this._busy) return;
    try {
      const reply = await this._hass.callWS({ type: "openwrt_router/snapshot" });
      this._networks = reply.networks || [];
      this._loadedAt = Date.now();
      this._render();
    } catch (error) {
      if (!quiet) this._toast(this.t.failed + (error.message || error), true);
    }
  }

  _stamp() {
    const stamp = this.shadowRoot.getElementById("stamp");
    if (stamp && this._loadedAt) {
      stamp.textContent = this.t.updated.replace("{n}", Math.round((Date.now() - this._loadedAt) / 1000));
    }
  }

  _render() {
    const root = this.shadowRoot;
    const data = this.data;
    if (!data) {
      root.getElementById("hero").innerHTML = `<div class="state"><span class="dot off"></span>${esc(this.t.noData)}</div>`;
      return;
    }
    this._renderHero();
    this._renderNodes();
    // Leave the settings alone while a selector is open under the finger.
    if (!(root.activeElement && root.activeElement.tagName === "SELECT")) this._renderWifi();
    this._renderFilters();
    this._renderClients();
    if (this._sheetMac) this._renderClientSheet();
  }

  _renderHero() {
    const t = this.t, { network, totals, nodes, main } = this.data;
    const up = network.wan_up;
    const top = (entry, key) => entry && entry[key] > 0.05 ? `${esc(entry.name)} · ${rate(entry[key])}` : "—";
    this.shadowRoot.getElementById("hero").innerHTML = `
      <div class="state"><span class="dot ${up ? "" : "off"}"></span>${esc(up ? t.online : t.offline)}
        <span class="ip">${esc(t.publicIp)}<br><b>${esc(network.public_ip || "—")}</b></span></div>
      <div class="tiles">
        <div class="tile"><b>${svg("down", 18)}${esc(rate(totals.down))}</b><span>${esc(t.download)}</span></div>
        <div class="tile"><b>${svg("up", 18)}${esc(rate(totals.up))}</b><span>${esc(t.upload)}</span></div>
        <div class="tile"><b>${totals.clients}</b><span>${esc(t.devices)}</span></div>
      </div>
      <div class="facts">
        <span>${esc(t.topDown)}: <b>${top(totals.top_down, "down")}</b></span>
        <span>${esc(t.topUp)}: <b>${top(totals.top_up, "up")}</b></span>
        <span>${esc(t.total)}: <b>${size(network.download_mb)}</b></span>
        <span>${esc(t.totalUp)}: <b>${size(network.upload_mb)}</b></span>
        <span>${esc(t.up)}: <b>${esc(duration(nodes[main].uptime, t))}</b></span>
      </div>`;
  }

  _renderNodes() {
    const t = this.t, { nodes } = this.data;
    this.shadowRoot.getElementById("nodes").innerHTML = Object.values(nodes).map((node) => {
      const total = Math.max(1, node.clients || 0);
      const pct = (n) => `${(100 * (n || 0)) / total}%`;
      const mesh = node.mesh;
      const link = node.is_main
        ? (mesh ? `<div class="linkrow">${bars(mesh.signal)}<span>Mesh ${mesh.signal} dBm</span><span class="sub">${mesh.peers} ${esc(mesh.peers === 1 ? t.peer : t.peers)}</span></div>` : "")
        : `<div class="linkrow">${mesh ? bars(mesh.signal) : svg("cable", 18)}
            <span>${esc(t.link)} ${mesh ? `${mesh.signal} dBm · ${esc(levelWord(t, mesh.signal))}` : esc(t.cable)}</span>
            <span class="sub">${mesh ? `↑ ${mesh.tx_rate} · ↓ ${mesh.rx_rate} Mb/s` : ""}</span></div>`;
      return `<article class="card node ${node.online ? "" : "off"}">
        <div class="top"><div class="avatar">${svg("router", 24)}</div>
          <div><h3>${esc(node.name)}</h3><div class="sub">${esc(node.online ? (node.is_main ? t.main : t.satellite) : t.unreachable)} · ${esc(node.host)}</div></div>
          <div class="count"><b>${node.clients ?? 0}</b><span class="sub">${esc(t.devices.toLowerCase())}</span></div></div>
        <div class="split"><i class="a" style="width:${pct(node.clients_2g)}"></i><i class="b" style="width:${pct(node.clients_5g)}"></i><i class="c" style="width:${pct(node.clients_wired)}"></i></div>
        <div class="legend"><span><i style="background:var(--mid)"></i>2,4 GHz ${node.clients_2g || 0}</span><span><i style="background:var(--accent)"></i>5 GHz ${node.clients_5g || 0}</span>${node.clients_wired ? `<span><i style="background:var(--soft)"></i>${esc(t.wired)} ${node.clients_wired}</span>` : ""}</div>
        ${link}
        <div class="chips">
          <span class="chip static">${esc(t.cpu)} ${node.cpu ?? "—"}%</span>
          <span class="chip static">${esc(t.ram)} ${node.ram ?? "—"}%</span>
          <span class="chip static">${esc(duration(node.uptime, t))}</span>
          ${node.leds == null ? "" : `<button class="chip ${node.leds ? "on" : ""}" data-do="leds" data-node="${esc(node.id)}" data-value="${node.leds ? "" : "1"}">${svg("light", 16)}${esc(t.lights)}</button>`}
          <button class="chip danger" data-do="reboot" data-node="${esc(node.id)}" data-name="${esc(node.name)}">${svg("power", 16)}${esc(t.restart)}</button>
        </div></article>`;
    }).join("");
  }

  _carriesLink(band) {
    return Object.values(this.data.nodes).some((node) => node.radios[band] && node.radios[band].mesh_ifname);
  }

  _renderWifi() {
    const t = this.t, { nodes, main } = this.data;
    const select = (band, setting, radio, node, hint) => {
      const options = radio.options[setting] || {};
      const current = String(setting === "channel" ? radio.channel_setting : radio[setting]);
      const label = { channel: t.channel, width: t.width, mode: t.standard, tx_power: t.power }[setting];
      const local = setting === "tx_power" ? { max: t.powerMax, medium: t.powerMedium, low: t.powerLow }
        : setting === "channel" ? { auto: t.auto } : {};
      return `<div class="field"><label>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</label>
        <select data-band="${band}" data-setting="${setting}" data-node="${esc(node || "")}" data-ssid="${esc(radio.ssid)}" data-label="${esc(label.toLowerCase())}">
        ${Object.entries(options).map(([value, text]) => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(local[value] || text)}</option>`).join("")}
        </select></div>`;
    };
    const flag = (band, setting, radio, label) => `<div class="field"><label>${esc(label)}</label>
        <button class="toggle small ${radio[setting] ? "on" : ""}" data-do="radio" data-band="${band}" data-setting="${setting}" data-value="${radio[setting] ? "" : "1"}" data-ssid="${esc(radio.ssid)}" data-label="${esc(label.toLowerCase())}" aria-pressed="${!!radio[setting]}"></button></div>`;

    this.shadowRoot.getElementById("wifi").innerHTML = Object.entries(nodes[main].radios).map(([band, radio]) => {
      const shared = this._carriesLink(band) || Object.keys(nodes).length === 1;
      const channels = shared
        ? select(band, "channel", radio, "", t.allNodes)
        : Object.values(nodes).filter((n) => n.radios[band] && n.online)
            .map((n) => select(band, "channel", n.radios[band], n.id, n.name)).join("");
      const live = Object.values(nodes).filter((n) => n.radios[band] && n.online)
        .map((n) => `${n.name} ${n.radios[band].channel ?? "—"}`).join(" · ");
      const key = `wifi-${band}`;
      return `<article class="card band">
        <div class="top"><div class="avatar">${band === "2g" ? "2.4" : band === "5g" ? "5" : "6"}</div>
          <div><h3>${esc(radio.ssid || "—")}</h3><div class="sub">${esc(t.channel)}: ${esc(live)} · ${esc(radio.width)} MHz</div></div>
          <button class="toggle ${radio.enabled ? "on" : ""}" data-do="radio" data-band="${band}" data-setting="enabled" data-value="${radio.enabled ? "" : "1"}" data-ssid="${esc(radio.ssid)}" aria-pressed="${!!radio.enabled}"></button></div>
        <details data-keep="${key}" ${this._openDetails.has(key) ? "open" : ""}><summary>${esc(t.settings)} <span class="sub">(${esc(t.allNodes)})</span>${svg("chevron", 20)}</summary>
          ${channels}${select(band, "width", radio, "")}${select(band, "mode", radio, "")}${select(band, "tx_power", radio, "")}
          ${flag(band, "hidden", radio, t.hidden)}${flag(band, "isolate", radio, t.isolate)}
        </details></article>`;
    }).join("");
  }

  _renderFilters() {
    const t = this.t, { nodes, totals } = this.data;
    const chips = [["all", `${t.all} ${totals.clients}`]]
      .concat(Object.values(nodes).map((node) => [`node:${node.id}`, `${node.name} ${node.clients ?? 0}`]))
      .concat([["band:2g", `2,4 GHz ${totals.wifi_2g}`], ["band:5g", `5 GHz ${totals.wifi_5g}`]])
      .concat(totals.wired ? [["band:wired", `${t.wired} ${totals.wired}`]] : []);
    const sorts = [["signal", t.sortSignal], ["traffic", t.sortTraffic], ["name", t.sortName]];
    this.shadowRoot.getElementById("filters").innerHTML =
      chips.map(([id, label]) => `<button class="chip ${this._filter === id ? "on" : ""}" data-filter="${esc(id)}">${esc(label)}</button>`).join("") +
      `<span class="chip static">${esc(t.sortBy)}:</span>` +
      sorts.map(([id, label]) => `<button class="chip ${this._sort === id ? "on" : ""}" data-sort="${id}">${esc(label)}</button>`).join("");
  }

  _renderClients() {
    const t = this.t;
    let list = Object.values(this.data.clients);
    const [kind, value] = this._filter.split(/:(.*)/s);
    if (kind === "node") list = list.filter((c) => c.node_id === value);
    if (kind === "band") list = list.filter((c) => c.band === value);
    if (this._query) {
      list = list.filter((c) => `${c.name} ${c.ip || ""} ${c.mac}`.toLowerCase().includes(this._query));
    }
    const by = {
      signal: (a, b) => (a.signal ?? 1) - (b.signal ?? 1),
      traffic: (a, b) => b.down + b.up - (a.down + a.up),
      name: (a, b) => a.name.localeCompare(b.name),
    }[this._sort];
    list.sort(by);
    this.shadowRoot.getElementById("clientsTitle").textContent = `${t.clients} · ${list.length}`;
    this.shadowRoot.getElementById("clients").innerHTML = list.length ? list.map((c) => `
      <button class="row ${c.blocked ? "blocked" : ""}" data-client="${esc(c.mac)}">
        ${c.band === "wired" ? `<span class="bars">${svg("cable", 18)}</span>` : bars(c.signal)}
        <span class="who"><b>${esc(c.name)}</b><span>${esc(c.node)} · ${esc(c.band === "wired" ? t.wired : c.connection)}${c.signal == null ? "" : ` · ${c.signal} dBm`}${c.ip ? ` · ${esc(c.ip)}` : ""}</span></span>
        <span class="flow"><b>↓ ${esc(rate(c.down))}</b>↑ ${esc(rate(c.up))}</span>
      </button>`).join("") : `<div class="empty">${esc(t.none)}</div>`;
  }

  _renderClientSheet() {
    const t = this.t;
    const c = Object.values(this.data.clients).find((client) => client.mac === this._sheetMac);
    if (!c) return this._close();
    this._sheet(`<div class="grip"></div><h3>${esc(c.name)}</h3>
      <div class="sub">${esc(t.connectedTo)} ${esc(c.node)} · ${esc(c.band === "wired" ? t.wired : c.connection)}</div>
      <dl class="kv">
        ${c.signal == null ? "" : `<dt>${esc(t.signal)}</dt><dd>${bars(c.signal)} ${c.signal} dBm · ${esc(levelWord(t, c.signal))}</dd>`}
        <dt>${esc(t.address)}</dt><dd>${esc(c.ip || "—")}</dd><dt>MAC</dt><dd>${esc(c.mac)}</dd>
        ${c.connected == null ? "" : `<dt>${esc(t.connectedTo)} ${esc(c.node)} ${esc(t.since)}</dt><dd>${esc(duration(c.connected, t))}</dd>`}
        <dt>${esc(t.download)}</dt><dd>${esc(rate(c.down))}</dd><dt>${esc(t.upload)}</dt><dd>${esc(rate(c.up))}</dd>
      </dl>
      <div class="field"><label>${esc(t.internet)}${c.blocked ? `<small>${esc(t.blocked)}</small>` : ""}</label>
        <button class="toggle ${c.blocked ? "" : "on"}" data-do="block" data-mac="${esc(c.mac)}" data-value="${c.blocked ? "" : "1"}" aria-pressed="${!c.blocked}"></button></div>
      ${c.band === "wired" ? "" : `<button class="btn ghost" data-do="kick" data-mac="${esc(c.mac)}" data-name="${esc(c.name)}">${esc(t.kick)}</button>`}
      <button class="btn ghost" data-do="close">${esc(t.close)}</button>`);
  }

  _sheet(html) {
    this.shadowRoot.getElementById("sheet").innerHTML = html;
    this.shadowRoot.getElementById("veil").classList.add("open");
  }

  _close() {
    this._sheetMac = null;
    this._pending = null;
    this.shadowRoot.getElementById("veil").classList.remove("open");
  }

  _ask(question, message, danger = false) {
    const t = this.t;
    this._sheetMac = null;
    this._pending = message;
    this._sheet(`<div class="grip"></div><h3>${esc(t.confirm)}</h3><p>${esc(question)}</p>
      <div class="pair"><button class="btn ghost" data-do="close">${esc(t.cancel)}</button>
      <button class="btn ${danger ? "danger" : ""}" data-do="go">${esc(t.confirm)}</button></div>`);
  }

  _click(event) {
    const target = event.target.closest("[data-do],[data-filter],[data-sort],[data-client]");
    if (!target) return;
    const t = this.t, d = target.dataset;
    if (d.filter) { this._filter = d.filter; this._renderFilters(); return this._renderClients(); }
    if (d.sort) { this._sort = d.sort; this._renderFilters(); return this._renderClients(); }
    if (d.client) { this._sheetMac = d.client; return this._renderClientSheet(); }
    const on = d.value === "1";
    switch (d.do) {
      case "close": return this._close();
      case "go": { const message = this._pending; this._close(); return message && this._act(message); }
      case "leds": return this._act({ action: "leds", node: d.node, value: on });
      case "reboot": return this._ask(t.askReboot.replace("{name}", d.name), { action: "reboot", node: d.node }, true);
      case "block": return this._act({ action: "block", mac: d.mac, value: on });
      case "kick": return this._ask(t.askKick.replace("{name}", d.name), { action: "kick", mac: d.mac });
      case "radio": {
        const message = { action: "radio", node: null, band: d.band, setting: d.setting, value: on };
        if (d.setting === "enabled" && !on) return this._ask(t.askWifiOff.replace("{name}", d.ssid), message, true);
        return this._ask(t.askWifiChange.replace("{what}", d.label || t.settings.toLowerCase()).replace("{name}", d.ssid), message);
      }
      default: return undefined;
    }
  }

  _change(event) {
    const select = event.target.closest("select[data-setting]");
    if (!select) return;
    const d = select.dataset;
    const message = { action: "radio", node: d.node || null, band: d.band, setting: d.setting, value: select.value };
    select.blur();
    this._ask(this.t.askWifiChange.replace("{what}", d.label).replace("{name}", d.ssid), message);
  }

  async _act(message, announce = true) {
    if (this._busy) return;
    const net = this.net;
    this._busy = true;
    const refresh = this.shadowRoot.getElementById("refresh");
    refresh.classList.add("spin");
    if (announce) this._toast(this.t.working);
    try {
      await this._hass.callWS({ type: "openwrt_router/action", entry_id: net && net.entry_id, ...message });
      if (announce) this._toast(this.t.done);
    } catch (error) {
      this._toast(this.t.failed + (error.message || error), true);
    } finally {
      this._busy = false;
      refresh.classList.remove("spin");
      this._load(true);
    }
  }

  _toast(text, bad = false) {
    const toast = this.shadowRoot.getElementById("toast");
    toast.textContent = text;
    toast.className = `toast show ${bad ? "bad" : ""}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove("show"), bad ? 6000 : 2200);
  }
}

if (!customElements.get("openwrt-router-panel")) {
  customElements.define("openwrt-router-panel", OpenWrtRouterPanel);
}
