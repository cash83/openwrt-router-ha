/* Talking to an OpenWrt router directly, without Home Assistant.
 *
 * Same reading of the network as the integration's api.py, in the same shape,
 * so the page cannot tell which of the two is behind it. Requests go through
 * the Android side (`http`), because a page cannot call a router's /ubus
 * across origins.
 */
(function () {
  "use strict";

  const ANON = "0".repeat(32);
  const BLOCK = "habrk_";
  const BANDS = ["2g", "5g", "6g"];
  const LABEL = { "2g": "2.4 GHz", "5g": "5 GHz", "6g": "6 GHz" };
  const MODES = {
    "2g": { n: "Wi-Fi 4 (802.11n)", ax: "Wi-Fi 6 (802.11ax)" },
    "5g": { n: "Wi-Fi 4 (802.11n)", ac: "Wi-Fi 5 (802.11ac)", ax: "Wi-Fi 6 (802.11ax)" },
    "6g": { ax: "Wi-Fi 6E (802.11ax)" },
  };
  const PREFIX = { n: "HT", ac: "VHT", ax: "HE" };
  const FAMILY = { HT: "n", VHT: "ac", HE: "ax", EHT: "ax" };
  const POWER = { max: 0, medium: 3, low: 7 };
  const POWER_LABEL = { max: "Maximum", medium: "Medium", low: "Low" };
  const MIN_INTERVAL = 8000;
  const WIRED_GRACE = 180000;

  const mac12 = (mac) => String(mac || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const colon = (mac) => {
    const raw = mac12(mac).toUpperCase();
    return raw.length === 12 ? raw.match(/../g).join(":") : "";
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const split = (htmode) => {
    const match = /^(EHT|HE|VHT|HT)(\d+)$/.exec(String(htmode || "HT20").toUpperCase());
    return match ? [match[1], match[2]] : ["HT", "20"];
  };
  const isPublic = (ip) => {
    const p = String(ip || "").split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return false;
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    return true;
  };
  const toInt = (ip) => ip.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
  const toIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

  class AuthError extends Error {}

  class DirectRouter {
    constructor(host, username, password, http, upload) {
      let base = String(host || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(base)) base = "http://" + base;
      this.base = base;
      this.username = username;
      this.password = password;
      this.http = http;
      this.upload = upload || null;
      this.rights = new Set();
      this.sessions = new Map();
      this.cpu = new Map();
      this.bytes = new Map();
      this.wired = new Map();
      this.nodeUrls = new Map();
      this.known = new Map();
      this.ledMemory = new Map();
      this.snapshot = null;
      this.readAt = 0;
      this.reading = null;
    }

    async post(base, session, obj, method, args) {
      const reply = await this.http(base + "/ubus", {
        jsonrpc: "2.0", id: 1, method: "call", params: [session, obj, method, args || {}],
      });
      if (!reply || reply.status !== 200 || !reply.json) throw new Error("unreachable");
      return reply.json;
    }

    async login(base) {
      const payload = await this.post(base, ANON, "session", "login",
        { username: this.username, password: this.password });
      const result = payload.result;
      const session = Array.isArray(result) && result[0] === 0 && result[1] && result[1].ubus_rpc_session;
      if (!session) { this.sessions.delete(base); return false; }
      this.sessions.set(base, session);
      return true;
    }

    /** One ubus call; logs in again once when the session has expired. */
    async call(obj, method, args, options) {
      const { base = this.base, fallback = null, strict = false } = options || {};
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (!this.sessions.has(base) && !(await this.login(base))) throw new AuthError("login refused");
        const payload = await this.post(base, this.sessions.get(base), obj, method, args);
        const expired = payload.error && payload.error.code === -32002;
        if (expired && attempt === 1) { this.sessions.delete(base); continue; }
        const result = payload.result;
        if (Array.isArray(result) && result[0] === 0) return result.length > 1 ? result[1] : {};
        if (strict) throw new Error(`${obj}.${method}: ${JSON.stringify(payload.error || result)}`);
        return fallback;
      }
      return fallback;
    }

    authenticate() { return this.login(this.base); }

    async maxPower(ifname, base) {
      if (!ifname) return null;
      const levels = (await this.call("iwinfo", "txpowerlist", { device: ifname }, { base })) || {};
      const values = (levels.results || []).map((item) => item.dbm).filter((v) => v != null);
      return values.length ? Math.max(...values) : null;
    }

    async radios(base) {
      const status = (await this.call("luci-rpc", "getWirelessDevices", {}, { base })) || {};
      const out = {};
      for (const [name, radio] of Object.entries(status)) {
        const config = radio.config || {};
        const band = config.band;
        if (!BANDS.includes(band) || out[band]) continue;
        let ap = null, mesh = null;
        for (const iface of radio.interfaces || []) {
          const mode = (iface.config || {}).mode;
          if (mode === "ap" && !ap) ap = iface;
          else if (mode === "mesh" && !mesh) mesh = iface;
          else if (mode === "sta" && (iface.config || {}).wds && !mesh) mesh = iface;
        }
        const apConfig = (ap && ap.config) || {};
        const apInfo = (ap && ap.iwinfo) || {};
        const info = radio.iwinfo || {};
        const [family, width] = split(config.htmode);
        const widths = band === "2g" ? ["20", "40"] : ["20", "40", "80"];
        if ((info.htmodes || []).some((m) => String(m).endsWith("160"))) widths.push("160");
        if (!widths.includes(width)) widths.push(width);
        const channels = { auto: "Auto" };
        const ifname = ap && ap.ifname;
        if (ifname) {
          const listing = (await this.call("iwinfo", "freqlist", { device: ifname }, { base })) || {};
          for (const item of listing.results || []) {
            if (!item.restricted) channels[String(item.channel)] = `${item.channel} (${item.mhz} MHz)`;
          }
        }
        const configured = String(config.channel || "auto");
        if (!(configured in channels)) channels[configured] = configured;
        let power = "max";
        if (config.txpower != null && config.txpower !== "") {
          const ceiling = await this.maxPower(ifname, base);
          const backoff = ceiling == null ? 0 : ceiling - Number(config.txpower);
          power = backoff <= 1 ? "max" : backoff <= 4 ? "medium" : "low";
        }
        out[band] = {
          radio: name, ifname: ifname || null, section: (ap && ap.section) || null,
          mesh_ifname: (mesh && mesh.ifname) || null,
          mesh_mode: (mesh && mesh.config && mesh.config.mode) || null,
          bssid: colon(apInfo.bssid), ssid: apConfig.ssid || apInfo.ssid || null,
          channel: apInfo.channel || info.channel || null,
          enabled: Boolean(ap) && apConfig.disabled !== "1" && !radio.disabled,
          hidden: apConfig.hidden === "1", isolate: apConfig.isolate === "1",
          htmode: family + width, mode: FAMILY[family] || "n", width,
          channel_setting: configured, tx_power: power,
          options: {
            mode: { ...(MODES[band] || MODES["5g"]) },
            width: Object.fromEntries(widths.map((w) => [w, `${w} MHz`])),
            channel: channels, tx_power: { ...POWER_LABEL },
          },
        };
      }
      return out;
    }

    async stations(base, ifname) {
      if (!ifname) return [];
      const reply = (await this.call("iwinfo", "assoclist", { device: ifname }, { base })) || {};
      return reply.results || [];
    }

    async leds(base) {
      const leds = await this.call("luci", "getLEDs", {}, { base });
      if (!leds || !Object.keys(leds).length) return null;
      return Object.values(leds).some((led) => (led.brightness || 0) > 0
        || (led.active_trigger && led.active_trigger !== "none"));
    }

    async cpuUsage(base, info, board) {
      const text = ((await this.call("file", "read", { path: "/proc/stat" }, { base })) || {}).data || "";
      const fields = text.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
      if (fields.length >= 5) {
        const now = [fields.reduce((a, b) => a + b, 0), fields[3] + fields[4]];
        const before = this.cpu.get(base);
        this.cpu.set(base, now);
        if (before && now[0] > before[0]) {
          const busy = (now[0] - before[0]) - (now[1] - before[1]);
          return Math.round(Math.max(0, Math.min(100, (100 * busy) / (now[0] - before[0]))) * 10) / 10;
        }
      }
      if (info.load) {
        const cores = /ARMv8/.test(String(board.system)) ? 2 : 1;
        return Math.round(Math.min(100, (100 * info.load[0]) / 65536 / cores) * 10) / 10;
      }
      return null;
    }

    async node(address, base, isMain) {
      await this.ensureRights(base);
      const board = await this.call("system", "board", {}, { base, strict: true });
      const info = (await this.call("system", "info", {}, { base })) || {};
      const radios = await this.radios(base);
      const lan = (await this.call("network.device", "status", { name: "br-lan" }, { base })) || {};
      const label = BANDS.map((b) => radios[b] && radios[b].bssid).find(Boolean) || "";
      const id = label || colon(lan.macaddr);
      if (!id) throw new Error("no hardware address");
      const memory = info.memory || {};
      const available = memory.available != null ? memory.available : memory.free || 0;
      const release = board.release || {};
      const name = board.hostname || address;
      const stations = [];
      let mesh = null;
      for (const [band, radio] of Object.entries(radios)) {
        for (const station of await this.stations(base, radio.ifname)) {
          stations.push({
            key: mac12(station.mac), band, node_id: id, node: name, ifname: radio.ifname,
            signal: station.signal, inactive: station.inactive || 0, connected: station.connected_time,
            rx: (station.rx || {}).bytes || 0, tx: (station.tx || {}).bytes || 0,
          });
        }
        if (!mesh && radio.mesh_ifname) {
          const peers = await this.stations(base, radio.mesh_ifname);
          if (peers.length) {
            const peer = peers.reduce((a, b) => ((b.signal || -200) > (a.signal || -200) ? b : a));
            mesh = {
              band, type: radio.mesh_mode, signal: peer.signal,
              tx_rate: Math.round(((peer.tx || {}).rate || 0) / 1000),
              rx_rate: Math.round(((peer.rx || {}).rate || 0) / 1000), peers: peers.length,
            };
          }
        }
      }
      return [{
        id, name, host: address, is_main: isMain, online: true, model: board.model || null,
        firmware: [release.distribution, release.version].filter(Boolean).join(" "),
        uptime: info.uptime != null ? info.uptime : null,
        cpu: await this.cpuUsage(base, info, board),
        ram: memory.total ? Math.round((1000 * (memory.total - available)) / memory.total) / 10 : null,
        leds: await this.leds(base), radios, mesh,
        backhaul: isMain ? null : mesh ? `Wi-Fi ${LABEL[mesh.band]}` : "Ethernet",
        own_macs: [mac12(lan.macaddr), mac12(id)],
      }, stations];
    }

    /** The address the internet sees. Behind another modem only the router can find out. */
    async publicIp(wanIp) {
      if (isPublic(wanIp)) return wanIp;
      if (this.publicAt && Date.now() - this.publicAt < 900000) return this.publicValue;
      const reply = (await this.call("file", "exec", {
        command: "/bin/uclient-fetch", params: ["-q", "-T", "5", "-O", "-", "https://api.ipify.org"],
      })) || {};
      const found = String(reply.stdout || "").trim();
      if (isPublic(found)) { this.publicValue = found; this.publicAt = Date.now(); }
      return this.publicValue || null;
    }

    /** Remember the clients seen so far; one that was never seen is "new" for a day. */
    markNew(clients, now) {
      const slot = "knownClients:" + this.base;
      let known = null;
      try { known = JSON.parse(localStorage.getItem(slot)); } catch (e) { /* none yet */ }
      const first = !known;
      known = known || {};
      let changed = first;
      for (const [key, client] of Object.entries(clients)) {
        if (!(key in known)) { known[key] = first ? 0 : now; changed = true; }
        client.is_new = now - known[key] < 86400000;
      }
      if (changed) { try { localStorage.setItem(slot, JSON.stringify(known)); } catch (e) { /* full */ } }
    }

    speed(key, rx, tx, now) {
      const previous = this.bytes.get(key);
      this.bytes.set(key, [rx, tx, now]);
      if (!previous) return [0, 0];
      const elapsed = (now - previous[2]) / 1000;
      const dRx = rx - previous[0], dTx = tx - previous[1];
      if (elapsed <= 0 || dRx < 0 || dTx < 0) return [0, 0];
      const round = (v) => Math.round(v * 1000) / 1000;
      return [round((dRx * 8) / elapsed / 1e6), round((dTx * 8) / elapsed / 1e6)];
    }

    /** The whole network; at most one reading every few seconds, shared by callers. */
    read() {
      if (this.snapshot && Date.now() - this.readAt < MIN_INTERVAL) return Promise.resolve(this.snapshot);
      if (!this.reading) {
        this.reading = this.collect().finally(() => { this.reading = null; });
      }
      return this.reading;
    }

    async collect() {
      const now = Date.now();
      const scheme = this.base.split("://")[0];
      const mainAddress = this.base.split("://")[1].split(/[:/]/)[0];
      const [main, stations] = await this.node(mainAddress, this.base, true);
      const nodes = { [main.id]: main };

      const remote = (await this.call("usteer", "remote_info")) || {};
      for (const key of Object.keys(remote)) {
        const address = key.split("#")[0];
        if (/^\d+\.\d+\.\d+\.\d+$/.test(address) && !this.nodeUrls.has(address)) {
          this.nodeUrls.set(address, `${scheme}://${address}`);
        }
      }
      for (const [address, base] of this.nodeUrls) {
        let node = null, nodeStations = [];
        try {
          [node, nodeStations] = await this.node(address, base, false);
        } catch (error) {
          this.sessions.delete(base);
          const old = [...this.known.values()].find((n) => n.host === address);
          if (!old) continue;
          node = { ...old, online: false, mesh: null, cpu: null, ram: null, uptime: null };
        }
        nodes[node.id] = node;
        stations.push(...nodeStations);
      }
      this.known = new Map(Object.entries(nodes).filter(([, n]) => !n.is_main));

      const interfaces = {};
      for (const item of ((await this.call("network.interface", "dump")) || {}).interface || []) {
        interfaces[item.interface] = item;
      }
      const wan = interfaces.wan || {}, lan = interfaces.lan || {};
      const wanDevice = (await this.call("network.device", "status", { name: wan.l3_device || "eth0" })) || {};
      const dhcp = ((((await this.call("uci", "get", { config: "dhcp" })) || {}).values) || {}).lan || {};
      const firewall = ((await this.call("uci", "get", { config: "firewall" })) || {}).values || {};
      const blocked = new Set(Object.entries(firewall)
        .filter(([name, section]) => name.startsWith(BLOCK) && section.enabled !== "0")
        .map(([name]) => name.slice(BLOCK.length)));
      const leases = ((await this.call("luci-rpc", "getDHCPLeases")) || {}).dhcp_leases || [];
      const hints = (await this.call("luci-rpc", "getHostHints")) || {};
      const neighbours = ((await this.call("file", "exec",
        { command: "/sbin/ip", params: ["-4", "neigh", "show"] })) || {}).stdout || "";

      const addresses = {}, names = {};
      for (const [mac, hint] of Object.entries(hints)) {
        if (hint.ipaddrs && hint.ipaddrs.length) addresses[mac12(mac)] = hint.ipaddrs[0];
        if (hint.name) names[mac12(mac)] = String(hint.name).split(".")[0];
      }
      for (const lease of leases) {
        if (lease.ipaddr) addresses[mac12(lease.macaddr)] = lease.ipaddr;
        if (lease.hostname) names[mac12(lease.macaddr)] = lease.hostname;
      }

      const own = new Set([mac12(wanDevice.macaddr)]);
      Object.values(nodes).forEach((node) => node.own_macs.forEach((m) => own.add(m)));

      const best = {};
      for (const station of stations) {
        if (station.key.length !== 12 || own.has(station.key)) continue;
        if (!best[station.key] || station.inactive < best[station.key].inactive) best[station.key] = station;
      }
      const clients = {};
      for (const [key, station] of Object.entries(best)) {
        const [up, down] = this.speed(key, station.rx, station.tx, now);
        clients[key] = {
          mac: colon(key), name: names[key] || colon(key), named: key in names, ip: addresses[key] || null,
          node_id: station.node_id, node: station.node, ifname: station.ifname, band: station.band,
          connection: LABEL[station.band], signal: station.signal, connected: station.connected,
          up, down,
          used_down: Math.round((station.tx / 1048576) * 10) / 10,
          used_up: Math.round((station.rx / 1048576) * 10) / 10,
          blocked: blocked.has(key),
        };
      }

      const lanPort = lan.l3_device || "br-lan";
      let arp = 0;
      for (const line of neighbours.split("\n")) {
        const match = /^(\S+)\s+dev\s+(\S+)\s+lladdr\s+(\S+).*\s(\S+)$/.exec(line.trim());
        if (!match || match[2] !== lanPort) continue;
        arp += 1;
        const key = mac12(match[3]);
        if (!clients[key] && !own.has(key) && ["REACHABLE", "DELAY", "PROBE", "PERMANENT"].includes(match[4])) {
          this.wired.set(key, [now, match[1]]);
        }
      }
      for (const [key, [seenAt, address]] of [...this.wired]) {
        if (clients[key] || own.has(key) || now - seenAt > WIRED_GRACE) { this.wired.delete(key); continue; }
        clients[key] = {
          mac: colon(key), name: names[key] || colon(key), named: key in names, ip: addresses[key] || address,
          node_id: main.id, node: main.name, ifname: null, band: "wired", connection: "Ethernet",
          signal: null, connected: null, up: 0, down: 0, used_down: null, used_up: null, blocked: blocked.has(key),
        };
      }
      for (const key of [...this.bytes.keys()]) if (!best[key]) this.bytes.delete(key);
      this.markNew(clients, now);

      const everyone = Object.values(clients);
      for (const node of Object.values(nodes)) {
        const members = everyone.filter((c) => c.node_id === node.id);
        node.clients = members.length;
        node.clients_2g = members.filter((c) => c.band === "2g").length;
        node.clients_5g = members.filter((c) => c.band === "5g").length;
        node.clients_wired = members.filter((c) => c.band === "wired").length;
        delete node.own_macs;
      }
      // own_macs is needed again on the next reading for nodes that go offline.
      this.known.forEach((node) => { node.own_macs = node.own_macs || []; });

      const lanAddress = (lan["ipv4-address"] || [{}])[0];
      const wanAddress = (wan["ipv4-address"] || [{}])[0];
      const statistics = wanDevice.statistics || {};
      let dhcpStart = null, dhcpEnd = null;
      if (lanAddress.address && lanAddress.mask != null) {
        const mask = lanAddress.mask === 0 ? 0 : (2 ** 32 - 2 ** (32 - lanAddress.mask));
        const network = Math.floor(toInt(lanAddress.address) / 2 ** (32 - lanAddress.mask)) * 2 ** (32 - lanAddress.mask);
        const first = network + Number(dhcp.start || 100);
        dhcpStart = toIp(first);
        dhcpEnd = toIp(first + Number(dhcp.limit || 150) - 1);
        void mask;
      }
      const lease = /^\s*(\d+)\s*([smhdw]?)\s*$/.exec(dhcp.leasetime || "");
      const top = (field) => everyone.reduce((a, b) => (!a || b[field] > a[field] ? b : a), null);
      const topDown = top("down"), topUp = top("up");
      const sum = (field) => Math.round(everyone.reduce((s, c) => s + c[field], 0) * 1000) / 1000;
      const megabyte = 1024 * 1024;

      this.snapshot = {
        main: main.id, nodes, clients,
        network: {
          wan_up: Boolean(wan.up), wan_protocol: String(wan.proto || "").toUpperCase() || null,
          wan_uptime: wan.up ? wan.uptime : 0, wan_ip: wanAddress.address || null,
          public_ip: await this.publicIp(wanAddress.address),
          gateway: ((wan.route || []).find((r) => r.target === "0.0.0.0") || {}).nexthop || null,
          dns: wan["dns-server"] || [],
          download_mb: Math.round(((statistics.rx_bytes || 0) / megabyte) * 100) / 100,
          upload_mb: Math.round(((statistics.tx_bytes || 0) / megabyte) * 100) / 100,
          lan_ip: lanAddress.address || null, netmask: null, dhcp_start: dhcpStart, dhcp_end: dhcpEnd,
          dhcp_lease: lease ? Number(lease[1]) * { s: 1, m: 60, "": 60, h: 3600, d: 86400, w: 604800 }[lease[2]] : null,
          arp_entries: arp,
        },
        totals: {
          clients: everyone.length,
          wifi_2g: everyone.filter((c) => c.band === "2g").length,
          wifi_5g: everyone.filter((c) => c.band === "5g").length,
          wired: everyone.filter((c) => c.band === "wired").length,
          down: sum("down"), up: sum("up"),
          top_down: topDown && { name: topDown.name, mac: topDown.mac, down: topDown.down },
          top_up: topUp && { name: topUp.name, mac: topUp.mac, up: topUp.up },
        },
      };
      this.readAt = Date.now();
      return this.snapshot;
    }

    // ------------------------------------------------------------- actions

    baseOf(nodeId) {
      const node = this.snapshot && this.snapshot.nodes[nodeId];
      if (!node) throw new Error("nodo sconosciuto");
      return node.is_main ? this.base : this.nodeUrls.get(node.host);
    }

    async renameNode(nodeId, text) {
      // Letters, digits and hyphens, 63 at most: what a router accepts as its host name.
      const name = String(text || "").trim().replace(/[\s_]+/g, "-").replace(/[^A-Za-z0-9-]/g, "")
        .replace(/-{2,}/g, "-").slice(0, 63).replace(/^-+|-+$/g, "");
      if (!name) throw new Error("Il nome deve avere almeno una lettera o una cifra.");
      const base = this.baseOf(nodeId);
      const values = ((await this.call("uci", "get", { config: "system" }, { base, strict: true })) || {}).values || {};
      const section = Object.keys(values).find((key) => values[key][".type"] === "system");
      if (!section) throw new Error("Questo nodo non ha le impostazioni di sistema.");
      await this.call("uci", "set", { config: "system", section, values: { hostname: name } }, { base, strict: true });
      await this.call("uci", "commit", { config: "system" }, { base, strict: true });
      await this.call("rc", "init", { name: "system", action: "reload" }, { base, strict: true });
    }

    async reboot(nodeId) {
      const base = this.baseOf(nodeId);
      try { await this.call("file", "exec", { command: "/sbin/reboot" }, { base, strict: true }); } catch (e) { /* it may drop the connection */ }
      this.sessions.delete(base);
    }

    async restartRadio(nodeId, band) {
      const base = this.baseOf(nodeId);
      const radio = (await this.radios(base))[band];
      if (!radio) throw new Error("radio assente");
      await this.call("network.wireless", "down", { radio: radio.radio }, { base, strict: true });
      await sleep(4000);
      await this.call("network.wireless", "up", { radio: radio.radio }, { base, strict: true });
    }

    async setRadio(nodeId, band, setting, value) {
      const nodes = Object.values(this.snapshot.nodes);
      const targets = nodeId ? [nodeId]
        : nodes.filter((n) => !n.is_main && n.online).map((n) => n.id).concat(nodes.filter((n) => n.is_main).map((n) => n.id));
      // Write the setting on every node before any radio restarts: a restart can cut the way
      // to the other nodes for a minute or more, and nodes left with different settings
      // would not find each other again.
      const errors = [];
      const written = [];
      for (const target of targets) {
        const base = this.baseOf(target);
        try { written.push([base, await this.writeRadio(base, band, setting, value)]); } catch (error) { errors.push(error.message); }
      }
      if (errors.length) {
        for (const [base] of written) await this.call("uci", "revert", { config: "wireless" }, { base }).catch(() => {});
        throw new Error(errors.join("; "));
      }
      for (const [base] of written) {
        try { await this.call("uci", "commit", { config: "wireless" }, { base, strict: true }); } catch (error) { errors.push(error.message); }
      }
      for (const [base, radio] of written) {
        // The setting is saved; a node that stops answering while its radio restarts takes it up on its own.
        try { await this.reloadRadio(base, radio); } catch (error) { /* saved already */ }
      }
      if (errors.length) throw new Error(errors.join("; "));
    }

    /** Stage one wireless setting on a node (not saved, nothing restarts) and return its radio. */
    async writeRadio(base, band, setting, value) {
      const radio = (await this.radios(base))[band];
      if (!radio) throw new Error("radio assente");
      let [family, width] = split(radio.htmode);
      const set = (section, values) => {
        if (!section) throw new Error("nessun access point su questa radio");
        return this.call("uci", "set", { config: "wireless", section, values }, { base, strict: true });
      };
      if (setting === "enabled") await set(radio.section, { disabled: value ? "0" : "1" });
      else if (setting === "hidden" || setting === "isolate") await set(radio.section, { [setting]: value ? "1" : "0" });
      else if (setting === "mode") {
        if (!PREFIX[value]) throw new Error("standard sconosciuto");
        if (value === "n" && !["20", "40"].includes(width)) width = "40";
        await set(radio.radio, { htmode: PREFIX[value] + width });
      } else if (setting === "width") {
        const next = String(value).replace(/\D/g, "");
        if (!["20", "40", "80", "160"].includes(next)) throw new Error("larghezza sconosciuta");
        if (family === "HT" && !["20", "40"].includes(next)) family = "VHT";
        await set(radio.radio, { htmode: family + next });
      } else if (setting === "channel") await set(radio.radio, { channel: String(value) });
      else if (setting === "ssid") {
        const name = String(value).trim();
        if (!name || new TextEncoder().encode(name).length > 32) throw new Error("il nome della rete va da 1 a 32 caratteri");
        await set(radio.section, { ssid: name });
      } else if (setting === "key") {
        if (String(value).length < 8 || String(value).length > 63) throw new Error("la password del Wi-Fi va da 8 a 63 caratteri");
        await set(radio.section, { key: String(value) });
      }
      else if (setting === "tx_power") {
        if (!(value in POWER)) throw new Error("potenza sconosciuta");
        if (value === "max") {
          await this.call("uci", "delete", { config: "wireless", section: radio.radio, options: ["txpower"] }, { base });
        } else {
          const ceiling = await this.maxPower(radio.ifname, base);
          if (ceiling == null) throw new Error("la radio non dichiara i livelli di potenza");
          await set(radio.radio, { txpower: String(Math.max(1, ceiling - POWER[value])) });
        }
      } else throw new Error("impostazione sconosciuta");

      return radio;
    }

    async reloadRadio(base, radio) {
      await this.call("network", "reload", {}, { base, strict: true });
      if (radio.mesh_ifname) {
        await sleep(3000);
        await this.call("network.wireless", "down", { radio: radio.radio }, { base });
        await sleep(4000);
        await this.call("network.wireless", "up", { radio: radio.radio }, { base });
      }
    }

    async blockClient(mac, blocked, label) {
      const key = mac12(mac);
      const section = BLOCK + key;
      await this.call("uci", "delete", { config: "firewall", section });
      if (blocked) {
        await this.call("uci", "add", {
          config: "firewall", type: "rule", name: section,
          values: { name: `Block internet ${label || colon(key)}`.slice(0, 60), src: "lan", dest: "wan",
            src_mac: colon(key), proto: "all", target: "REJECT" },
        }, { strict: true });
      }
      await this.call("uci", "commit", { config: "firewall" }, { strict: true });
      await this.call("rc", "init", { name: "firewall", action: "reload" }, { strict: true });
    }

    async kickClient(mac, banSeconds) {
      const client = this.snapshot && this.snapshot.clients[mac12(mac)];
      if (!client || !client.ifname) throw new Error("il dispositivo non è collegato in Wi-Fi");
      await this.call(`hostapd.${client.ifname}`, "del_client",
        { addr: client.mac.toLowerCase(), reason: 5, deauth: true, ban_time: Math.max(0, banSeconds || 0) * 1000 },
        { base: this.baseOf(client.node_id), strict: true });
    }

    // ---------------------------------------------- files on the router

    /** Put an archive (base64) where the router's "restore backup" expects it. */
    async putArchive(base, data) {
      if (!this.upload) throw new Error("questa versione dell'app non sa caricare file");
      await this.call("system", "board", {}, { base, strict: true });
      const reply = await this.upload(base + "/cgi-bin/cgi-upload", this.sessions.get(base), "/tmp/backup.tar.gz", data);
      if (!reply || reply.status !== 200 || !/size/.test(reply.text || "")) throw new Error("il router non ha accettato il file");
    }

    async unpack(base) {
      const out = (await this.call("file", "exec",
        { command: "/sbin/sysupgrade", params: ["--restore-backup", "/tmp/backup.tar.gz"] }, { base, strict: true })) || {};
      if (out.code) throw new Error("ripristino non riuscito " + (out.stderr || ""));
    }

    /** Install the rights file on a router that lacks this version (see tools/make_acl.py). */
    async ensureRights(base) {
      const acl = window.ROUTER_ACL;
      if (this.rights.has(base) || !acl || !this.upload) return;
      this.rights.add(base);
      try {
        const access = await this.call("session", "access", { scope: "file", object: acl.mark, function: "read" }, { base });
        if (access && access.access) return;
        await this.putArchive(base, acl.archive);
        await this.unpack(base);
        await this.call("rc", "init", { name: "rpcd", action: "reload" }, { base });
        this.sessions.delete(base);
        await sleep(2000);
      } catch (error) { /* the app works without it, with less */ }
    }

    /** Put a configuration backup (base64) back on a node, then restart it. */
    async restore(nodeId, data) {
      if (!/^H4sI/.test(data)) throw new Error("questo file non è un backup del router");
      const base = this.baseOf(nodeId);
      await this.putArchive(base, data);
      const listing = (await this.call("file", "exec",
        { command: "/bin/tar", params: ["-tzf", "/tmp/backup.tar.gz"] }, { base, strict: true })) || {};
      if (!String(listing.stdout || "").includes("etc/config/")) throw new Error("questo file non è un backup del router");
      await this.unpack(base);
      await this.reboot(nodeId);
    }

    /** Send a client to one node: the others turn it away for a minute. */
    async moveClient(mac, nodeId) {
      const nodes = (this.snapshot && this.snapshot.nodes) || {};
      if (!nodes[nodeId] || !nodes[nodeId].online) throw new Error("il nodo scelto non è raggiungibile");
      const addr = colon(mac).toLowerCase();
      for (const [otherId, node] of Object.entries(nodes)) {
        if (otherId === nodeId || !node.online) continue;
        const base = this.baseOf(otherId);
        for (const radio of Object.values(node.radios || {})) {
          if (radio.ifname) {
            await this.call(`hostapd.${radio.ifname}`, "del_client",
              { addr, reason: 5, deauth: true, ban_time: 60000 }, { base });
          }
        }
      }
    }

    async setLeds(nodeId, enabled) {
      const base = this.baseOf(nodeId);
      const leds = await this.call("luci", "getLEDs", {}, { base, strict: true });
      const write = (name, attribute, text) => this.call("file", "write",
        { path: `/sys/class/leds/${name}/${attribute}`, data: text }, { base, strict: true });
      if (!enabled) {
        const memory = {};
        for (const [name, led] of Object.entries(leds)) memory[name] = [led.active_trigger || "none", led.brightness || 0];
        if (Object.values(memory).some(([t, b]) => t !== "none" || b > 0)) this.ledMemory.set(base, memory);
        for (const name of Object.keys(leds)) { await write(name, "trigger", "none"); await write(name, "brightness", "0"); }
        return;
      }
      const memory = this.ledMemory.get(base);
      if (memory) {
        for (const [name, [trigger, level]] of Object.entries(memory)) {
          await write(name, "trigger", trigger);
          if (trigger === "none") await write(name, "brightness", String(level));
        }
        return;
      }
      await this.call("rc", "init", { name: "led", action: "restart" }, { base });
      let steady = false;
      for (const [name, led] of Object.entries(leds)) {
        const radio = /phy(\d+)/.exec(name);
        if (radio) await write(name, "trigger", `phy${radio[1]}tpt`);
        else if (!steady && !name.includes("red") && /online|power|status|sys/.test(name)) {
          await write(name, "brightness", String(led.max_brightness || 1));
          steady = true;
        }
      }
    }

    /** The same messages the page sends to Home Assistant. */
    async handle(message) {
      if (message.type === "openwrt_router/snapshot") {
        const data = await this.read();
        return { networks: [{ entry_id: "direct", title: data.nodes[data.main].name, ok: true, interval: 10, data }] };
      }
      if (message.type !== "openwrt_router/action") throw new Error("Unknown command.");
      const m = message;
      if (m.action === "reboot") await this.reboot(m.node);
      else if (m.action === "rename") await this.renameNode(m.node, m.value);
      else if (m.action === "leds") await this.setLeds(m.node, Boolean(m.value));
      else if (m.action === "radio") await this.setRadio(m.node || null, m.band, m.setting, m.value);
      else if (m.action === "restart_radio") await this.restartRadio(m.node, m.band);
      else if (m.action === "move") await this.moveClient(m.mac, m.node);
      else if (m.action === "kick") await this.kickClient(m.mac, m.ban_seconds);
      else if (m.action === "block") await this.blockClient(m.mac, Boolean(m.value));
      this.readAt = 0;
      return { ok: true };
    }
  }

  window.DirectRouter = DirectRouter;
  window.DirectRouterAuthError = AuthError;
})();
