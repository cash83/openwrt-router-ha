"""Talk to OpenWrt routers over ubus (the JSON-RPC endpoint behind LuCI).

One router is the entry point. Every other access point of the same network is
found through usteer, the daemon OpenWrt access points use to talk to each
other, and is queried with the same credentials. The result of a poll is one
plain dictionary (see `collect`) that the rest of the integration reads.

Nothing here imports Home Assistant, so the module can be run and tested alone.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any

import requests
import urllib3

_LOGGER = logging.getLogger(__name__)

ANONYMOUS_SESSION = "0" * 32
TIMEOUT = 10
UBUS_PERMISSION_DENIED = 6
RPC_ACCESS_DENIED = -32002

BLOCK_RULE_PREFIX = "habrk_"
PUBLIC_IP_URL = "https://api.ipify.org"
PUBLIC_IP_MAX_AGE = 900
WIRED_GRACE = 180
MOVE_BAN = 60

BANDS = ("2g", "5g", "6g")
BAND_LABEL = {"2g": "2.4 GHz", "5g": "5 GHz", "6g": "6 GHz"}

MODE_OPTIONS = {
    "2g": {"n": "Wi-Fi 4 (802.11n)", "ax": "Wi-Fi 6 (802.11ax)"},
    "5g": {"n": "Wi-Fi 4 (802.11n)", "ac": "Wi-Fi 5 (802.11ac)", "ax": "Wi-Fi 6 (802.11ax)"},
    "6g": {"ax": "Wi-Fi 6E (802.11ax)"},
}
MODE_PREFIX = {"n": "HT", "ac": "VHT", "ax": "HE"}
PREFIX_MODE = {"HT": "n", "VHT": "ac", "HE": "ax", "EHT": "ax"}
TX_POWER_OPTIONS = {"max": "Maximum", "medium": "Medium", "low": "Low"}
TX_POWER_BACKOFF = {"max": 0, "medium": 3, "low": 7}

RADIO_SETTINGS = ("enabled", "hidden", "isolate", "mode", "width", "channel", "tx_power")


class OpenWrtError(Exception):
    """A ubus call failed."""


class AuthError(OpenWrtError):
    """The router refused the user name or the password."""


def base_url(host: str) -> str:
    host = host.strip()
    if not host.startswith(("http://", "https://")):
        host = f"http://{host}"
    return host.rstrip("/")


def mac12(mac: str | None) -> str:
    return re.sub(r"[^0-9a-f]", "", (mac or "").lower())


def mac_colon(mac: str | None) -> str:
    raw = mac12(mac).upper()
    return ":".join(raw[i : i + 2] for i in range(0, 12, 2)) if len(raw) == 12 else ""


def _netmask(prefix: Any) -> str | None:
    try:
        return str(ipaddress.ip_network(f"0.0.0.0/{int(prefix)}").netmask)
    except (TypeError, ValueError):
        return None


def _lease_seconds(raw: str | None) -> int | None:
    match = re.fullmatch(r"\s*(\d+)\s*([smhdw]?)\s*", raw or "")
    if not match:
        return None
    factor = {"s": 1, "m": 60, "": 60, "h": 3600, "d": 86400, "w": 604800}[match.group(2)]
    return int(match.group(1)) * factor


def _split_htmode(htmode: str | None) -> tuple[str, str]:
    match = re.fullmatch(r"(EHT|HE|VHT|HT)(\d+)", str(htmode or "HT20").upper())
    return (match.group(1), match.group(2)) if match else ("HT", "20")


class OpenWrtApi:
    """Session handling, one poll of everything, and the few things we change."""

    def __init__(self, host: str, username: str, password: str) -> None:
        self.base_url = base_url(host)
        self.username = username
        self.password = password
        self._http = requests.Session()
        self._http.verify = False
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        self._sessions: dict[str, str] = {}
        self._cpu: dict[str, tuple[int, int]] = {}
        self._bytes: dict[str, tuple[int, int, float]] = {}
        self._wired: dict[str, tuple[float, str]] = {}
        self._node_urls: dict[str, str] = {}
        self._known_nodes: dict[str, dict[str, Any]] = {}
        self._led_snapshots: dict[str, dict[str, tuple[str, int]]] = {}
        self._public_ip: tuple[float, str] | None = None
        self.snapshot: dict[str, Any] = {}

    # ------------------------------------------------------------------ rpc

    def _post(
        self, base: str, session: str, obj: str, method: str, args: dict, timeout: int = TIMEOUT
    ) -> Any:
        reply = self._http.post(
            f"{base}/ubus",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "call",
                "params": [session, obj, method, args],
            },
            timeout=timeout,
        )
        reply.raise_for_status()
        return reply.json()

    def _login(self, base: str) -> bool:
        payload = self._post(
            base,
            ANONYMOUS_SESSION,
            "session",
            "login",
            {"username": self.username, "password": self.password},
        )
        result = payload.get("result") if isinstance(payload, dict) else None
        if not isinstance(result, list) or not result or result[0] != 0:
            self._sessions.pop(base, None)
            return False
        session = (result[1] or {}).get("ubus_rpc_session") if len(result) > 1 else None
        if not session:
            return False
        self._sessions[base] = session
        return True

    def call(
        self,
        obj: str,
        method: str,
        args: dict | None = None,
        *,
        base: str | None = None,
        default: Any = None,
        strict: bool = False,
        timeout: int = TIMEOUT,
    ) -> Any:
        """Run one ubus call, logging in again once if the session expired.

        A call the router does not allow returns `default` unless `strict`.
        """
        base = base or self.base_url
        for attempt in (1, 2):
            session = self._sessions.get(base)
            if session is None:
                if not self._login(base):
                    raise AuthError(f"login refused by {base}")
                session = self._sessions[base]
            payload = self._post(base, session, obj, method, args or {}, timeout)
            error = payload.get("error") if isinstance(payload, dict) else None
            result = payload.get("result") if isinstance(payload, dict) else None
            expired = isinstance(error, dict) and error.get("code") == RPC_ACCESS_DENIED
            if expired and attempt == 1:
                self._sessions.pop(base, None)
                continue
            if isinstance(result, list) and result and result[0] == 0:
                return result[1] if len(result) > 1 else {}
            if strict:
                raise OpenWrtError(f"{obj}.{method} on {base}: {error or result}")
            return default
        return default

    def authenticate(self) -> bool:
        """True when the credentials work; connection problems raise."""
        try:
            return self._login(self.base_url)
        except requests.exceptions.SSLError:
            parsed = urllib.parse.urlsplit(self.base_url)
            self.base_url = urllib.parse.urlunsplit(("http", parsed.netloc, "", "", ""))
            return self._login(self.base_url)

    def identity(self) -> dict[str, str]:
        """Name and a stable id of the router, for the config flow."""
        board = self.call("system", "board", strict=True)
        device = self.call("network.device", "status", {"name": "br-lan"}) or {}
        return {
            "name": board.get("hostname") or "OpenWrt",
            "model": board.get("model") or "OpenWrt",
            "unique_id": mac12(device.get("macaddr")) or self.base_url,
        }

    # ------------------------------------------------------------- one node

    def _radios(self, base: str) -> dict[str, dict[str, Any]]:
        status = self.call("luci-rpc", "getWirelessDevices", base=base) or {}
        radios: dict[str, dict[str, Any]] = {}
        for radio_name, radio in status.items():
            config = radio.get("config") or {}
            band = config.get("band")
            if band not in BANDS or band in radios:
                continue
            access_point = mesh = None
            for iface in radio.get("interfaces") or []:
                mode = (iface.get("config") or {}).get("mode")
                if mode == "ap" and access_point is None:
                    access_point = iface
                elif mode == "mesh" and mesh is None:
                    mesh = iface
                elif mode == "sta" and (iface.get("config") or {}).get("wds") and mesh is None:
                    mesh = iface
            ap_config = (access_point or {}).get("config") or {}
            ap_info = (access_point or {}).get("iwinfo") or {}
            radio_info = radio.get("iwinfo") or {}
            family, width = _split_htmode(config.get("htmode"))
            supported = {str(m).upper() for m in radio_info.get("htmodes") or []}

            widths = ["20", "40"] if band == "2g" else ["20", "40", "80"]
            if any(m.endswith("160") for m in supported):
                widths.append("160")
            if width not in widths:
                widths.append(width)

            channels = {"auto": "Auto"}
            ifname = (access_point or {}).get("ifname")
            if ifname:
                listing = self.call("iwinfo", "freqlist", {"device": ifname}, base=base) or {}
                for item in listing.get("results") or []:
                    if not item.get("restricted"):
                        channels[str(item["channel"])] = f"{item['channel']} ({item['mhz']} MHz)"
            configured_channel = str(config.get("channel") or "auto")
            channels.setdefault(configured_channel, configured_channel)

            tx_power = "max"
            if config.get("txpower") not in (None, ""):
                ceiling = self._max_tx_power(ifname, base)
                backoff = (ceiling - int(config["txpower"])) if ceiling is not None else 0
                tx_power = "max" if backoff <= 1 else "medium" if backoff <= 4 else "low"

            radios[band] = {
                "radio": radio_name,
                "ifname": ifname,
                "section": (access_point or {}).get("section"),
                "mesh_ifname": (mesh or {}).get("ifname"),
                "mesh_mode": ((mesh or {}).get("config") or {}).get("mode"),
                "bssid": mac_colon(ap_info.get("bssid")),
                "ssid": ap_config.get("ssid") or ap_info.get("ssid"),
                "channel": ap_info.get("channel") or radio_info.get("channel"),
                "enabled": bool(access_point)
                and ap_config.get("disabled") != "1"
                and not radio.get("disabled"),
                "hidden": ap_config.get("hidden") == "1",
                "isolate": ap_config.get("isolate") == "1",
                "htmode": f"{family}{width}",
                "mode": PREFIX_MODE.get(family, "n"),
                "width": width,
                "channel_setting": configured_channel,
                "tx_power": tx_power,
                "options": {
                    "mode": dict(MODE_OPTIONS.get(band, MODE_OPTIONS["5g"])),
                    "width": {w: f"{w} MHz" for w in widths},
                    "channel": channels,
                    "tx_power": dict(TX_POWER_OPTIONS),
                },
            }
        return radios

    def _max_tx_power(self, ifname: str | None, base: str) -> int | None:
        if not ifname:
            return None
        levels = self.call("iwinfo", "txpowerlist", {"device": ifname}, base=base) or {}
        values = [item["dbm"] for item in levels.get("results") or [] if "dbm" in item]
        return max(values) if values else None

    def _stations(self, base: str, ifname: str | None) -> list[dict[str, Any]]:
        if not ifname:
            return []
        reply = self.call("iwinfo", "assoclist", {"device": ifname}, base=base) or {}
        return [s for s in reply.get("results") or [] if isinstance(s, dict)]

    def _leds(self, base: str) -> bool | None:
        leds = self.call("luci", "getLEDs", base=base)
        if not isinstance(leds, dict) or not leds:
            return None
        return any(
            (led.get("brightness") or 0) > 0 or led.get("active_trigger") not in (None, "none")
            for led in leds.values()
            if isinstance(led, dict)
        )

    def _cpu_usage(self, base: str, info: dict[str, Any], board: dict[str, Any]) -> float | None:
        text = (self.call("file", "read", {"path": "/proc/stat"}, base=base) or {}).get("data", "")
        fields = text.split("\n", 1)[0].split()[1:]
        if len(fields) >= 5:
            numbers = [int(x) for x in fields]
            now = (sum(numbers), numbers[3] + numbers[4])
            before = self._cpu.get(base)
            self._cpu[base] = now
            if before and now[0] > before[0]:
                busy = (now[0] - before[0]) - (now[1] - before[1])
                return round(max(0.0, min(100.0, 100.0 * busy / (now[0] - before[0]))), 1)
        # No right to read /proc/stat, or the first poll: fall back to the
        # one-minute load average (fixed point, 65536 per busy core).
        if info.get("load"):
            cores = 2 if "ARMv8" in str(board.get("system")) else 1
            return round(min(100.0, 100.0 * info["load"][0] / 65536 / cores), 1)
        return None

    def _node(self, address: str, base: str, is_main: bool) -> tuple[dict[str, Any], list[dict]]:
        """Everything about one access point, plus the stations attached to it."""
        board = self.call("system", "board", base=base, strict=True)
        info = self.call("system", "info", base=base) or {}
        radios = self._radios(base)
        lan_device = self.call("network.device", "status", {"name": "br-lan"}, base=base) or {}
        label = next((radios[b]["bssid"] for b in BANDS if b in radios and radios[b]["bssid"]), "")
        node_id = label or mac_colon(lan_device.get("macaddr"))
        if not node_id:
            raise OpenWrtError(f"{base} reports no hardware address")

        memory = info.get("memory") or {}
        ram = None
        if memory.get("total"):
            available = memory.get("available", memory.get("free", 0))
            ram = round(100.0 * (memory["total"] - available) / memory["total"], 1)
        release = board.get("release") or {}
        name = board.get("hostname") or address

        stations: list[dict[str, Any]] = []
        mesh = None
        for band, radio in radios.items():
            for station in self._stations(base, radio["ifname"]):
                stations.append(
                    {
                        "key": mac12(station.get("mac")),
                        "band": band,
                        "node_id": node_id,
                        "node": name,
                        "ifname": radio["ifname"],
                        "signal": station.get("signal"),
                        "inactive": station.get("inactive") or 0,
                        "connected": station.get("connected_time"),
                        "rx": (station.get("rx") or {}).get("bytes") or 0,
                        "tx": (station.get("tx") or {}).get("bytes") or 0,
                    }
                )
            if mesh is None and radio["mesh_ifname"]:
                peers = self._stations(base, radio["mesh_ifname"])
                if peers:
                    peer = max(peers, key=lambda s: s.get("signal") or -200)
                    mesh = {
                        "band": band,
                        "type": radio["mesh_mode"],
                        "signal": peer.get("signal"),
                        "tx_rate": round(((peer.get("tx") or {}).get("rate") or 0) / 1000),
                        "rx_rate": round(((peer.get("rx") or {}).get("rate") or 0) / 1000),
                        "peers": len(peers),
                    }

        node = {
            "id": node_id,
            "name": name,
            "host": address,
            "is_main": is_main,
            "online": True,
            "model": board.get("model"),
            "firmware": " ".join(
                str(x) for x in (release.get("distribution"), release.get("version")) if x
            ),
            "uptime": info.get("uptime"),
            "cpu": self._cpu_usage(base, info, board),
            "ram": ram,
            "leds": self._leds(base),
            "radios": radios,
            "mesh": mesh,
            "backhaul": None
            if is_main
            else (f"Wi-Fi {BAND_LABEL[mesh['band']]}" if mesh else "Ethernet"),
            "own_macs": [mac12(lan_device.get("macaddr")), mac12(node_id)],
            "local_time": datetime.fromtimestamp(info["localtime"], tz=timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
            if info.get("localtime")
            else None,
        }
        return node, stations

    # ------------------------------------------------------------- the poll

    def _external_ip(self, wan_ip: str | None) -> str | None:
        """The address the internet sees; differs when behind another router."""
        try:
            if wan_ip and ipaddress.ip_address(wan_ip).is_global:
                return wan_ip
        except ValueError:
            pass
        now = time.monotonic()
        if self._public_ip and now - self._public_ip[0] < PUBLIC_IP_MAX_AGE:
            return self._public_ip[1]
        try:
            text = requests.get(PUBLIC_IP_URL, timeout=5).text.strip()
            ipaddress.ip_address(text)
        except Exception:  # noqa: BLE001 - keep the last good answer
            return self._public_ip[1] if self._public_ip else None
        self._public_ip = (now, text)
        return text

    def _speed(self, key: str, rx: int, tx: int, now: float) -> tuple[float, float]:
        """(upload, download) in Mbit/s out of the byte counters of two polls."""
        previous = self._bytes.get(key)
        self._bytes[key] = (rx, tx, now)
        if previous is None:
            return 0.0, 0.0
        elapsed = now - previous[2]
        d_rx, d_tx = rx - previous[0], tx - previous[1]
        if elapsed <= 0 or d_rx < 0 or d_tx < 0:
            return 0.0, 0.0
        return round(d_rx * 8 / elapsed / 1e6, 3), round(d_tx * 8 / elapsed / 1e6, 3)

    def _discover(self) -> dict[str, str]:
        parsed = urllib.parse.urlsplit(self.base_url)
        for key in self.call("usteer", "remote_info") or {}:
            address = str(key).split("#", 1)[0]
            try:
                ipaddress.ip_address(address)
            except ValueError:
                continue
            self._node_urls.setdefault(address, f"{parsed.scheme}://{address}")
        return dict(self._node_urls)

    def collect(self) -> dict[str, Any]:
        """Read the whole network. Raises when the main router does not answer."""
        now = time.monotonic()
        main_address = urllib.parse.urlsplit(self.base_url).hostname or self.base_url
        main, stations = self._node(main_address, self.base_url, True)
        nodes = {main["id"]: main}

        for address, node_base in self._discover().items():
            try:
                node, node_stations = self._node(address, node_base, False)
            except AuthError:
                _LOGGER.warning("OpenWrt node %s refused the credentials", address)
                node = None
            except Exception as err:  # noqa: BLE001 - a node may simply be off
                _LOGGER.debug("OpenWrt node %s did not answer: %s", address, err)
                self._sessions.pop(node_base, None)
                node = None
            if node is None:
                known = next(
                    (n for n in self._known_nodes.values() if n["host"] == address), None
                )
                if known is None:
                    continue
                node = {**known, "online": False, "mesh": None, "cpu": None, "ram": None,
                        "uptime": None}
                node_stations = []
            nodes[node["id"]] = node
            stations += node_stations
        self._known_nodes = {k: v for k, v in nodes.items() if not v["is_main"]}

        interfaces = {
            item.get("interface"): item
            for item in (self.call("network.interface", "dump") or {}).get("interface") or []
        }
        wan, lan = interfaces.get("wan") or {}, interfaces.get("lan") or {}
        wan_device = (
            self.call("network.device", "status", {"name": wan.get("l3_device") or "eth0"}) or {}
        )
        dhcp = ((self.call("uci", "get", {"config": "dhcp"}) or {}).get("values") or {}).get(
            "lan"
        ) or {}
        firewall = (self.call("uci", "get", {"config": "firewall"}) or {}).get("values") or {}
        blocked = {
            name[len(BLOCK_RULE_PREFIX):]
            for name, section in firewall.items()
            if name.startswith(BLOCK_RULE_PREFIX) and section.get("enabled") != "0"
        }
        leases = (self.call("luci-rpc", "getDHCPLeases") or {}).get("dhcp_leases") or []
        hints = self.call("luci-rpc", "getHostHints") or {}
        neighbours = (
            self.call("file", "exec", {"command": "/sbin/ip", "params": ["-4", "neigh", "show"]})
            or {}
        ).get("stdout", "")

        addresses: dict[str, str] = {}
        names: dict[str, str] = {}
        for mac, hint in hints.items():
            if hint.get("ipaddrs"):
                addresses[mac12(mac)] = hint["ipaddrs"][0]
            if hint.get("name"):
                names[mac12(mac)] = str(hint["name"]).split(".")[0]
        for lease in leases:
            if lease.get("ipaddr"):
                addresses[mac12(lease.get("macaddr"))] = lease["ipaddr"]
            if lease.get("hostname"):
                names[mac12(lease.get("macaddr"))] = lease["hostname"]

        own = {m for node in nodes.values() for m in node["own_macs"]}
        own.add(mac12(wan_device.get("macaddr")))

        # A client that just moved shows up on two nodes for a moment: the
        # node that heard from it last is the one it is really on.
        best: dict[str, dict[str, Any]] = {}
        for station in stations:
            key = station["key"]
            if len(key) != 12 or key in own:
                continue
            if key not in best or station["inactive"] < best[key]["inactive"]:
                best[key] = station

        clients: dict[str, dict[str, Any]] = {}
        for key, station in best.items():
            up, down = self._speed(key, station["rx"], station["tx"], now)
            clients[key] = {
                "mac": mac_colon(key),
                "name": names.get(key) or mac_colon(key),
                "named": key in names,
                "ip": addresses.get(key),
                "node_id": station["node_id"],
                "node": station["node"],
                "ifname": station["ifname"],
                "band": station["band"],
                "connection": BAND_LABEL[station["band"]],
                "signal": station["signal"],
                "connected": station["connected"],
                "up": up,
                "down": down,
                # Megabytes since the client joined this access point: the
                # counters start again whenever it reconnects or changes node.
                "used_down": round(station["tx"] / 1048576, 1),
                "used_up": round(station["rx"] / 1048576, 1),
                "blocked": key in blocked,
            }

        lan_port = lan.get("l3_device") or "br-lan"
        arp_entries = 0
        for line in neighbours.splitlines():
            match = re.match(r"(\S+)\s+dev\s+(\S+)\s+lladdr\s+(\S+).*\s(\S+)$", line.strip())
            if not match or match.group(2) != lan_port:
                continue
            arp_entries += 1
            address, _port, mac, state = match.groups()
            key = mac12(mac)
            if key not in clients and key not in own and state in (
                "REACHABLE", "DELAY", "PROBE", "PERMANENT",
            ):
                self._wired[key] = (now, address)
        for key, (seen_at, address) in list(self._wired.items()):
            if key in clients or key in own or now - seen_at > WIRED_GRACE:
                self._wired.pop(key, None)
                continue
            clients[key] = {
                "mac": mac_colon(key),
                "name": names.get(key) or mac_colon(key),
                "named": key in names,
                "ip": addresses.get(key) or address,
                "node_id": main["id"],
                "node": main["name"],
                "ifname": None,
                "band": "wired",
                "connection": "Ethernet",
                "signal": None,
                "connected": None,
                "up": 0.0,
                "down": 0.0,
                "used_down": None,
                "used_up": None,
                "blocked": key in blocked,
            }
        for gone in set(self._bytes) - set(best):
            self._bytes.pop(gone, None)

        for node in nodes.values():
            members = [c for c in clients.values() if c["node_id"] == node["id"]]
            node["clients"] = len(members)
            node["clients_2g"] = sum(c["band"] == "2g" for c in members)
            node["clients_5g"] = sum(c["band"] == "5g" for c in members)
            node["clients_wired"] = sum(c["band"] == "wired" for c in members)

        lan_address = (lan.get("ipv4-address") or [{}])[0]
        wan_address = (wan.get("ipv4-address") or [{}])[0]
        statistics = wan_device.get("statistics") or {}
        megabyte = 1024 * 1024
        dhcp_start = dhcp_end = None
        try:
            network = ipaddress.ip_network(
                f"{lan_address['address']}/{lan_address['mask']}", strict=False
            )
            first = int(network.network_address) + int(dhcp.get("start", 100))
            dhcp_start = str(ipaddress.ip_address(first))
            dhcp_end = str(ipaddress.ip_address(first + int(dhcp.get("limit", 150)) - 1))
        except (KeyError, ValueError):
            pass

        everyone = list(clients.values())
        top_down = max(everyone, key=lambda c: c["down"], default=None)
        top_up = max(everyone, key=lambda c: c["up"], default=None)
        self.snapshot = {
            "main": main["id"],
            "nodes": nodes,
            "clients": clients,
            "network": {
                "wan_up": bool(wan.get("up")),
                "wan_protocol": str(wan.get("proto") or "").upper() or None,
                "wan_uptime": wan.get("uptime") if wan.get("up") else 0,
                "wan_ip": wan_address.get("address"),
                "public_ip": self._external_ip(wan_address.get("address")),
                "gateway": next(
                    (
                        r.get("nexthop")
                        for r in wan.get("route") or []
                        if r.get("target") == "0.0.0.0"
                    ),
                    None,
                ),
                "dns": list(wan.get("dns-server") or []),
                "download_mb": round(statistics.get("rx_bytes", 0) / megabyte, 2),
                "upload_mb": round(statistics.get("tx_bytes", 0) / megabyte, 2),
                "lan_ip": lan_address.get("address"),
                "netmask": _netmask(lan_address.get("mask")),
                "dhcp_start": dhcp_start,
                "dhcp_end": dhcp_end,
                "dhcp_lease": _lease_seconds(dhcp.get("leasetime")),
                "arp_entries": arp_entries,
            },
            "totals": {
                "clients": len(everyone),
                "wifi_2g": sum(c["band"] == "2g" for c in everyone),
                "wifi_5g": sum(c["band"] == "5g" for c in everyone),
                "wired": sum(c["band"] == "wired" for c in everyone),
                "down": round(sum(c["down"] for c in everyone), 3),
                "up": round(sum(c["up"] for c in everyone), 3),
                "top_down": top_down and {k: top_down[k] for k in ("name", "mac", "down")},
                "top_up": top_up and {k: top_up[k] for k in ("name", "mac", "up")},
            },
        }
        return self.snapshot

    # --------------------------------------------------------------- actions

    def _base(self, node_id: str) -> str:
        node = (self.snapshot.get("nodes") or {}).get(node_id)
        if node is None:
            raise OpenWrtError(f"unknown node {node_id}")
        if node["is_main"]:
            return self.base_url
        return self._node_urls[node["host"]]

    def passthrough(self, node_id: str, obj: str, method: str, args: dict | None) -> Any:
        """One call on one node, for the app's own pages. The caller checks it is allowed."""
        return self.call(obj, method, args, base=self._base(node_id), strict=True, timeout=40)

    def _ordered_nodes(self) -> list[str]:
        """Satellites first, so a change that cuts the link reaches them all."""
        nodes = self.snapshot.get("nodes") or {}
        return [i for i, n in nodes.items() if not n["is_main"] and n["online"]] + [
            i for i, n in nodes.items() if n["is_main"]
        ]

    def reboot(self, node_id: str) -> None:
        base = self._base(node_id)
        try:
            # LuCI's own reboot button runs this command, so the right to do
            # it is there on any router with the web interface installed.
            self.call("file", "exec", {"command": "/sbin/reboot"}, base=base, strict=True)
        except requests.exceptions.RequestException:
            pass  # the router may drop the connection as it goes down
        self._sessions.pop(base, None)

    def restart_radio(self, node_id: str, band: str) -> None:
        base = self._base(node_id)
        radio = self._radios(base).get(band)
        if not radio:
            raise OpenWrtError(f"no {band} radio on this node")
        self.call("network.wireless", "down", {"radio": radio["radio"]}, base=base, strict=True)
        time.sleep(4)
        self.call("network.wireless", "up", {"radio": radio["radio"]}, base=base, strict=True)

    def set_radio(self, node_id: str | None, band: str, setting: str, value: Any) -> None:
        """Change one wireless setting on one node, or on all when node_id is None."""
        if setting not in RADIO_SETTINGS:
            raise OpenWrtError(f"unknown setting {setting}")
        targets = [node_id] if node_id else self._ordered_nodes()
        errors = []
        for target in targets:
            try:
                self._apply_radio(self._base(target), band, setting, value)
            except Exception as err:  # noqa: BLE001
                errors.append(f"{target}: {err}")
        if errors:
            raise OpenWrtError("; ".join(errors))

    def _apply_radio(self, base: str, band: str, setting: str, value: Any) -> None:
        radio = self._radios(base).get(band)
        if not radio:
            raise OpenWrtError(f"no {band} radio")
        family, width = _split_htmode(radio["htmode"])

        def uci_set(section: str | None, values: dict[str, str]) -> None:
            if not section:
                raise OpenWrtError("no access point on this radio")
            self.call(
                "uci", "set", {"config": "wireless", "section": section, "values": values},
                base=base, strict=True,
            )

        if setting == "enabled":
            uci_set(radio["section"], {"disabled": "0" if value else "1"})
        elif setting in ("hidden", "isolate"):
            uci_set(radio["section"], {setting: "1" if value else "0"})
        elif setting == "mode":
            if value not in MODE_PREFIX:
                raise OpenWrtError(f"unknown mode {value}")
            if value == "n" and width not in ("20", "40"):
                width = "40"
            uci_set(radio["radio"], {"htmode": f"{MODE_PREFIX[value]}{width}"})
        elif setting == "width":
            new_width = re.sub(r"\D", "", str(value))
            if new_width not in ("20", "40", "80", "160"):
                raise OpenWrtError(f"unknown width {value}")
            if family == "HT" and new_width not in ("20", "40"):
                family = "VHT"
            uci_set(radio["radio"], {"htmode": f"{family}{new_width}"})
        elif setting == "channel":
            uci_set(radio["radio"], {"channel": str(value)})
        elif setting == "tx_power":
            if value not in TX_POWER_BACKOFF:
                raise OpenWrtError(f"unknown power level {value}")
            if value == "max":
                self.call(
                    "uci", "delete",
                    {"config": "wireless", "section": radio["radio"], "options": ["txpower"]},
                    base=base,
                )
            else:
                ceiling = self._max_tx_power(radio["ifname"], base)
                if ceiling is None:
                    raise OpenWrtError("the radio does not report its power levels")
                uci_set(radio["radio"], {"txpower": str(max(1, ceiling - TX_POWER_BACKOFF[value]))})

        self.call("uci", "commit", {"config": "wireless"}, base=base, strict=True)
        self.call("network", "reload", base=base, strict=True)
        # A radio that also carries the link between nodes does not bring its
        # access point back after a reload; restarting the radio does.
        if radio["mesh_ifname"]:
            time.sleep(3)
            self.call("network.wireless", "down", {"radio": radio["radio"]}, base=base)
            time.sleep(4)
            self.call("network.wireless", "up", {"radio": radio["radio"]}, base=base)

    def block_client(self, mac: str, blocked: bool, label: str | None = None) -> None:
        """Cut or restore a client's way out to the internet with a firewall rule."""
        key = mac12(mac)
        if len(key) != 12:
            raise OpenWrtError("not a hardware address")
        section = f"{BLOCK_RULE_PREFIX}{key}"
        self.call("uci", "delete", {"config": "firewall", "section": section})
        if blocked:
            self.call(
                "uci", "add",
                {
                    "config": "firewall",
                    "type": "rule",
                    "name": section,
                    "values": {
                        "name": f"Block internet {label or mac_colon(key)}"[:60],
                        "src": "lan",
                        "dest": "wan",
                        "src_mac": mac_colon(key),
                        "proto": "all",
                        "target": "REJECT",
                    },
                },
                strict=True,
            )
        self.call("uci", "commit", {"config": "firewall"}, strict=True)
        self.call("rc", "init", {"name": "firewall", "action": "reload"}, strict=True)

    def kick_client(self, mac: str, ban_seconds: int = 0) -> None:
        """Disconnect a wireless client; it reconnects to the node it hears best."""
        client = (self.snapshot.get("clients") or {}).get(mac12(mac))
        if not client or not client.get("ifname"):
            raise OpenWrtError("the client is not connected over Wi-Fi")
        self.call(
            f"hostapd.{client['ifname']}", "del_client",
            {
                "addr": client["mac"].lower(),
                "reason": 5,
                "deauth": True,
                "ban_time": max(0, int(ban_seconds)) * 1000,
            },
            base=self._base(client["node_id"]),
            strict=True,
        )

    def move_client(self, mac: str, node_id: str) -> None:
        """Send a wireless client to one node.

        Every other node disconnects it and turns it away for a minute, so the
        only access point that answers is the chosen one. Nothing is fixed for
        good: afterwards the client is free to roam again.
        """
        nodes = self.snapshot.get("nodes") or {}
        target = nodes.get(node_id)
        if target is None or not target.get("online"):
            raise OpenWrtError("the chosen node is not reachable")
        address = mac_colon(mac12(mac)).lower()
        if not address:
            raise OpenWrtError("not a hardware address")
        for other_id, node in nodes.items():
            if other_id == node_id or not node.get("online"):
                continue
            base = self._base(other_id)
            for radio in (node.get("radios") or {}).values():
                if radio.get("ifname"):
                    self.call(
                        f"hostapd.{radio['ifname']}", "del_client",
                        {"addr": address, "reason": 5, "deauth": True, "ban_time": MOVE_BAN * 1000},
                        base=base,
                    )

    def set_leds(self, node_id: str, enabled: bool) -> None:
        base = self._base(node_id)
        leds = self.call("luci", "getLEDs", base=base, strict=True)

        def write(name: str, attribute: str, text: str) -> None:
            self.call(
                "file", "write",
                {"path": f"/sys/class/leds/{name}/{attribute}", "data": text},
                base=base, strict=True,
            )

        if not enabled:
            snapshot = {
                name: (led.get("active_trigger") or "none", int(led.get("brightness") or 0))
                for name, led in leds.items()
            }
            if any(trigger != "none" or level > 0 for trigger, level in snapshot.values()):
                self._led_snapshots[base] = snapshot
            for name in leds:
                write(name, "trigger", "none")
                write(name, "brightness", "0")
            return

        snapshot = self._led_snapshots.get(base)
        if snapshot:
            for name, (trigger, level) in snapshot.items():
                write(name, "trigger", trigger)
                if trigger == "none":
                    write(name, "brightness", str(level))
            return
        # No memory of how they were: what a freshly booted router shows,
        # radio activity plus one steady status light.
        self.call("rc", "init", {"name": "led", "action": "restart"}, base=base)
        steady = False
        for name, led in leds.items():
            radio = re.search(r"phy(\d+)", name)
            if radio:
                write(name, "trigger", f"phy{radio.group(1)}tpt")
            elif not steady and "red" not in name and re.search(r"online|power|status|sys", name):
                write(name, "brightness", str(led.get("max_brightness") or 1))
                steady = True
