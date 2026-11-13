/* Wi-Fi di casa — the glue between the bundled page and Home Assistant.
 *
 * The page (openwrt-router-panel.js) is the one Home Assistant shows in its
 * sidebar. There it is handed a `hass` object; here we build a small stand-in
 * that speaks Home Assistant's WebSocket API with a long-lived access token.
 */
(function () {
  "use strict";

  // Outside the app (a desktop browser, for trying the layout) keep the
  // settings in the page's own storage instead.
  const native = window.Android || {
    getConfig: () => localStorage.getItem("config") || "{}",
    saveConfig: (home, remote, token) => { localStorage.setItem("config", JSON.stringify({ home, remote, token })); return true; },
    clearConfig: () => localStorage.removeItem("config"),
    version: () => "anteprima",
  };

  const $ = (id) => document.getElementById(id);
  const TIMEOUT = 6000;

  let config = {};
  let socket = null;
  let ready = false;
  let nextId = 1;
  let pending = new Map();
  let panel = null;
  let retryTimer = null;
  let retryDelay = 1500;
  let connectedUrl = "";
  let haVersion = "";
  let paused = false;

  const clean = (url) => {
    url = (url || "").trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\//i.test(url)) url = "http://" + url;
    return url;
  };

  function readConfig() {
    try { config = JSON.parse(native.getConfig()) || {}; } catch (error) { config = {}; }
    return config.token && (config.home || config.remote);
  }

  /** Open a socket to one address; resolves once Home Assistant accepted the token. */
  function open(url) {
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
          ws.send(JSON.stringify({ type: "auth", access_token: config.token }));
        } else if (message.type === "auth_invalid") {
          clearTimeout(timer);
          fail("auth");
        } else if (message.type === "auth_ok") {
          clearTimeout(timer);
          settled = true;
          haVersion = message.ha_version || "";
          resolve(ws);
        }
      };
    });
  }

  async function connect() {
    clearTimeout(retryTimer);
    const urls = [clean(config.home), clean(config.remote)].filter(Boolean);
    let lastError = "unreachable";
    for (const url of urls) {
      try {
        const ws = await open(url);
        adopt(ws, url);
        return true;
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
    retryDelay = 1500;
    banner("");
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (!waiting || message.type !== "result") return;
      pending.delete(message.id);
      if (message.success) waiting.resolve(message.result);
      else waiting.reject(new Error((message.error && message.error.message) || "errore"));
    };
    ws.onclose = ws.onerror = () => {
      if (socket !== ws) return;
      dropped();
    };
  }

  function dropped() {
    ready = false;
    socket = null;
    pending.forEach((waiting) => waiting.reject(new Error("collegamento interrotto")));
    pending.clear();
    if (paused) return;
    banner("Collegamento a casa interrotto, riprovo…");
    retryTimer = setTimeout(retry, retryDelay);
    retryDelay = Math.min(retryDelay * 1.6, 15000);
  }

  async function retry() {
    try {
      await connect();
      showApp();
    } catch (error) {
      if (error.message === "auth") return showSetup("Home Assistant non accetta più il token. Creane uno nuovo.");
      banner("Casa non raggiungibile, riprovo…");
      retryTimer = setTimeout(retry, retryDelay);
      retryDelay = Math.min(retryDelay * 1.6, 15000);
    }
  }

  const hass = {
    language: (navigator.language || "it").toLowerCase(),
    callWS(message) {
      if (!ready || !socket) return Promise.reject(new Error("non collegato"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, ...message }));
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error("nessuna risposta da casa"));
        }, 90000);
      });
    },
  };

  function banner(text) {
    $("bannerText").textContent = text;
    $("banner").classList.toggle("show", Boolean(text));
  }

  function showSetup(message) {
    $("app").style.display = "none";
    $("setup").classList.add("show");
    $("home").value = config.home || "";
    $("remote").value = config.remote || "";
    $("token").value = "";
    $("token").placeholder = config.token ? "Lascia vuoto per tenere il token salvato" : "Incolla qui il token";
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
      panel.addEventListener("hass-toggle-menu", openMenu);
      $("app").appendChild(panel);
    }
    panel.hass = hass;
    if (panel._load) panel._load(true);
  }

  async function check() {
    // The integration must be installed: ask for the snapshot once.
    try {
      await hass.callWS({ type: "openwrt_router/snapshot" });
      return "";
    } catch (error) {
      return /unknown command|Unknown command/i.test(error.message)
        ? "Su questo Home Assistant non è installata l'integrazione OpenWrt Router."
        : /Unauthorized|admin/i.test(error.message)
          ? "Il token deve appartenere a un utente amministratore."
          : "";
    }
  }

  async function submit() {
    const button = $("connect");
    const token = $("token").value.trim() || config.token || "";
    const home = clean($("home").value);
    const remote = clean($("remote").value);
    if (!home && !remote) return showSetup("Scrivi almeno un indirizzo di Home Assistant.");
    if (!token) return showSetup("Incolla il token di accesso.");
    button.disabled = true;
    button.textContent = "Collego…";
    config = { home, remote, token };
    try {
      await connect();
      const problem = await check();
      if (problem) { if (socket) socket.close(); ready = false; return showSetup(problem); }
      native.saveConfig(home, remote, token);
      showApp();
    } catch (error) {
      showSetup(error.message === "auth"
        ? "Home Assistant ha rifiutato il token. Controlla di averlo copiato tutto."
        : "Home Assistant non risponde a questi indirizzi. Sei sulla rete di casa o con Tailscale acceso?");
    } finally {
      button.disabled = false;
      button.textContent = "Collega";
    }
  }

  function openMenu() {
    $("mUrl").textContent = connectedUrl || "—";
    $("mVersion").textContent = haVersion || "—";
    $("mApp").textContent = native.version();
    $("menu").classList.add("show");
  }

  const closeMenu = () => $("menu").classList.remove("show");

  $("connect").addEventListener("click", submit);
  $("mClose").addEventListener("click", closeMenu);
  $("menu").addEventListener("click", (event) => { if (event.target.id === "menu") closeMenu(); });
  $("mEdit").addEventListener("click", () => { closeMenu(); showSetup(""); });
  $("mForget").addEventListener("click", () => {
    closeMenu();
    native.clearConfig();
    config = {};
    if (socket) { const ws = socket; socket = null; ready = false; ws.close(); }
    clearTimeout(retryTimer);
    showSetup("");
  });

  // Hooks the Android side calls.
  window.appBack = () => {
    if ($("menu").classList.contains("show")) { closeMenu(); return true; }
    const root = panel && panel.shadowRoot;
    const veil = root && root.getElementById("veil");
    if (veil && veil.classList.contains("open")) { panel._close(); return true; }
    if ($("setup").classList.contains("show") && readConfig() && ready) { showApp(); return true; }
    return false;
  };
  window.appPause = () => { paused = true; };
  window.appResume = () => {
    paused = false;
    if (!ready && config.token && !$("setup").classList.contains("show")) retry();
    else if (panel && panel._load) panel._load(true);
  };

  if (readConfig()) {
    banner("Mi collego a casa…");
    retry();
  } else {
    showSetup("");
  }
})();
