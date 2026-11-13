"""The ubus client, against canned router replies (no Home Assistant needed)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import pytest

_PATH = Path(__file__).resolve().parent.parent / "custom_components" / "openwrt_router" / "api.py"
_SPEC = importlib.util.spec_from_file_location("openwrt_router_api", _PATH)
api = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = api
_SPEC.loader.exec_module(api)

MAIN = "http://192.168.50.1"
NODE = "http://192.168.50.2"
MAIN_ID = "80:AF:CA:00:00:01"
NODE_ID = "80:AF:CA:00:00:10"


def _station(mac: str, signal: int, rx: int = 0, tx: int = 0, inactive: int = 10) -> dict[str, Any]:
    return {
        "mac": mac,
        "signal": signal,
        "inactive": inactive,
        "connected_time": 3600,
        "rx": {"bytes": rx, "rate": 648000},
        "tx": {"bytes": tx, "rate": 865000},
    }


def _radios(bssid: str, channel_2g: str, mesh: bool = True) -> dict[str, Any]:
    five = [
        {
            "section": "default_radio1",
            "ifname": "phy1-ap0",
            "config": {"mode": "ap", "ssid": "home_5G", "key": "never-shown"},
            "iwinfo": {"channel": 36, "bssid": "82:AF:CA:00:00:FF"},
        }
    ]
    if mesh:
        five.append({"section": "mesh", "ifname": "phy1-mesh0", "config": {"mode": "mesh"}})
    return {
        "radio0": {
            "disabled": False,
            "config": {"band": "2g", "channel": channel_2g, "htmode": "HT20"},
            "iwinfo": {"channel": int(channel_2g), "htmodes": ["HT20", "HT40", "HE20"]},
            "interfaces": [
                {
                    "section": "default_radio0",
                    "ifname": "phy0-ap0",
                    "config": {"mode": "ap", "ssid": "home", "hidden": "1"},
                    "iwinfo": {"channel": int(channel_2g), "bssid": bssid},
                }
            ],
        },
        "radio1": {
            "disabled": False,
            "config": {"band": "5g", "channel": "auto", "htmode": "HE80", "txpower": "20"},
            "iwinfo": {"channel": 36, "htmodes": ["HT20", "VHT80", "HE80"]},
            "interfaces": five,
        },
    }


class Fake(api.OpenWrtApi):
    """An OpenWrtApi whose ubus calls are answered from a table."""

    def __init__(self) -> None:
        super().__init__(MAIN, "root", "secret")
        self.calls: list[tuple[str, str, str, dict]] = []
        self.node_down = False
        self.stations = {
            (MAIN, "phy0-ap0"): [_station("AA:BB:CC:00:00:01", -50, 1_000_000, 2_000_000)],
            (NODE, "phy0-ap0"): [_station("AA:BB:CC:00:00:02", -60)],
            (NODE, "phy1-mesh0"): [_station("86:AF:CA:00:00:01", -64)],
            (MAIN, "phy1-mesh0"): [_station("86:AF:CA:00:00:10", -66)],
        }

    def call(self, obj, method, args=None, *, base=None, default=None, strict=False):  # noqa: ANN001
        base = base or self.base_url
        args = args or {}
        if base == NODE and self.node_down:
            raise api.OpenWrtError("unreachable")
        self.calls.append((base, obj, method, args))
        key = f"{obj}.{method}"
        if key == "system.board":
            return {
                "hostname": "Salotto" if base == MAIN else "Ufficio",
                "model": "Cudy M3000 v1/v2",
                "system": "ARMv8 Processor rev 4",
                "release": {"distribution": "OpenWrt", "version": "25.12.6"},
            }
        if key == "system.info":
            return {"uptime": 3600, "localtime": 1794565502, "load": [32768, 0, 0],
                    "memory": {"total": 200, "available": 50}}
        if key == "network.interface.dump":
            return {
                "interface": [
                    {
                        "interface": "wan", "up": True, "uptime": 120, "proto": "dhcp",
                        "l3_device": "eth0",
                        "ipv4-address": [{"address": "8.8.4.4", "mask": 24}],
                        "route": [{"target": "0.0.0.0", "nexthop": "8.8.4.1"}],
                        "dns-server": ["192.168.50.165", "1.1.1.1"],
                    },
                    {"interface": "lan", "l3_device": "br-lan",
                     "ipv4-address": [{"address": "192.168.50.1", "mask": 24}]},
                ]
            }
        if key == "network.device.status":
            if args.get("name") == "eth0":
                return {"macaddr": "80:af:ca:00:00:02",
                        "statistics": {"rx_bytes": 2 * 1024 * 1024, "tx_bytes": 1024 * 1024}}
            return {"macaddr": "80:af:ca:00:00:03" if base == MAIN else "80:af:ca:00:00:11"}
        if key == "uci.get" and args.get("config") == "dhcp":
            return {"values": {"lan": {"start": "10", "limit": "241", "leasetime": "2h"}}}
        if key == "uci.get" and args.get("config") == "firewall":
            return {"values": {"habrk_aabbcc000002": {"target": "REJECT"}}}
        if key == "luci-rpc.getDHCPLeases":
            return {"dhcp_leases": [
                {"macaddr": "AA:BB:CC:00:00:01", "ipaddr": "192.168.50.20", "hostname": "phone"}]}
        if key == "luci-rpc.getHostHints":
            return {"AA:BB:CC:00:00:09": {"ipaddrs": ["192.168.50.165"], "name": "ha.lan"}}
        if key == "file.exec":
            return {"stdout": (
                "192.168.50.165 dev br-lan lladdr aa:bb:cc:00:00:09 ref 1 REACHABLE\n"
                "192.168.50.20 dev br-lan lladdr aa:bb:cc:00:00:01 used 0/0/0 STALE\n"
                "8.8.4.1 dev eth0 lladdr aa:bb:cc:00:00:77 used 0/0/0 REACHABLE\n"
                "192.168.50.99 dev br-lan  used 0/0/0 probes 6 FAILED\n")}
        if key == "file.read":
            return {"data": "cpu  100 0 100 800 0 0 0 0 0 0\n"}
        if key == "luci-rpc.getWirelessDevices":
            return _radios(MAIN_ID if base == MAIN else NODE_ID, "11" if base == MAIN else "1")
        if key == "iwinfo.assoclist":
            return {"results": self.stations.get((base, args.get("device")), [])}
        if key == "iwinfo.freqlist":
            return {"results": [{"channel": 36, "mhz": 5180, "restricted": False},
                                {"channel": 52, "mhz": 5260, "restricted": True}]}
        if key == "iwinfo.txpowerlist":
            return {"results": [{"dbm": 0}, {"dbm": 23}]}
        if key == "luci.getLEDs":
            return {"white:status": {"active_trigger": "none", "brightness": 1}}
        if key == "usteer.remote_info":
            return {"192.168.50.2#hostapd.phy0-ap0": {}, "192.168.50.2#hostapd.phy1-ap0": {}}
        return default


@pytest.fixture
def router(monkeypatch) -> Fake:
    monkeypatch.setattr(api.time, "sleep", lambda _seconds: None)
    return Fake()


def test_snapshot_describes_nodes_clients_and_network(router: Fake) -> None:
    data = router.collect()

    assert data["main"] == MAIN_ID
    assert set(data["nodes"]) == {MAIN_ID, NODE_ID}
    main, node = data["nodes"][MAIN_ID], data["nodes"][NODE_ID]
    assert (main["name"], main["is_main"], main["backhaul"]) == ("Salotto", True, None)
    assert (node["name"], node["host"], node["backhaul"]) == ("Ufficio", "192.168.50.2", "Wi-Fi 5 GHz")
    assert node["mesh"] == {"band": "5g", "type": "mesh", "signal": -64, "tx_rate": 865,
                            "rx_rate": 648, "peers": 1}
    assert main["ram"] == 75.0
    assert main["firmware"] == "OpenWrt 25.12.6"
    assert main["leds"] is True
    assert (main["clients"], main["clients_2g"], main["clients_wired"]) == (2, 1, 1)
    assert node["clients"] == 1

    clients = data["clients"]
    assert set(clients) == {"aabbcc000001", "aabbcc000002", "aabbcc000009"}
    phone = clients["aabbcc000001"]
    assert (phone["name"], phone["ip"], phone["node"]) == ("phone", "192.168.50.20", "Salotto")
    assert (phone["band"], phone["signal"], phone["ifname"]) == ("2g", -50, "phy0-ap0")
    assert phone["blocked"] is False
    assert clients["aabbcc000002"]["blocked"] is True
    assert clients["aabbcc000002"]["name"] == "AA:BB:CC:00:00:02"
    assert clients["aabbcc000009"]["band"] == "wired"
    assert clients["aabbcc000009"]["name"] == "ha"

    network = data["network"]
    assert network["wan_up"] is True
    assert network["public_ip"] == "8.8.4.4"
    assert network["gateway"] == "8.8.4.1"
    assert network["download_mb"] == 2.0
    assert (network["dhcp_start"], network["dhcp_end"]) == ("192.168.50.10", "192.168.50.250")
    assert network["dhcp_lease"] == 7200
    assert network["arp_entries"] == 2
    assert data["totals"]["clients"] == 3
    assert data["totals"]["wired"] == 1


def test_radio_settings_and_their_choices(router: Fake) -> None:
    radios = router.collect()["nodes"][MAIN_ID]["radios"]
    two, five = radios["2g"], radios["5g"]
    assert (two["ssid"], two["channel"], two["hidden"], two["mode"], two["width"]) == (
        "home", 11, True, "n", "20")
    assert (five["mode"], five["width"], five["channel_setting"], five["tx_power"]) == (
        "ax", "80", "auto", "medium")
    assert five["options"]["channel"] == {"auto": "Auto", "36": "36 (5180 MHz)"}
    assert five["mesh_ifname"] == "phy1-mesh0"
    for setting in ("mode", "width", "tx_power"):
        assert five[setting] in five["options"][setting]
    # The Wi-Fi password is part of what the router returns; it must not travel on.
    assert "never-shown" not in repr(router.collect())


def test_client_seen_on_two_nodes_belongs_to_the_one_that_heard_it_last(router: Fake) -> None:
    router.stations[(MAIN, "phy0-ap0")].append(_station("AA:BB:CC:00:00:02", -80, inactive=900))
    assert router.collect()["clients"]["aabbcc000002"]["node"] == "Ufficio"


def test_node_that_stops_answering_stays_listed_as_offline(router: Fake) -> None:
    router.collect()
    router.node_down = True
    data = router.collect()
    node = data["nodes"][NODE_ID]
    assert (node["online"], node["name"], node["clients"]) == (False, "Ufficio", 0)
    assert "aabbcc000002" not in data["clients"]


def test_speed_comes_from_the_counters_of_two_polls(router: Fake) -> None:
    assert router._speed("aa", 0, 0, 100.0) == (0.0, 0.0)
    assert router._speed("aa", 1_250_000, 2_500_000, 110.0) == (1.0, 2.0)
    assert router._speed("aa", 10, 10, 120.0) == (0.0, 0.0)


def test_shared_setting_goes_to_satellites_first_and_restarts_the_mesh_radio(router: Fake) -> None:
    router.collect()
    router.calls.clear()
    router.set_radio(None, "5g", "width", "40")
    written = [c for c in router.calls if c[1:3] == ("uci", "set")]
    assert [c[0] for c in written] == [NODE, MAIN]
    assert all(c[3]["values"] == {"htmode": "HE40"} for c in written)
    assert [c[2] for c in router.calls if c[1] == "network.wireless"] == ["down", "up"] * 2


def test_per_node_setting_touches_only_that_node(router: Fake) -> None:
    router.collect()
    router.calls.clear()
    router.set_radio(NODE_ID, "2g", "channel", "6")
    written = [c for c in router.calls if c[1:3] == ("uci", "set")]
    assert [(c[0], c[3]["values"]) for c in written] == [(NODE, {"channel": "6"})]
    assert not [c for c in router.calls if c[1] == "network.wireless"]


def test_unknown_choices_are_refused(router: Fake) -> None:
    router.collect()
    with pytest.raises(api.OpenWrtError):
        router.set_radio(None, "5g", "width", "35")
    with pytest.raises(api.OpenWrtError):
        router.set_radio(None, "5g", "password", "x")


def test_blocking_writes_one_named_firewall_rule(router: Fake) -> None:
    router.block_client("AA-BB-CC-00-00-01", True, "phone")
    added = [c for c in router.calls if c[1:3] == ("uci", "add")]
    assert added[0][3]["name"] == "habrk_aabbcc000001"
    assert added[0][3]["values"]["src_mac"] == "AA:BB:CC:00:00:01"
    router.calls.clear()
    router.block_client("AA:BB:CC:00:00:01", False)
    assert not [c for c in router.calls if c[1:3] == ("uci", "add")]
    assert [c[3]["section"] for c in router.calls if c[1:3] == ("uci", "delete")] == [
        "habrk_aabbcc000001"]


def test_kick_goes_to_the_access_point_the_client_is_on(router: Fake) -> None:
    router.collect()
    router.calls.clear()
    router.kick_client("aa:bb:cc:00:00:02", 30)
    assert router.calls == [(NODE, "hostapd.phy0-ap0", "del_client", {
        "addr": "aa:bb:cc:00:00:02", "reason": 5, "deauth": True, "ban_time": 30000})]
    with pytest.raises(api.OpenWrtError):
        router.kick_client("aa:bb:cc:00:00:09")  # wired


def test_expired_session_logs_in_again(monkeypatch) -> None:
    router = api.OpenWrtApi(MAIN, "root", "secret")
    seen: list[str] = []

    def post(base, session, obj, method, args):  # noqa: ANN001
        seen.append(f"{session[:3]}:{obj}.{method}")
        if obj == "session":
            return {"result": [0, {"ubus_rpc_session": "new" + "0" * 29}]}
        if session.startswith("old"):
            return {"error": {"code": -32002, "message": "Access denied"}}
        return {"result": [0, {"hostname": "Salotto"}]}

    monkeypatch.setattr(router, "_post", post)
    router._sessions[MAIN] = "old" + "0" * 29
    assert router.call("system", "board") == {"hostname": "Salotto"}
    assert seen == ["old:system.board", "000:session.login", "new:system.board"]


def test_refused_login_is_reported_as_such(monkeypatch) -> None:
    router = api.OpenWrtApi(MAIN, "root", "wrong")
    monkeypatch.setattr(router, "_post", lambda *a: {"result": [6]})
    assert router.authenticate() is False
    with pytest.raises(api.AuthError):
        router.call("system", "board")
