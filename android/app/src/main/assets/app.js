/* Wi-Fi di casa — the glue between the bundled page and the network.
 *
 * The page (openwrt-router-panel.js) is the one Home Assistant shows in its
 * sidebar. There it is handed a `hass` object; here we build a stand-in with
 * the same `callWS`, backed by one of two things:
 *
 *  - Home Assistant, over its WebSocket API. Signing in happens on Home
 *    Assistant's own login page (the Android side opens it and keeps the
 *    result); this script only ever asks for a short-lived access token.
 *  - The router itself (direct.js), for a house without Home Assistant.
 */
(function () {
  "use strict";

  const native = window.Android;
  const $ = (id) => document.getElementById(id);
  const TIMEOUT = 6000;

  let config = {};
  let mode = "ha";
  let socket = null;
  let ready = false;
  let router = null;
  let nextId = 1;
  let pending = new Map();
  let waiters = new Map();
  let nextWaiter = 1;
  let panel = null;
  let retryTimer = null;
  let retryDelay = 1500;
  let connectedUrl = "";
  let version = "";
  let paused = false;
  let remoteNote = "";
  let mfaFlow = "";
  let remember = true;

  // Whether the outside address is looked up from Home Assistant (Nabu Casa)
  // or typed by hand. Kept with the page, it holds nothing secret.
  const auto = {
    get on() { try { return localStorage.getItem("autoRemote") !== "0"; } catch (e) { return true; } },
    set on(value) { try { localStorage.setItem("autoRemote", value ? "1" : "0"); } catch (e) {} },
  };

  const clean = (url) => {
    url = (url || "").trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\//i.test(url)) url = "http://" + url;
    return url;
  };

  function readConfig() {
    try { config = JSON.parse(native.getConfig()) || {}; } catch (error) { config = {}; }
    mode = config.mode === "router" ? "router" : "ha";
    remember = config.remember !== false;
    return mode === "router"
      ? Boolean(config.routerSaved && config.routerHost)
      : Boolean(config.signedIn && (config.home || config.remote));
  }

  // ---- answers coming back from the Android side

  function ask(start, patience) {
    return new Promise((resolve) => {
      const id = nextWaiter++;
      waiters.set(id, resolve);
      start(id);
      setTimeout(() => { if (waiters.delete(id)) resolve(null); }, patience);
    });
  }
  function answer(id, value) {
    const resolve = waiters.get(id);
    if (resolve) { waiters.delete(id); resolve(value); }
  }
  window.appToken = (id, value) => answer(id, value);
  window.appSignIn = (id, value) => answer(id, value);
  window.appHttp = (id, status, text) => {
    let json = null;
    try { json = JSON.parse(text); } catch (error) { /* not JSON */ }
    answer(id, { status, json });
  };

  window.appBackup = (id, status, data) => answer(id, { status, data });
  window.appUpload = (id, status, text) => answer(id, { status, text });
  window.appFile = (id, name, data) => answer(id, { name, data });
  const upload = native.upload
    ? (url, session, path, data) => ask((id) => native.upload(id, url, session, path, data), 70000)
    : null;

  /** Let the user choose a file on the phone: {name, data} or null. */
  const pickFile = () => (native.pickFile
    ? ask((id) => native.pickFile(id), 600000).then((file) => (file && file.data ? file : null))
    : Promise.resolve(null));

  /** Put a configuration backup back on a node; the node restarts. */
  function restore(node, data) {
    if (mode === "router") return router.restore(node.id, data);
    return hass.callWS({ type: "openwrt_router/restore", node: node.id, data });
  }

  /** A node's configuration archive, as base64. */
  async function backup(node) {
    if (mode !== "router") {
      return (await hass.callWS({ type: "openwrt_router/backup", node: node.id })).data;
    }
    const base = router.baseOf(node.id);
    await router.call("system", "board", {}, { base, strict: true });
    const reply = await ask((id) => native.backup(id, base + "/cgi-bin/cgi-backup", router.sessions.get(base)), 70000);
    if (!reply || reply.status !== 200 || !reply.data) throw new Error(reply && reply.status ? "il router ha rifiutato il backup" : "unreachable");
    return reply.data;
  }

  const accessToken = (url) => ask((id) => native.requestToken(url, id), 12000)
    .then((value) => value || { error: "unreachable" });
  const haSignIn = (address, user, password, flow, code) =>
    ask((id) => native.haSignIn(id, address, user, password, flow || "", code || ""), 40000)
      .then((value) => value || { error: "unreachable" });
  const http = (url, body) => ask((id) => native.http(id, url, JSON.stringify(body)), 38000)
    .then((value) => value || { status: 0, json: null });

  // ---- Home Assistant

  function open(url, token) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url.replace(/^http/i, "ws") + "/api/websocket");
      const fail = (reason) => { if (!settled) { settled = true; try { ws.close(); } catch (e) {} reject(new Error(reason)); } };
      const timer = setTimeout(() => fail("unreachable"), TIMEOUT);
      ws.onerror = () => fail("unreachable");
      ws.onclose = () => fail("unreachable");
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (message.type === "auth_invalid") {
          clearTimeout(timer);
          fail("auth");
        } else if (message.type === "auth_ok") {
          clearTimeout(timer);
          settled = true;
          version = "Home Assistant " + (message.ha_version || "");
          resolve(ws);
        }
      };
    });
  }

  async function connectHa() {
    const urls = [clean(config.home), clean(config.remote)].filter(Boolean);
    let lastError = "unreachable";
    for (const url of urls) {
      const token = await accessToken(url);
      if (token.error === "auth") throw new Error("auth");
      if (!token.token) continue;
      try {
        adopt(await open(url, token.token), url);
        return;
      } catch (error) {
        lastError = error.message;
        if (lastError === "auth") break;
      }
    }
    throw new Error(lastError);
  }

  function adopt(ws, url) {
    socket = ws;
    ready = true;
    connectedUrl = url;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (!waiting || message.type !== "result") return;
      pending.delete(message.id);
      if (message.success) waiting.resolve(message.result);
      else waiting.reject(new Error((message.error && message.error.message) || "errore"));
    };
    ws.onclose = ws.onerror = () => { if (socket === ws) dropped(); };
  }

  function dropped() {
    ready = false;
    socket = null;
    pending.forEach((waiting) => waiting.reject(new Error("collegamento interrotto")));
    pending.clear();
    if (paused) return;
    banner("Collegamento a casa interrotto, riprovo…");
    later();
  }

  // ---- the router alone

  async function connectRouter() {
    const candidate = new window.DirectRouter(config.routerHost, config.routerUser, native.routerPassword(), http, upload);
    let accepted;
    try {
      accepted = await candidate.authenticate();
    } catch (error) {
      throw new Error("unreachable");
    }
    if (!accepted) throw new Error("auth");
    const board = await candidate.call("system", "board");
    const release = (board && board.release) || {};
    version = [release.distribution, release.version].filter(Boolean).join(" ");
    router = candidate;
    ready = true;
    connectedUrl = candidate.base;
  }

  // ---- common

  const hass = {
    language: (navigator.language || "it").toLowerCase(),
    callWS(message) {
      if (!ready) return Promise.reject(new Error("non collegato"));
      if (mode === "router") {
        return router.handle(message).catch((error) => {
          if (error instanceof window.DirectRouterAuthError) { ready = false; showSetup("Il router non accetta più utente e password."); }
          else if (error.message === "unreachable") { ready = false; if (!paused) { banner("Router non raggiungibile, riprovo…"); later(); } }
          throw error;
        });
      }
      if (!socket) return Promise.reject(new Error("non collegato"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, ...message }));
        setTimeout(() => { if (pending.delete(id)) reject(new Error("nessuna risposta da casa")); }, 90000);
      });
    },
  };

  function later() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retry, retryDelay);
    retryDelay = Math.min(retryDelay * 1.6, 15000);
  }

  async function retry() {
    clearTimeout(retryTimer);
    try {
      await (mode === "router" ? connectRouter() : connectHa());
    } catch (error) {
      if (error.message === "auth") {
        return showSetup(mode === "router"
          ? "Il router ha rifiutato utente o password."
          : "L'accesso a Home Assistant è scaduto. Accedi di nuovo.");
      }
      banner(mode === "router" ? "Router non raggiungibile, riprovo…" : "Casa non raggiungibile, riprovo…");
      return later();
    }
    retryDelay = 1500;
    const problem = mode === "ha" ? await check() : "";
    if (problem) return showSetup(problem);
    banner("");
    showApp();
    if (mode === "ha") findRemote();
  }

  /** Ask Home Assistant for its Nabu Casa address and remember it. */
  async function findRemote() {
    if (!auto.on) { remoteNote = config.remote ? "" : "non impostato"; return; }
    try {
      const cloud = await hass.callWS({ type: "cloud/status" });
      const usable = cloud && cloud.logged_in && cloud.remote_domain
        && cloud.prefs && cloud.prefs.remote_enabled !== false;
      if (!usable) {
        remoteNote = cloud && cloud.logged_in
          ? "Nabu Casa: accesso remoto spento in Home Assistant"
          : "Nabu Casa non è attivo su questo Home Assistant";
        return;
      }
      const found = "https://" + cloud.remote_domain;
      remoteNote = cloud.remote_connected === false ? "Nabu Casa (ora non collegato)" : "Nabu Casa, trovato da solo";
      if (found !== clean(config.remote)) {
        config.remote = found;
        native.saveAddresses(config.home || "", found);
      }
    } catch (error) {
      remoteNote = config.remote ? "Nabu Casa, salvato" : "non ancora trovato";
    }
  }

  /** The integration must be there, and the user must be allowed to use it. */
  async function check() {
    try {
      await hass.callWS({ type: "openwrt_router/snapshot" });
      return "";
    } catch (error) {
      if (/unknown command/i.test(error.message)) {
        return "Su questo Home Assistant non è installata l'integrazione OpenWrt Router. Puoi usare la scheda \"Solo router\".";
      }
      if (/unauthorized|admin/i.test(error.message)) {
        return "Serve un utente amministratore di Home Assistant.";
      }
      return "";
    }
  }

  function banner(text) {
    $("bannerText").textContent = text;
    $("banner").classList.toggle("show", Boolean(text));
  }

  function paint() {
    const viaRouter = mode === "router";
    $("tabHa").classList.toggle("on", !viaRouter);
    $("tabRouter").classList.toggle("on", viaRouter);
    $("paneHa").hidden = viaRouter;
    $("paneRouter").hidden = !viaRouter;
    $("connect").textContent = viaRouter ? "Collega al router" : mfaFlow ? "Conferma il codice" : "Accedi";
    $("remember").classList.toggle("on", remember);
    $("remember").setAttribute("aria-checked", String(remember));
    $("rememberState").textContent = remember
      ? "Alla prossima apertura l'app si collega da sola. La password è salvata cifrata sul telefono."
      : "Spento: alla prossima apertura l'app chiede di nuovo l'accesso.";
    const on = auto.on;
    $("auto").classList.toggle("on", on);
    $("auto").setAttribute("aria-checked", String(on));
    $("remoteManual").hidden = on;
    $("autoState").textContent = on
      ? (config.remote ? "Trovato: " + clean(config.remote) : "Lo cerco appena l'app si collega da casa. Serve Nabu Casa attivo.")
      : "Spento: scrivi tu l'indirizzo qui sotto.";
  }

  function stop() {
    clearTimeout(retryTimer);
    ready = false;
    router = null;
    if (socket) { const ws = socket; socket = null; ws.close(); }
  }

  function showSetup(message) {
    stop();
    window.RouterPages.close();
    closeDrawer();
    $("app").style.display = "none";
    $("setup").classList.add("show");
    $("home").value = config.home || "";
    $("remote").value = config.remote || "";
    $("rHost").value = config.routerHost || "";
    $("rUser").value = config.routerUser || "root";
    $("rPass").value = "";
    $("rPass").placeholder = config.routerSaved ? "Lascia vuoto per tenere quella salvata" : "Password del router";
    $("hPass").value = "";
    $("hPass").placeholder = config.signedIn ? "Lascia vuoto per tenere l'accesso già fatto" : "";
    $("hCode").value = "";
    hidePasswords();
    mfaFlow = "";
    $("mfa").hidden = true;
    paint();
    const error = $("error");
    error.textContent = message || "";
    error.classList.toggle("show", Boolean(message));
    banner("");
  }

  function showApp() {
    $("setup").classList.remove("show");
    $("app").style.display = "";
    if (!panel) {
      panel = document.createElement("openwrt-router-panel");
      panel.narrow = true;
      panel.addEventListener("hass-toggle-menu", openDrawer);
      $("app").appendChild(panel);
    }
    panel.hass = hass;
    if (panel._load) panel._load(true);
  }

  async function submit() {
    const button = $("connect");
    button.disabled = true;
    native.setRemember(remember);
    try {
      if (mode === "router") {
        const host = clean($("rHost").value);
        const user = $("rUser").value.trim() || "root";
        const password = $("rPass").value || native.routerPassword();
        if (!host) return showSetup("Scrivi l'indirizzo del router.");
        if (!password) return showSetup("Scrivi la password del router.");
        button.textContent = "Collego…";
        native.saveRouter(host, user, password);
        readConfig();
        try {
          await connectRouter();
        } catch (error) {
          return showSetup(error.message === "auth"
            ? "Il router ha rifiutato utente o password."
            : "Il router non risponde a questo indirizzo. Sei sul Wi-Fi di casa?");
        }
        return showApp();
      }
      const home = clean($("home").value);
      const remote = auto.on ? clean(config.remote) : clean($("remote").value);
      const user = $("hUser").value.trim();
      const password = $("hPass").value;
      if (!home) return showSetup("Scrivi l'indirizzo di Home Assistant.");
      const keep = config.signedIn && !password && !mfaFlow;
      if (!keep && (!user || !password) && !mfaFlow) return fail("Scrivi utente e password di Home Assistant.");
      button.textContent = "Accedo…";
      native.setMode("ha");
      native.saveAddresses(home, remote);
      config = { ...config, home, remote };
      if (!keep) {
        const result = await haSignIn(home, user, password, mfaFlow, $("hCode").value);
        if (result.mfa) {
          mfaFlow = result.flow;
          $("mfa").hidden = false;
          $("hCode").value = "";
          $("hCode").focus();
          return fail(result.wrong ? "Codice non valido, riprova." : "Scrivi il codice di verifica a due fattori.");
        }
        mfaFlow = "";
        if (result.error === "auth") return fail("Utente o password non corretti.");
        if (result.error === "unsupported") return fail("A questo indirizzo non risponde un Home Assistant.");
        if (!result.ok) return fail("Home Assistant non risponde a questo indirizzo. Fuori casa serve Tailscale acceso, oppure l'indirizzo Nabu Casa.");
      }
      readConfig();
      banner("Mi collego…");
      $("setup").classList.remove("show");
      retry();
    } finally {
      button.disabled = false;
      paint();
    }
  }

  /** Show a message on the sign-in screen without clearing what was typed. */
  function fail(message) {
    const error = $("error");
    error.textContent = message;
    error.classList.add("show");
  }

  // ---- the one menu, on the left: the router's sections and the connection

  /** One ubus call on one node, straight to the router or through Home Assistant. */
  function rpc(node, object, method, args) {
    if (!ready) return Promise.reject(new Error("non collegato"));
    if (mode === "router") {
      return router.call(object, method, args || {}, { base: router.baseOf(node.id), strict: true });
    }
    return hass.callWS({ type: "openwrt_router/ubus", node: node.id, object, method, args: args || {} })
      .then((reply) => reply.result);
  }

  let drawerNodes = [];
  let drawerNode = null;

  function paintDrawer() {
    const nodes = $("dNodes");
    nodes.textContent = "";
    drawerNodes.forEach((node) => {
      const pill = document.createElement("button");
      pill.className = "pill" + (node === drawerNode ? " on" : "");
      pill.textContent = node.name;
      pill.addEventListener("click", () => { drawerNode = node; paintDrawer(); });
      nodes.appendChild(pill);
    });
    if (!drawerNodes.length) nodes.textContent = "Nessun router raggiungibile in questo momento.";
    const links = $("dLinks");
    links.textContent = "";
    window.RouterPages.groups.forEach(([group, pages]) => {
      const title = document.createElement("h3");
      title.textContent = group;
      links.appendChild(title);
      pages.forEach(([key, label]) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.addEventListener("click", () => {
          const node = drawerNode;
          if (!node) return;
          closeDrawer();
          window.RouterPages.open(key, {
            node,
            direct: mode === "router",
            user: config.routerUser || "root",
            nodes: drawerNodes.slice(),
            rpc: (object, method, args) => rpc(node, object, method, args),
            rpcOn: (other, object, method, args) => rpc(other, object, method, args),
            backup: () => backup(node),
            pick: pickFile,
            restore: (data) => restore(node, data),
            save: (name, data) => native.saveFile(name, data),
            passwordChanged: (password) => {
              native.saveRouter(config.routerHost, config.routerUser || "root", password);
              if (router) router.password = password;
            },
            action: (message) => hass.callWS(message).then((reply) => { if (panel && panel._load) panel._load(true); return reply; }),
          });
        });
        links.appendChild(button);
      });
    });
    $("mUrl").textContent = connectedUrl || "—";
    $("mRemote").textContent = mode === "router"
      ? "serve una VPN verso casa"
      : [clean(config.remote), remoteNote].filter(Boolean).join(" · ") || "—";
    $("mVersionLabel").textContent = mode === "router" ? "Router" : "Sistema";
    $("mVersion").textContent = version || "—";
    $("mApp").textContent = native.version();
  }

  function openDrawer() {
    const all = panel && panel.data ? Object.values(panel.data.nodes) : [];
    drawerNodes = all.filter((node) => node.online);
    drawerNode = drawerNodes.find((node) => drawerNode && node.id === drawerNode.id)
      || drawerNodes.find((node) => node.is_main) || drawerNodes[0] || null;
    paintDrawer();
    $("drawer").classList.add("show");
  }

  function closeDrawer() { $("drawer").classList.remove("show"); }

  $("connect").addEventListener("click", submit);
  $("tabHa").addEventListener("click", () => { mode = "ha"; paint(); });
  $("tabRouter").addEventListener("click", () => { mode = "router"; paint(); });
  $("auto").addEventListener("click", () => { auto.on = !auto.on; paint(); });
  $("remember").addEventListener("click", () => { remember = !remember; paint(); });
  document.querySelectorAll(".eye").forEach((eye) => eye.addEventListener("click", () => {
    const field = $(eye.dataset.for);
    const show = field.type === "password";
    field.type = show ? "text" : "password";
    eye.classList.toggle("on", show);
    eye.setAttribute("aria-pressed", String(show));
    eye.setAttribute("aria-label", show ? "Nascondi la password" : "Mostra la password");
  }));
  /** Typed passwords are hidden again whenever the screen is drawn afresh. */
  function hidePasswords() {
    document.querySelectorAll(".eye").forEach((eye) => {
      $(eye.dataset.for).type = "password";
      eye.classList.remove("on");
      eye.setAttribute("aria-pressed", "false");
    });
  }
  $("dClose").addEventListener("click", closeDrawer);
  $("dHome").addEventListener("click", closeDrawer);
  $("drawer").addEventListener("click", (event) => { if (event.target.id === "drawer") closeDrawer(); });
  $("dWeb").addEventListener("click", () => {
    if (!drawerNode) return;
    closeDrawer();
    native.openRouter("http://" + drawerNode.host + "/cgi-bin/luci/", drawerNode.name + " · interfaccia web");
  });
  $("mEdit").addEventListener("click", () => { closeDrawer(); showSetup(""); });
  $("mForget").addEventListener("click", () => {
    closeDrawer();
    stop();
    native.signOut();
    config = {};
    mode = "ha";
    showSetup("");
  });

  // Hooks the Android side calls.
  window.appBack = () => {
    if ($("drawer").classList.contains("show")) { closeDrawer(); return true; }
    if (window.RouterPages.back()) return true;
    const root = panel && panel.shadowRoot;
    const veil = root && root.getElementById("veil");
    if (veil && veil.classList.contains("open")) { panel._close(); return true; }
    if ($("setup").classList.contains("show") && panel && readConfig()) {
      banner("Mi collego…");
      $("setup").classList.remove("show");
      retry();
      return true;
    }
    return false;
  };
  window.appPause = () => { paused = true; };
  window.appResume = () => {
    paused = false;
    if ($("setup").classList.contains("show")) return;
    if (!ready) retry();
    else if (panel && panel._load) panel._load(true);
  };

  const failure = /^#errore=(.*)$/.exec(location.hash || "");
  if (failure) history.replaceState(null, "", location.pathname);
  if (readConfig() && !failure) {
    banner("Mi collego…");
    retry();
  } else {
    showSetup(failure ? decodeURIComponent(failure[1]) : "");
  }
})();
