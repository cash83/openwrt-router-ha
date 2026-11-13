/* Wi-Fi di casa — the router's own sections, drawn by the app.
 *
 * Each page reads the router with plain ubus calls through `ctx.rpc`, which
 * app.js routes either straight to the router or through Home Assistant
 * (where only the calls listed in the integration's passthrough.py pass).
 * Everything is written with textContent, never as markup.
 */
(function () {
  "use strict";

  const GROUPS = [
    ["Stato", [
      ["overview", "Panoramica"],
      ["live", "Traffico in tempo reale"],
      ["log", "Registro di sistema"],
      ["channels", "Analisi dei canali"],
      ["processes", "Processi"],
      ["routes", "Instradamento"],
    ]],
    ["Sistema", [
      ["system", "Sistema"],
      ["software", "Software"],
      ["startup", "Avvio e servizi"],
      ["password", "Password del router"],
      ["backup", "Backup delle impostazioni"],
      ["cron", "Operazioni pianificate"],
      ["reboot", "Riavvia"],
    ]],
    ["Rete", [
      ["interfaces", "Interfacce"],
      ["wifi", "Wi-Fi: nome e password"],
      ["dhcp", "DHCP e DNS"],
      ["firewall", "Firewall e porte"],
      ["diag", "Diagnostica"],
      ["usteer", "Roaming tra i nodi"],
    ]],
  ];

  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "value") el.value = value;
      else if (value === true) el.setAttribute(key, "");
      else if (value !== false && value != null) el.setAttribute(key, value);
    }
    for (const kid of kids.flat(3)) {
      if (kid != null && kid !== false && kid !== "") el.append(kid.nodeType ? kid : String(kid));
    }
    return el;
  }

  // ---- small formatters

  const list = (value) => (value == null ? [] : Array.isArray(value) ? value : String(value).split(/\s+/).filter(Boolean));
  const bytes = (n) => {
    n = Number(n) || 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return (i ? n.toFixed(n < 10 ? 2 : 1) : String(n)).replace(".", ",") + " " + units[i];
  };
  const span = (seconds) => {
    seconds = Math.max(0, Math.round(Number(seconds) || 0));
    const d = Math.floor(seconds / 86400), hrs = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
    if (d) return `${d} g ${hrs} h`;
    if (hrs) return `${hrs} h ${m} min`;
    if (m) return `${m} min`;
    return `${seconds} s`;
  };
  const percent = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);
  const isIp = (text) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(text) && text.split(".").every((p) => Number(p) <= 255);
  const isMac = (text) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(text);
  const isPort = (text) => /^\d{1,5}(-\d{1,5})?$/.test(text) && text.split("-").every((p) => Number(p) >= 1 && Number(p) <= 65535);

  // ---- building blocks

  const card = (title, ...kids) => [title ? h("h3", { class: "sec" }, title) : null, h("div", { class: "pcard" }, kids)];
  const rows = (pairs) => pairs.filter((p) => p && p[1] != null && p[1] !== "")
    .map(([key, value]) => h("div", { class: "kv" }, h("span", null, key), h("b", null, value)));
  const item = (title, sub, right, onclick, tone) =>
    h(onclick ? "button" : "div", { class: "li" + (tone ? " " + tone : ""), onclick },
      h("span", { class: "who" }, h("b", null, title), sub ? h("small", null, sub) : null),
      right != null && right !== "" ? h("span", { class: "side" }, right) : null);
  const empty = (text) => h("p", { class: "none" }, text);
  const note = (text) => h("p", { class: "pnote" }, text);
  const bar = (value) => h("div", { class: "meter" }, h("i", { style: `width:${Math.max(0, Math.min(100, value))}%` }));
  const button = (label, onclick, kind) => h("button", { class: "pbtn" + (kind ? " " + kind : ""), onclick }, label);
  const dot = (on) => h("i", { class: "dot" + (on ? " on" : "") });

  let toastTimer = null;
  function toast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3200);
  }

  // ---- the question sheet: a confirmation, a form, or a list of choices

  let settle = null;
  function closeAsk(value) {
    $("ask").classList.remove("show");
    const done = settle;
    settle = null;
    if (done) done(value == null ? null : value);
  }

  /** {title, text, fields:[{key,label,value,placeholder,mode,options}], ok, danger, choices:[[key,label,tone]]} */
  function ask(spec) {
    if (settle) closeAsk(null);
    $("askTitle").textContent = spec.title || "";
    $("askText").textContent = spec.text || "";
    $("askText").hidden = !spec.text;
    const body = $("askBody");
    body.textContent = "";
    const inputs = {};
    for (const field of spec.fields || []) {
      const control = field.options
        ? h("select", null, field.options.map(([value, label]) => h("option", { value }, label)))
        : h("input", { type: field.secret ? "password" : "text", inputmode: field.mode || "text", placeholder: field.placeholder || "", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
      control.value = field.value == null ? "" : field.value;
      inputs[field.key] = control;
      body.append(h("label", null, field.label), control);
    }
    for (const [key, label, tone] of spec.choices || []) {
      body.append(h("button", { class: "plain" + (tone ? " " + tone : ""), onclick: () => closeAsk(key) }, label));
    }
    const error = h("div", { class: "error" });
    body.append(error);
    const ok = $("askOk");
    ok.hidden = Boolean(spec.choices);
    ok.textContent = spec.ok || "Conferma";
    ok.classList.toggle("danger", Boolean(spec.danger));
    ok.onclick = () => {
      const values = {};
      for (const [key, control] of Object.entries(inputs)) values[key] = control.type === "password" ? control.value : control.value.trim();
      const problem = spec.check ? spec.check(values) : "";
      if (problem) { error.textContent = problem; error.classList.add("show"); return; }
      closeAsk(spec.fields ? values : true);
    };
    $("ask").classList.add("show");
    return new Promise((resolve) => { settle = resolve; });
  }

  // ---- the page frame

  let ctx = null;
  let current = null;
  let run = 0;
  let cleanups = [];

  function stopTimers() {
    cleanups.forEach((fn) => { try { fn(); } catch (e) { /* already gone */ } });
    cleanups = [];
  }

  function explain(error) {
    const text = String((error && error.message) || error || "");
    if (/unknown command/i.test(text)) return "Per queste pagine serve l'integrazione OpenWrt Router 0.7.0 o più recente in Home Assistant.";
    if (/unreachable|non collegato|nessuna risposta|interrotto/i.test(text)) return "Il router non risponde. Controlla il collegamento e riprova.";
    if (/not available|not_allowed/i.test(text)) return "Questa lettura non è disponibile passando da Home Assistant.";
    if (/"?code"?:\s*-32002|\[6\]|: 6$|Access denied/i.test(text)) return "Il router non concede questa lettura a questo utente.";
    if (/\[4\]|: 4$|Not found/i.test(text)) return "Su questo router la funzione non è installata.";
    return text || "Qualcosa non ha funzionato.";
  }

  async function load() {
    const mine = ++run;
    stopTimers();
    const body = $("pBody");
    body.textContent = "";
    body.append(h("div", { class: "wait" }, h("i"), "Leggo dal router…"));
    $("pRefresh").classList.add("spin");
    const out = h("div", { class: "pwrap" });
    try {
      await PAGES[current](ctx, out, () => mine === run);
      if (mine !== run) return;
      body.textContent = "";
      body.append(out);
    } catch (error) {
      if (mine !== run) return;
      body.textContent = "";
      body.append(h("div", { class: "pwrap" }, card(null, h("p", { class: "bad" }, explain(error)), button("Riprova", load))));
    } finally {
      if (mine === run) $("pRefresh").classList.remove("spin");
    }
  }

  function open(key, context) {
    const label = GROUPS.flatMap(([, pages]) => pages).find(([id]) => id === key);
    if (!label || !context.node) return;
    ctx = context;
    current = key;
    $("pTitle").textContent = label[1];
    $("pNode").textContent = context.node.name;
    $("page").classList.add("show");
    $("pBody").scrollTop = 0;
    load();
  }

  function close() {
    run += 1;
    stopTimers();
    if (settle) closeAsk(null);
    $("page").classList.remove("show");
    current = null;
  }

  /** Android's back key: true when something here was closed. */
  function back() {
    if ($("ask").classList.contains("show")) { closeAsk(null); return true; }
    if ($("page").classList.contains("show")) { close(); return true; }
    return false;
  }

  // ---- reading helpers

  const exec = async (c, command, params) => {
    const reply = (await c.rpc("file", "exec", params ? { command, params } : { command })) || {};
    return { text: String(reply.stdout || ""), error: String(reply.stderr || ""), code: reply.code || 0 };
  };
  const uci = async (c, config) => ((await c.rpc("uci", "get", { config })) || {}).values || {};
  const sections = (values, type) => Object.entries(values)
    .filter(([, section]) => section[".type"] === type)
    .sort((a, b) => (a[1][".index"] || 0) - (b[1][".index"] || 0))
    .map(([name, section]) => ({ ...section, id: name }));

  /** Run a change, say how it went, draw the page again. */
  async function change(work, done) {
    $("pRefresh").classList.add("spin");
    try {
      await work();
      toast(done || "Fatto");
    } catch (error) {
      toast(explain(error));
    }
    if (current) load();
  }

  // ---------------------------------------------------------------- pages

  const PAGES = {};

  PAGES.overview = async (c, out) => {
    const [board, info, dump] = await Promise.all([
      c.rpc("system", "board"), c.rpc("system", "info"), c.rpc("network.interface", "dump"),
    ]);
    const release = board.release || {};
    const memory = info.memory || {};
    const usedMemory = (memory.total || 0) - (memory.available != null ? memory.available : memory.free || 0);
    const root = info.root || {};
    const load = (info.load || []).map((v) => (v / 65536).toFixed(2).replace(".", ","));
    out.append(...card("Dispositivo", rows([
      ["Nome", board.hostname], ["Modello", board.model],
      ["Firmware", release.description || [release.distribution, release.version].filter(Boolean).join(" ")],
      ["Kernel", board.kernel], ["Architettura", board.system],
      ["Acceso da", span(info.uptime)],
      ["Ora del router", info.localtime ? new Date(info.localtime * 1000).toISOString().slice(0, 16).replace("T", " ") : null],
    ])));
    out.append(...card("Risorse",
      h("div", { class: "kv" }, h("span", null, "Memoria"), h("b", null, `${bytes(usedMemory)} di ${bytes(memory.total)} (${percent(usedMemory, memory.total)}%)`)),
      bar(percent(usedMemory, memory.total)),
      root.total ? [
        h("div", { class: "kv" }, h("span", null, "Spazio"), h("b", null, `${bytes(root.used * 1024)} di ${bytes(root.total * 1024)} (${percent(root.used, root.total)}%)`)),
        bar(percent(root.used, root.total)),
      ] : null,
      rows([["Carico (1, 5, 15 min)", load.join(" · ")]])));
    const up = ((dump && dump.interface) || []).filter((i) => i.interface !== "loopback");
    out.append(...card("Rete", up.length ? up.map((i) => {
      const address = (i["ipv4-address"] || [])[0];
      return item(i.interface.toUpperCase(),
        address ? `${address.address}/${address.mask}` : (i.proto === "none" ? "senza indirizzo" : "nessun indirizzo"),
        [dot(i.up), i.up ? span(i.uptime) : "giù"]);
    }) : empty("Nessuna interfaccia.")));
  };

  PAGES.live = async (c, out, alive) => {
    const dump = await c.rpc("network.interface", "dump");
    const wan = ((dump && dump.interface) || []).find((i) => i.interface === "wan") || {};
    const device = wan.l3_device || wan.device || "br-lan";
    const down = [], up = [];
    let before = null;
    const nowDown = h("b", null, "—"), nowUp = h("b", null, "—"), peak = h("b", null, "—");
    const chart = h("div", { class: "chart" });
    const loadText = h("b", null, "—");
    out.append(...card(`Internet (${device})`,
      h("div", { class: "duo" },
        h("div", null, h("small", { class: "c1" }, "Scarica"), nowDown),
        h("div", null, h("small", { class: "c2" }, "Carica"), nowUp)),
      chart,
      rows([["Massimo visto", peak]]), h("div", { class: "kv" }, h("span", null, "Carico del processore"), loadText)));
    out.append(note("Un punto ogni 2 secondi, ultimi 2 minuti. I numeri sono in Mbit/s."));
    const mbit = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)).replace(".", ",") + " Mbit/s";
    const draw = () => {
      const top = Math.max(1, ...down, ...up);
      const line = (data) => data.map((v, i) => `${(i * 300 / 59).toFixed(1)},${(78 - (v / top) * 74).toFixed(1)}`).join(" ");
      chart.innerHTML = `<svg viewBox="0 0 300 80" preserveAspectRatio="none"><polyline class="c1" points="${line(down)}"/><polyline class="c2" points="${line(up)}"/></svg>`;
      peak.textContent = mbit(top <= 1 && !down.some((v) => v > 0) ? 0 : Math.max(...down, ...up));
    };
    const tick = async () => {
      try {
        const [status, info] = await Promise.all([c.rpc("network.device", "status", { name: device }), c.rpc("system", "info")]);
        if (!alive()) return;
        const stats = (status && status.statistics) || {};
        const now = Date.now();
        if (before) {
          const seconds = (now - before.at) / 1000;
          const rate = (a, b) => Math.max(0, ((a - b) * 8) / seconds / 1e6);
          down.push(rate(stats.rx_bytes || 0, before.rx)); up.push(rate(stats.tx_bytes || 0, before.tx));
          if (down.length > 60) { down.shift(); up.shift(); }
          nowDown.textContent = mbit(down[down.length - 1]);
          nowUp.textContent = mbit(up[up.length - 1]);
          draw();
        }
        before = { at: now, rx: stats.rx_bytes || 0, tx: stats.tx_bytes || 0 };
        if (info && info.load) loadText.textContent = (info.load[0] / 65536).toFixed(2).replace(".", ",");
      } catch (error) { /* a missed point */ }
    };
    await tick();
    const timer = setInterval(tick, 2000);
    cleanups.push(() => clearInterval(timer));
  };

  PAGES.log = async (c, out) => {
    let source = "system";
    let lines = [];
    const filter = h("input", { type: "search", placeholder: "Cerca nel registro", autocomplete: "off", autocapitalize: "off" });
    const box = h("div", { class: "log" });
    const count = h("p", { class: "pnote" });
    const paint = () => {
      const needle = filter.value.trim().toLowerCase();
      const shown = (needle ? lines.filter((l) => l.raw.toLowerCase().includes(needle)) : lines).slice(0, 400);
      box.textContent = "";
      shown.forEach((l) => box.append(h("div", { class: "ll " + l.tone },
        h("small", null, [l.time, l.source].filter(Boolean).join(" · ")), l.message)));
      if (!shown.length) box.append(empty("Niente da mostrare."));
      count.textContent = `${shown.length} righe su ${lines.length}, le più recenti in alto.`;
    };
    const parse = (raw) => {
      const sys = /^\w{3} \w{3}\s+\d+ (\d\d:\d\d:\d\d) \d{4} (\S+?)\.(\S+) ([^:]+): (.*)$/.exec(raw);
      if (sys) {
        const tone = /emerg|alert|crit|err/.test(sys[3]) ? "bad" : /warn/.test(sys[3]) ? "warn" : "";
        return { raw, time: sys[1], source: sys[4], message: sys[5], tone };
      }
      const kernel = /^<(\d+)>\[\s*([\d.]+)\]\s?(.*)$/.exec(raw);
      if (kernel) {
        const level = Number(kernel[1]) & 7;
        return { raw, time: kernel[2] + " s", source: "kernel", message: kernel[3], tone: level <= 3 ? "bad" : level === 4 ? "warn" : "" };
      }
      return { raw, time: "", source: "", message: raw, tone: "" };
    };
    const read = async () => {
      const reply = source === "system"
        ? await exec(c, "/usr/libexec/syslog-wrapper")
        : await exec(c, "/bin/dmesg", ["-r"]);
      lines = reply.text.split("\n").filter((l) => l.trim()).reverse().map(parse);
      paint();
    };
    const tabs = h("div", { class: "scrollx" });
    const paintTabs = () => {
      tabs.textContent = "";
      [["system", "Sistema"], ["kernel", "Kernel"]].forEach(([key, label]) => tabs.append(
        h("button", { class: "pill" + (source === key ? " on" : ""), onclick: async () => {
          source = key; paintTabs();
          try { await read(); } catch (error) { toast(explain(error)); }
        } }, label)));
    };
    paintTabs();
    filter.addEventListener("input", paint);
    await read();
    out.append(tabs, filter, count, h("div", { class: "pcard flat" }, box));
  };

  PAGES.channels = async (c, out) => {
    const radios = Object.entries(c.node.radios || {});
    if (!radios.length) { out.append(...card(null, empty("Questo nodo non ha radio Wi-Fi."))); return; }
    const NAMES = { "2g": "2,4 GHz", "5g": "5 GHz", "6g": "6 GHz" };
    out.append(note("Cerca le reti Wi-Fi dei vicini per capire quali canali sono affollati. La ricerca dura qualche secondo."));
    radios.forEach(([band, radio]) => {
      const result = h("div");
      const start = button("Cerca reti vicine", async () => {
        start.disabled = true; start.textContent = "Cerco…";
        try {
          const reply = await c.rpc("iwinfo", "scan", { device: radio.ifname || radio.radio });
          const found = ((reply && reply.results) || []).sort((a, b) => (b.signal || -200) - (a.signal || -200));
          const crowd = {};
          found.forEach((n) => { crowd[n.channel] = (crowd[n.channel] || 0) + 1; });
          const most = Math.max(1, ...Object.values(crowd));
          result.textContent = "";
          result.append(h("div", { class: "bars" }, Object.keys(crowd).sort((a, b) => a - b).map((channel) =>
            h("div", { class: String(channel) === String(radio.channel) ? "mine" : "" },
              h("i", { style: `height:${Math.round((crowd[channel] / most) * 46) + 4}px` }), h("b", null, channel), h("small", null, crowd[channel])))));
          result.append(found.length ? found.map((n) => item(n.ssid || "(rete nascosta)",
            `canale ${n.channel} · ${n.encryption && n.encryption.enabled ? "protetta" : "aperta"} · ${n.bssid || ""}`,
            n.signal != null ? `${n.signal} dBm` : "", null, String(n.channel) === String(radio.channel) ? "same" : "")) : empty("Nessuna rete trovata."));
        } catch (error) {
          result.textContent = "";
          result.append(h("p", { class: "bad" }, explain(error)));
        }
        start.disabled = false; start.textContent = "Cerca di nuovo";
      });
      out.append(...card(`Wi-Fi ${NAMES[band] || band}`,
        rows([["Rete", radio.ssid], ["Canale in uso", radio.channel], ["Larghezza", radio.width ? radio.width + " MHz" : null]]),
        start, result));
    });
  };

  PAGES.processes = async (c, out) => {
    const reply = await c.rpc("luci", "getProcessList");
    const number = (v) => Number(String(v || "0").replace("%", "")) || 0;
    const all = ((reply && reply.result) || []).sort((a, b) =>
      number(b["%CPU"]) - number(a["%CPU"]) || number(b["%MEM"]) - number(a["%MEM"]));
    out.append(...card(`${all.length} processi, i più impegnati in alto`, all.map((p) => {
      const command = String(p.COMMAND || "");
      return item(command.replace(/^\[|\]$/g, "").split(" ")[0].split("/").pop() || command,
        `${p.PID} · ${p.USER} · ${command}`.slice(0, 90), `${p["%CPU"]} cpu · ${p["%MEM"]} mem`);
    })));
  };

  PAGES.routes = async (c, out) => {
    const reply = await exec(c, "/sbin/ip", ["-4", "route", "show", "table", "all"]);
    const routes = reply.text.split("\n").map((l) => l.trim())
      .filter((l) => l && !/^(local|broadcast|multicast|unreachable|anycast)\s/.test(l));
    const word = (line, key) => { const m = new RegExp(`\\b${key} (\\S+)`).exec(line); return m ? m[1] : ""; };
    out.append(...card("Percorsi IPv4", routes.length ? routes.map((line) => {
      const target = line.split(" ")[0];
      return item(target === "default" ? "Tutto il resto (internet)" : target,
        [word(line, "via") && "passa da " + word(line, "via"), word(line, "src") && "da " + word(line, "src"), word(line, "metric") && "metrica " + word(line, "metric")].filter(Boolean).join(" · ") || "rete collegata direttamente",
        word(line, "dev"));
    }) : empty("Nessun percorso.")));
  };

  PAGES.system = async (c, out) => {
    const [values, board, info] = await Promise.all([uci(c, "system"), c.rpc("system", "board"), c.rpc("system", "info")]);
    const system = sections(values, "system")[0] || {};
    const ntp = sections(values, "timeserver")[0] || {};
    out.append(...card("Generale",
      rows([["Nome del router", system.hostname || board.hostname], ["Fuso orario", system.zonename || system.timezone || "UTC"],
        ["Ora del router", info.localtime ? new Date(info.localtime * 1000).toISOString().slice(0, 16).replace("T", " ") : null]]),
      button("Cambia nome", async () => {
        const answer = await ask({
          title: "Nome del router", ok: "Salva",
          fields: [{ key: "name", label: "Nome", value: system.hostname || board.hostname || "" }],
          check: (v) => (/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(v.name) ? "" : "Solo lettere, numeri e trattini, senza spazi."),
        });
        if (!answer || !system.id) return;
        change(async () => {
          await c.rpc("uci", "set", { config: "system", section: system.id, values: { hostname: answer.name } });
          await c.rpc("uci", "commit", { config: "system" });
          await c.rpc("rc", "init", { name: "system", action: "reload" });
        }, "Nome cambiato");
      }, "ghost"),
      button("Cambia fuso orario", async () => {
        let zones;
        try { zones = (await c.rpc("luci", "getTimezones")) || {}; } catch (error) { toast(explain(error)); return; }
        const answer = await ask({
          title: "Fuso orario", ok: "Salva",
          fields: [{ key: "zone", label: "Zona", value: system.zonename || "UTC",
            options: Object.keys(zones).sort().map((zone) => [zone, zone.replace(/_/g, " ")]) }],
        });
        if (!answer || !system.id || !zones[answer.zone]) return;
        change(async () => {
          await c.rpc("uci", "set", { config: "system", section: system.id,
            values: { zonename: answer.zone, timezone: zones[answer.zone].tzstring } });
          await c.rpc("uci", "commit", { config: "system" });
          await c.rpc("rc", "init", { name: "system", action: "reload" });
        }, "Fuso orario cambiato");
      }, "ghost")));
    out.append(...card("Orologio di rete (NTP)",
      rows([["Sincronizzazione", ntp.enabled === "0" ? "spenta" : "accesa"]]),
      list(ntp.server).map((server) => item(server))));
    out.append(note("L'aggiornamento del firmware resta nell'interfaccia web del router (in fondo al menu)."));
  };

  PAGES.software = async (c, out) => {
    const reply = (await c.rpc("file", "read", { path: "/etc/apk/world" })) || {};
    const installed = String(reply.data || "").split("\n").map((l) => l.trim()).filter(Boolean)
      .map((line) => /^([^=<>~]+)/.exec(line)[1]).sort((a, b) => a.localeCompare(b));
    const has = new Set(installed);
    const MANAGER = "/usr/libexec/package-manager-call";
    const search = h("input", { type: "search", placeholder: "Nome del pacchetto, per esempio nlbwmon", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
    const found = h("div");
    const mine = h("div");
    const count = h("h3", { class: "sec" });
    const output = h("pre", { class: "out" });
    const outputCard = h("div", { class: "pcard" }, output);
    outputCard.hidden = true;
    let working = false;

    /** Run the package manager and show what it said. */
    const manage = async (label, params) => {
      if (working) return false;
      working = true;
      outputCard.hidden = false;
      output.textContent = label + "… può volerci un minuto.";
      outputCard.scrollIntoView({ block: "nearest" });
      let ok = false;
      try {
        const raw = await exec(c, MANAGER, params);
        let result = {};
        try { result = JSON.parse(raw.text); } catch (error) { result = { code: raw.code, stdout: raw.text, stderr: raw.error }; }
        ok = !result.code;
        output.textContent = (ok ? "Riuscito.\n" : "Non riuscito.\n") + [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      } catch (error) { output.textContent = explain(error); }
      working = false;
      return ok;
    };
    const paintMine = () => {
      const needle = search.value.trim().toLowerCase();
      const shown = needle ? installed.filter((name) => name.toLowerCase().includes(needle)) : installed;
      count.textContent = `Installati (${shown.length} di ${installed.length})`;
      mine.textContent = "";
      shown.forEach((name) => mine.append(item(name, null, "›", async () => {
        const sure = await ask({ title: "Rimuovere " + name + "?", ok: "Rimuovi", danger: true,
          text: "Togliere un pacchetto di base può lasciare il router senza rete o senza interfaccia. Rimuovi solo quello che hai installato tu." });
        if (!sure) return;
        if (await manage("Rimuovo " + name, ["remove", name])) {
          installed.splice(installed.indexOf(name), 1); has.delete(name); paintMine();
        }
      })));
      if (!shown.length) mine.append(empty("Nessun pacchetto installato con questo nome."));
    };
    const lookUp = async () => {
      const term = search.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9+._-]{0,80}$/.test(term)) { toast("Scrivi il nome, o una parte, senza spazi."); return; }
      found.textContent = "";
      found.append(h("div", { class: "wait small" }, h("i"), "Cerco nel catalogo…"));
      try {
        let lines = (await exec(c, "/usr/bin/apk", ["search", term])).text.split("\n").filter((l) => l.trim());
        if (!lines.length && await manage("Aggiorno il catalogo", ["update"])) {
          lines = (await exec(c, "/usr/bin/apk", ["search", term])).text.split("\n").filter((l) => l.trim());
        }
        const packages = lines.map((line) => { const m = /^(.+?)-(\d[^-]*(?:-r\d+)?)$/.exec(line.trim()); return m ? [m[1], m[2]] : [line.trim(), ""]; })
          .filter(([name]) => !/^luci-i18n-/.test(name) || /-it$/.test(name)).slice(0, 80);
        found.textContent = "";
        packages.forEach(([name, version]) => found.append(item(name, version, has.has(name) ? "installato" : "Installa", has.has(name) ? null : async () => {
          const sure = await ask({ title: "Installare " + name + "?", text: "Versione " + version + ". Vengono installati anche i pacchetti da cui dipende.", ok: "Installa" });
          if (!sure) return;
          if (await manage("Installo " + name, ["install", name])) {
            installed.push(name); installed.sort((a, b) => a.localeCompare(b)); has.add(name); paintMine(); lookUp();
          }
        })));
        if (!packages.length) found.append(empty("Nessun pacchetto con questo nome nel catalogo."));
      } catch (error) {
        found.textContent = "";
        found.append(h("p", { class: "bad" }, explain(error)));
      }
    };
    search.addEventListener("input", paintMine);
    search.addEventListener("keydown", (event) => { if (event.key === "Enter") lookUp(); });
    paintMine();
    out.append(...card("Cerca e installa", search,
      h("div", { class: "duo2" }, button("Cerca nel catalogo", lookUp), button("Aggiorna catalogo", () => manage("Aggiorno il catalogo", ["update"]), "ghost")),
      found));
    out.append(outputCard, count, h("div", { class: "pcard" }, mine),
      note("Mentre scrivi, l'elenco qui sopra mostra i pacchetti già installati con quel nome. Tocca un pacchetto installato per rimuoverlo."));
  };

  PAGES.startup = async (c, out) => {
    const services = Object.entries((await c.rpc("rc", "list")) || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const VITAL = ["network", "uhttpd", "rpcd", "dropbear", "firewall", "dnsmasq", "wpad", "boot", "done", "system"];
    out.append(note("Tocca un servizio per avviarlo, fermarlo o scegliere se parte all'accensione."));
    out.append(...card(`${services.length} servizi`, services.map(([name, s]) => item(name,
      [s.enabled ? "parte all'accensione" : "non parte all'accensione", "running" in s ? (s.running ? "in funzione" : "fermo") : null].filter(Boolean).join(" · "),
      "running" in s ? dot(s.running) : "", async () => {
        const answer = await ask({
          title: name,
          text: VITAL.includes(name) ? "Attenzione: fermare questo servizio può far perdere il collegamento al router." : "",
          choices: [["restart", "Riavvia il servizio"], ["start", "Avvia"], ["stop", "Ferma", "danger"],
            s.enabled ? ["disable", "Non farlo partire all'accensione", "danger"] : ["enable", "Fallo partire all'accensione"]],
        });
        if (answer) change(() => c.rpc("rc", "init", { name, action: answer }), "Fatto: " + name);
      }))));
  };

  PAGES.cron = async (c, out) => {
    let text = "";
    try { text = ((await c.rpc("file", "read", { path: "/etc/crontabs/root" })) || {}).data || ""; } catch (error) {
      if (!/\[4\]|Not found|: 4$/i.test(String(error.message))) throw error;
    }
    const area = h("textarea", { class: "code", spellcheck: "false", autocapitalize: "off", placeholder: "# minuto ora giorno mese giorno-settimana comando\n0 4 * * 1 /sbin/reboot" });
    area.value = text;
    out.append(...card("Comandi a orario",
      area,
      button("Salva", () => change(async () => {
        const data = area.value.replace(/\r/g, "").replace(/\s*$/, "") + "\n";
        await c.rpc("file", "write", { path: "/etc/crontabs/root", data: data === "\n" ? "" : data });
        await c.rpc("rc", "init", { name: "cron", action: "enable" });
        await c.rpc("rc", "init", { name: "cron", action: "restart" });
      }, "Salvato"))));
    out.append(note("Una riga per comando: minuto, ora, giorno del mese, mese, giorno della settimana, poi il comando. Esempio: «0 4 * * 1 /sbin/reboot» riavvia ogni lunedì alle 4."));
  };

  PAGES.reboot = async (c, out) => {
    out.append(...card("Riavvia " + c.node.name,
      note("Il router si spegne e riparte: per un paio di minuti i dispositivi collegati a questo nodo restano senza rete."),
      button("Riavvia adesso", async () => {
        const sure = await ask({ title: "Riavviare " + c.node.name + "?", text: "La rete di questo nodo cade per circa due minuti.", ok: "Riavvia", danger: true });
        if (!sure) return;
        try {
          await c.action({ type: "openwrt_router/action", action: "reboot", node: c.node.id });
          toast("Riavvio in corso…");
          close();
        } catch (error) { toast(explain(error)); }
      }, "danger")));
  };

  PAGES.password = async (c, out) => {
    if (!c.direct) {
      out.append(...card("Password del router", note("Con il collegamento tramite Home Assistant la password del router non si cambia da qui, perché l'integrazione perderebbe l'accesso. Dal menu scegli «Cambia collegamento», entra con «Solo router», cambiala lì, e poi aggiorna l'accesso dell'integrazione in Home Assistant.")));
      return;
    }
    const nodes = c.nodes.filter((n) => !n.is_main).concat(c.nodes.filter((n) => n.is_main));
    out.append(...card("Password del router",
      rows([["Utente", c.user], ["Nodi", nodes.map((n) => n.name).join(", ")]]),
      button("Cambia password", async () => {
        const v = await ask({
          title: "Nuova password del router", ok: "Cambia", danger: true,
          text: "Vale per l'app, per l'interfaccia web e per SSH. Viene cambiata su tutti i nodi, perché l'app usa la stessa per tutti.",
          fields: [{ key: "first", label: "Nuova password", secret: true }, { key: "again", label: "Ripetila", secret: true }],
          check: (x) => (x.first.length < 8 ? "Almeno 8 caratteri." : x.first !== x.again ? "Le due password non sono uguali." : ""),
        });
        if (!v) return;
        const done = [];
        try {
          for (const node of nodes) {
            const reply = await c.rpcOn(node, "luci", "setPassword", { username: c.user, password: v.first });
            if (!reply || reply.result !== true) throw new Error("rifiutata da " + node.name);
            done.push(node.name);
          }
          c.passwordChanged(v.first);
          toast("Password cambiata su " + done.join(", "));
        } catch (error) {
          toast(done.length ? `Cambiata solo su ${done.join(", ")}: ${explain(error)}` : explain(error));
        }
      }, "danger")));
    out.append(note("L'app ricorda da sola la nuova password. Se usi anche Home Assistant, dopo il cambio aggiorna l'accesso dell'integrazione OpenWrt Router."));
  };

  PAGES.wifi = async (c, out) => {
    const radios = Object.entries(c.node.radios || {});
    const NAMES = { "2g": "2,4 GHz", "5g": "5 GHz", "6g": "6 GHz" };
    if (!radios.length) { out.append(...card(null, empty("Questo nodo non ha radio Wi-Fi."))); return; }
    const WARNING = "Tutti i dispositivi di questa rete si scollegano e vanno collegati di nuovo: telefoni, telecamere, prese, lampadine. Se questo telefono è su questa rete, perde il collegamento anche lui.";
    const send = async (band, radio, setting, value, done) => {
      $("pRefresh").classList.add("spin");
      toast("Applico su tutti i nodi, ci vuole circa mezzo minuto…");
      try {
        await c.action({ type: "openwrt_router/action", action: "radio", node: null, band, setting, value });
        if (setting === "ssid") radio.ssid = value;
        toast(done);
      } catch (error) { toast(explain(error)); }
      if (current === "wifi") load();
    };
    radios.forEach(([band, radio]) => {
      out.append(...card(`Wi-Fi ${NAMES[band] || band}`,
        rows([["Nome della rete", radio.ssid], ["Stato", radio.enabled ? "accesa" : "spenta"]]),
        button("Cambia nome", async () => {
          const v = await ask({ title: "Nome della rete " + (NAMES[band] || band), ok: "Cambia", danger: true, text: WARNING,
            fields: [{ key: "name", label: "Nuovo nome", value: radio.ssid || "" }],
            check: (x) => (!x.name || new TextEncoder().encode(x.name).length > 32 ? "Da 1 a 32 caratteri." : "") });
          if (v && v.name !== radio.ssid) send(band, radio, "ssid", v.name, "Nome cambiato");
        }, "ghost"),
        button("Cambia password", async () => {
          const v = await ask({ title: "Password di " + (radio.ssid || "questa rete"), ok: "Cambia", danger: true, text: WARNING,
            fields: [{ key: "first", label: "Nuova password", secret: true }, { key: "again", label: "Ripetila", secret: true }],
            check: (x) => (x.first.length < 8 || x.first.length > 63 ? "Da 8 a 63 caratteri." : x.first !== x.again ? "Le due password non sono uguali." : "") });
          if (v) send(band, radio, "key", v.first, "Password cambiata");
        }, "ghost")));
    });
    out.append(note("Nome e password valgono per tutti i nodi. Canale, potenza e le altre impostazioni sono nella pagina principale «Wi-Fi e dispositivi»."));
  };

  PAGES.backup = async (c, out) => {
    const board = await c.rpc("system", "board");
    const result = h("div");
    const start = button("Scarica il backup sul telefono", async () => {
      start.disabled = true; start.textContent = "Scarico…";
      try {
        const data = await c.backup();
        const name = `backup-${String(board.hostname || "router").replace(/[^A-Za-z0-9-]/g, "")}-${new Date().toISOString().slice(0, 10)}.tar.gz`;
        const where = c.save(name, data);
        result.textContent = "";
        if (where) {
          result.append(rows([["Salvato in", where], ["Dimensione", bytes(Math.round(data.length * 0.75))]]));
          toast("Backup salvato");
        } else result.append(h("p", { class: "bad" }, "Il telefono non ha permesso di salvare il file."));
      } catch (error) {
        result.textContent = "";
        result.append(h("p", { class: "bad" }, explain(error)));
      }
      start.disabled = false; start.textContent = "Scarica il backup sul telefono";
    });
    out.append(...card("Backup di " + c.node.name,
      note("Un file con tutte le impostazioni di questo nodo: reti Wi-Fi, IP fissi, porte aperte, DNS, mesh. Non contiene il firmware né i pacchetti installati."),
      start, result));
    out.append(note("Ogni nodo ha il suo backup: scegli il nodo dal menu e scaricalo per ciascuno. Il file contiene anche le password del Wi-Fi: tienilo al sicuro."),
      note("Per rimettere un backup sul router si usa per ora l'interfaccia web (Sistema → Backup → Ripristina)."));
  };

  PAGES.interfaces = async (c, out) => {
    const dump = await c.rpc("network.interface", "dump");
    const all = ((dump && dump.interface) || []).filter((i) => i.interface !== "loopback");
    const stats = await Promise.all(all.map((i) => (i.l3_device || i.device)
      ? c.rpc("network.device", "status", { name: i.l3_device || i.device }).catch(() => null) : null));
    all.forEach((i, index) => {
      const v4 = (i["ipv4-address"] || []).map((a) => `${a.address}/${a.mask}`);
      const v6 = (i["ipv6-address"] || []).concat(...(i["ipv6-prefix-assignment"] || []).map((p) => p["local-address"] ? [p["local-address"]] : []))
        .map((a) => a.address).filter(Boolean);
      const gateway = ((i.route || []).find((r) => r.target === "0.0.0.0") || {}).nexthop;
      const device = stats[index] || {};
      const s = device.statistics || {};
      out.append(...card(i.interface.toUpperCase(), rows([
        ["Stato", h("span", null, dot(i.up), i.up ? ` attiva da ${span(i.uptime)}` : " non attiva")],
        ["Tipo", { dhcp: "automatico (DHCP)", static: "indirizzo fisso", pppoe: "PPPoE", none: "senza indirizzo" }[i.proto] || i.proto],
        ["Porta", i.l3_device || i.device], ["Indirizzo", v4.join(", ")], ["IPv6", v6.slice(0, 2).join(", ")],
        ["Gateway", gateway], ["DNS", (i["dns-server"] || []).join(", ")],
        ["Indirizzo fisico", device.macaddr ? String(device.macaddr).toUpperCase() : null],
        ["Ricevuti", s.rx_bytes != null ? bytes(s.rx_bytes) : null], ["Inviati", s.tx_bytes != null ? bytes(s.tx_bytes) : null],
        ["Errori", s.rx_errors != null ? String((s.rx_errors || 0) + (s.tx_errors || 0)) : null],
      ])));
    });
    if (!all.length) out.append(...card(null, empty("Nessuna interfaccia.")));
  };

  PAGES.dhcp = async (c, out) => {
    const [values, leaseReply, dump] = await Promise.all([uci(c, "dhcp"), c.rpc("luci-rpc", "getDHCPLeases"),
      c.rpc("network.interface", "dump").catch(() => null)]);
    const upstream = [...new Set(((dump && dump.interface) || []).filter((i) => i.interface !== "loopback").flatMap((i) => i["dns-server"] || []))];
    const hosts = sections(values, "host");
    const pool = sections(values, "dhcp").find((s) => s.interface === "lan") || {};
    const dnsmasq = sections(values, "dnsmasq")[0] || {};
    const leases = ((leaseReply && leaseReply.dhcp_leases) || []).sort((a, b) =>
      a.ipaddr.split(".").map((p) => p.padStart(3, "0")).join("").localeCompare(b.ipaddr.split(".").map((p) => p.padStart(3, "0")).join("")));
    const macOf = (host) => list(host.mac).map((m) => m.toUpperCase()).join(", ");
    const fixed = new Set(hosts.flatMap((host) => list(host.mac).map((m) => m.toUpperCase())));
    const apply = async () => {
      await c.rpc("uci", "commit", { config: "dhcp" });
      await c.rpc("rc", "init", { name: "dnsmasq", action: "restart" });
    };
    const form = (title, start) => ask({
      title, ok: "Salva",
      fields: [
        { key: "name", label: "Nome", value: start.name || "", placeholder: "per esempio telecamera-garage" },
        { key: "mac", label: "Indirizzo fisico (MAC)", value: start.mac || "", placeholder: "AA:BB:CC:DD:EE:FF" },
        { key: "ip", label: "Indirizzo IP", value: start.ip || "", placeholder: "192.168.1.50", mode: "decimal" },
      ],
      check: (v) => (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(v.name) ? "Nome: solo lettere, numeri e trattini, senza spazi."
        : !isMac(v.mac) ? "Il MAC ha la forma AA:BB:CC:DD:EE:FF." : !isIp(v.ip) ? "L'indirizzo IP non è valido."
        : hosts.some((host) => host.ip === v.ip && host.id !== start.id) ? "Questo IP è già dato a un altro dispositivo." : ""),
    });
    const save = async (start) => {
      const v = await form(start.id ? "Modifica IP fisso" : "Nuovo IP fisso", start);
      if (!v) return;
      const fields = { name: v.name, mac: [v.mac.toUpperCase()], ip: v.ip };
      change(async () => {
        if (start.id) await c.rpc("uci", "set", { config: "dhcp", section: start.id, values: fields });
        else await c.rpc("uci", "add", { config: "dhcp", type: "host", values: fields });
        await apply();
      }, "IP fisso salvato");
    };

    const options = list(pool.dhcp_option);
    const given = options.filter((o) => /^6,/.test(o)).map((o) => o.slice(2).split(",").join(", "));
    out.append(...card("Rete locale", rows([
      ["Indirizzi automatici", pool.start ? `${pool.limit || 150} a partire dal numero ${pool.start}` : null],
      ["Durata", pool.leasetime],
      ["DNS dato ai dispositivi", given.join(", ") || "il router stesso"],
      ["DNS usati dal router", list(dnsmasq.server).concat(upstream).join(", ") || "quelli del collegamento internet"],
      ["Dominio locale", dnsmasq.domain],
    ]), pool.id ? button("Modifica", async () => {
      const v = await ask({
        title: "Indirizzi automatici", ok: "Salva",
        fields: [
          { key: "start", label: "Primo numero (ultima parte dell'indirizzo)", value: pool.start || "100", mode: "numeric" },
          { key: "limit", label: "Quanti indirizzi", value: pool.limit || "150", mode: "numeric" },
          { key: "lease", label: "Durata (per esempio 2h, 12h, 30m)", value: pool.leasetime || "12h" },
          { key: "dns", label: "DNS dato ai dispositivi (vuoto = il router)", value: options.filter((o) => /^6,/.test(o)).map((o) => o.slice(2)).join(","), placeholder: "192.168.1.5, 1.1.1.1" },
        ],
        check: (x) => (!/^\d+$/.test(x.start) || Number(x.start) < 2 || Number(x.start) > 253 ? "Il primo numero va da 2 a 253."
          : !/^\d+$/.test(x.limit) || Number(x.limit) < 1 || Number(x.start) + Number(x.limit) > 255 ? "Troppi indirizzi: primo numero più quantità non può superare 254."
          : !/^\d+[smhdw]$/.test(x.lease) ? "La durata è un numero seguito da m, h o d (per esempio 12h)."
          : x.dns.split(/[\s,]+/).filter(Boolean).some((ip) => !isIp(ip)) ? "I DNS sono indirizzi IP separati da virgola." : ""),
      });
      if (!v) return;
      const dns = v.dns.split(/[\s,]+/).filter(Boolean);
      const next = options.filter((o) => !/^6,/.test(o)).concat(dns.length ? ["6," + dns.join(",")] : []);
      change(async () => {
        const values = { start: v.start, limit: v.limit, leasetime: v.lease };
        if (next.length) values.dhcp_option = next;
        else await c.rpc("uci", "delete", { config: "dhcp", section: pool.id, options: ["dhcp_option"] }).catch(() => null);
        await c.rpc("uci", "set", { config: "dhcp", section: pool.id, values });
        await apply();
      }, "Salvato");
    }, "ghost") : null));
    out.append(...card(`IP fissi (${hosts.length})`,
      hosts.length ? hosts.map((host) => item(host.name || host.ip, `${host.ip || "—"} · ${macOf(host)}`, null, async () => {
        const answer = await ask({ title: host.name || host.ip, text: `${host.ip} · ${macOf(host)}`,
          choices: [["edit", "Modifica"], ["delete", "Elimina", "danger"]] });
        if (answer === "edit") save({ id: host.id, name: host.name, mac: list(host.mac)[0] || "", ip: host.ip });
        if (answer === "delete") {
          change(async () => {
            await c.rpc("uci", "delete", { config: "dhcp", section: host.id });
            await apply();
          }, "IP fisso eliminato");
        }
      })) : empty("Nessun IP fisso."),
      button("Aggiungi un IP fisso", () => save({}), "ghost")));
    out.append(...card(`Indirizzi dati ora (${leases.length})`, leases.length ? leases.map((lease) => {
      const mac = String(lease.macaddr || "").toUpperCase();
      const isFixed = fixed.has(mac);
      return item(lease.hostname || mac, `${lease.ipaddr} · ${mac}`,
        isFixed ? "fisso" : lease.expires > 0 ? span(lease.expires) : "", isFixed ? null : () =>
          save({ name: String(lease.hostname || "").replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+/, ""), mac, ip: lease.ipaddr }));
    }) : empty("Nessun indirizzo dato.")));
    out.append(note("Tocca un dispositivo dell'elenco per dargli sempre lo stesso indirizzo."));
  };

  PAGES.firewall = async (c, out) => {
    const values = await uci(c, "firewall");
    const forwards = sections(values, "redirect");
    const rules = sections(values, "rule");
    const blocked = rules.filter((r) => r.id.startsWith("habrk_"));
    const others = rules.filter((r) => !r.id.startsWith("habrk_"));
    const zones = sections(values, "zone");
    const apply = async () => {
      await c.rpc("uci", "commit", { config: "firewall" });
      await c.rpc("rc", "init", { name: "firewall", action: "reload" });
    };
    const proto = (value) => list(value).join("+").toUpperCase() || "TCP+UDP";

    out.append(...card(`Inoltri di porta (${forwards.length})`,
      forwards.length ? forwards.map((f) => {
        const on = f.enabled !== "0";
        return item(f.name || "senza nome",
          `${f.src === "wan" ? "da internet" : "dalla rete di casa"} · ${proto(f.proto)} ${f.src_dport || "tutte"} → ${f.dest_ip || "router"}${f.dest_port ? ":" + f.dest_port : ""}`,
          [dot(on), on ? "attiva" : "spenta"], async () => {
            const answer = await ask({ title: f.name || "Porta", choices: [
              on ? ["off", "Disattiva"] : ["on", "Attiva"], ["delete", "Elimina", "danger"]] });
            if (!answer) return;
            change(async () => {
              if (answer === "delete") await c.rpc("uci", "delete", { config: "firewall", section: f.id });
              else await c.rpc("uci", "set", { config: "firewall", section: f.id, values: { enabled: answer === "on" ? "1" : "0" } });
              await apply();
            }, answer === "delete" ? "Porta eliminata" : "Fatto");
          });
      }) : empty("Nessuna porta aperta."),
      button("Apri una porta", async () => {
        const v = await ask({
          title: "Apri una porta", ok: "Apri",
          text: "Chi arriva da internet su questa porta viene mandato a un dispositivo di casa.",
          fields: [
            { key: "name", label: "Nome", placeholder: "per esempio Telecamera" },
            { key: "proto", label: "Protocollo", value: "tcp udp", options: [["tcp udp", "TCP e UDP"], ["tcp", "Solo TCP"], ["udp", "Solo UDP"]] },
            { key: "outside", label: "Porta da fuori", placeholder: "8080", mode: "numeric" },
            { key: "ip", label: "IP del dispositivo di casa", placeholder: "192.168.1.50", mode: "decimal" },
            { key: "inside", label: "Porta sul dispositivo", placeholder: "uguale a quella da fuori", mode: "numeric" },
          ],
          check: (x) => (!x.name ? "Dai un nome a questa porta." : !isPort(x.outside) ? "La porta da fuori è un numero da 1 a 65535."
            : !isIp(x.ip) ? "L'IP del dispositivo non è valido." : x.inside && !isPort(x.inside) ? "La porta sul dispositivo non è valida." : ""),
        });
        if (!v) return;
        change(async () => {
          await c.rpc("uci", "add", { config: "firewall", type: "redirect", values: {
            name: v.name.slice(0, 60), src: "wan", dest: "lan", target: "DNAT", proto: v.proto.split(" "),
            src_dport: v.outside, dest_ip: v.ip, dest_port: v.inside || v.outside } });
          await apply();
        }, "Porta aperta");
      }, "ghost")));

    out.append(...card(`Dispositivi senza internet (${blocked.length})`,
      blocked.length ? blocked.map((r) => item(String(r.name || "").replace(/^Block internet /, "") || r.src_mac, r.src_mac, "bloccato", async () => {
        const sure = await ask({ title: "Ridare internet?", text: String(r.src_mac || ""), ok: "Sblocca" });
        if (!sure) return;
        change(() => c.action({ type: "openwrt_router/action", action: "block", mac: String(r.src_mac), value: false }), "Sbloccato");
      })) : empty("Nessun dispositivo bloccato.")));

    const POLICY = { ACCEPT: "accetta", REJECT: "rifiuta", DROP: "scarta" };
    out.append(...card("Zone", zones.map((z) => item(String(z.name || "").toUpperCase(),
      `in entrata ${POLICY[z.input] || z.input || "—"} · in uscita ${POLICY[z.output] || z.output || "—"} · di passaggio ${POLICY[z.forward] || z.forward || "—"}`,
      z.masq === "1" ? "NAT" : ""))));
    out.append(...card(`Regole (${others.length})`, others.length ? others.map((r) => item(r.name || "senza nome",
      `${proto(r.proto)} · ${r.src || "router"} → ${r.dest || "router"}${r.dest_port ? " porta " + list(r.dest_port).join(", ") : ""}`,
      [dot(r.enabled !== "0"), POLICY[r.target] || String(r.target || "").toLowerCase()])) : empty("Nessuna regola.")));
  };

  PAGES.diag = async (c, out) => {
    const host = h("input", { type: "text", inputmode: "url", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "nome o indirizzo" });
    host.value = "openwrt.org";
    const output = h("pre", { class: "out" }, "Scegli una prova.");
    const tests = [
      ["Ping", "/bin/ping", (target) => ["-c", "4", "-W", "2", target]],
      ["Percorso", "/bin/traceroute", (target) => ["-m", "12", "-q", "1", "-w", "1", "-n", target]],
      ["DNS", "/usr/bin/nslookup", (target) => [target]],
    ];
    const buttons = tests.map(([label, command, params]) => button(label, async () => {
      const target = host.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$/.test(target)) { toast("Scrivi un nome o un indirizzo, senza spazi."); return; }
      buttons.forEach((b) => { b.disabled = true; });
      output.textContent = `${label} verso ${target}…`;
      try {
        const reply = await exec(c, command, params(target));
        output.textContent = (reply.text + (reply.error ? "\n" + reply.error : "")).trim() || "Nessuna risposta.";
      } catch (error) { output.textContent = explain(error); }
      buttons.forEach((b) => { b.disabled = false; });
    }, "ghost"));
    out.append(...card("Prova dal router", h("label", null, "Destinazione"), host, h("div", { class: "trio" }, buttons)));
    out.append(...card("Risultato", output));
    out.append(note("Le prove partono dal router, non dal telefono: dicono se è la rete di casa a raggiungere la destinazione."));
  };

  PAGES.usteer = async (c, out) => {
    const [local, remote, clients] = await Promise.all([
      c.rpc("usteer", "local_info"), c.rpc("usteer", "remote_info"), c.rpc("usteer", "get_clients").catch(() => ({})),
    ]);
    const channel = (freq) => (freq >= 5955 ? (freq - 5950) / 5 : freq >= 5000 ? (freq - 5000) / 5 : freq === 2484 ? 14 : (freq - 2407) / 5);
    const draw = (title, data) => {
      const entries = Object.entries(data || {});
      if (!entries.length) return;
      out.append(...card(title, entries.map(([name, radio]) => item(
        name.replace(/^.*#/, "").replace(/^hostapd\./, ""),
        `canale ${channel(radio.freq)} · ${radio.freq >= 5000 ? "5 GHz" : "2,4 GHz"} · rumore ${radio.noise} dBm · occupazione ${radio.load}`,
        `${radio.n_assoc} disp.`))));
    };
    draw("Questo nodo", local);
    const byHost = {};
    Object.entries(remote || {}).forEach(([key, radio]) => {
      const address = key.split("#")[0];
      (byHost[address] = byHost[address] || {})[key] = radio;
    });
    Object.entries(byHost).forEach(([address, data]) => draw("Nodo " + address, data));
    out.append(...card("Dispositivi", rows([["Seguiti da usteer", String(Object.keys(clients || {}).length)]])));
    out.append(note("Usteer sposta i dispositivi verso il nodo che sentono meglio. Qui si vede quanto è carica ogni radio."));
  };

  $("pBack").addEventListener("click", close);
  $("pRefresh").addEventListener("click", () => { if (current) load(); });
  $("askNo").addEventListener("click", () => closeAsk(null));
  $("ask").addEventListener("click", (event) => { if (event.target.id === "ask") closeAsk(null); });

  window.RouterPages = { groups: GROUPS, open, close, back, toast };
})();
