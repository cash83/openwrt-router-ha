"""Which router calls the app may relay through Home Assistant."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "custom_components" / "openwrt_router" / "passthrough.py"
_SPEC = importlib.util.spec_from_file_location("passthrough", _PATH)
passthrough = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = passthrough
_SPEC.loader.exec_module(passthrough)
allowed = passthrough.allowed


def test_reading_and_the_pages_own_changes_pass() -> None:
    assert allowed("system", "board", {})
    assert allowed("rc", "list", None)
    assert allowed("rc", "init", {"name": "dnsmasq", "action": "restart"})
    assert allowed("uci", "get", {"config": "dhcp"})
    assert allowed("uci", "add", {"config": "firewall", "type": "redirect", "values": {}})
    assert allowed("file", "read", {"path": "/etc/crontabs/root"})
    assert allowed("file", "write", {"path": "/etc/crontabs/root", "data": "# nothing\n"})
    assert allowed("file", "exec", {"command": "/usr/libexec/syslog-wrapper"})
    assert allowed("file", "exec", {"command": "/bin/ping", "params": ["-c", "4", "-W", "2", "openwrt.org"]})


def test_nothing_that_holds_a_password() -> None:
    assert not allowed("uci", "get", {"config": "wireless"})
    assert not allowed("uci", "get", {"config": "network"})
    assert not allowed("uci", "get", {})
    assert not allowed("file", "read", {"path": "/etc/shadow"})
    assert not allowed("file", "read", {"path": "/etc/config/wireless"})
    assert not allowed("luci", "setPassword", {"username": "root", "password": "x"})
    assert not allowed("session", "login", {})


def test_no_command_with_free_arguments() -> None:
    assert not allowed("file", "exec", {"command": "/bin/sh", "params": ["-c", "reboot"]})
    assert not allowed("file", "exec", {"command": "/bin/ping", "params": ["-c", "4", "-W", "2", "-f"]})
    assert not allowed("file", "exec", {"command": "/bin/ping", "params": ["-c", "4", "-W", "2", "a b"]})
    assert not allowed("file", "exec", {"command": "/bin/ping", "params": ["-c", "9999", "-W", "2", "host"]})
    assert not allowed("file", "exec", {"command": "/bin/ping", "params": "host"})
    assert not allowed("file", "exec", {"command": "/sbin/ip", "params": ["link", "set", "br-lan", "down"]})
    assert not allowed("file", "exec", {"command": "/bin/ping", "params": ["-c", "4", "-W", "2", "h"], "env": {}})
    assert not allowed("file", "write", {"path": "/etc/crontabs/root", "data": 5})
    assert allowed("file", "read", {"path": "/etc/apk/world"})
    assert not allowed("file", "write", {"path": "/etc/apk/world", "data": "x"})
    assert allowed("file", "exec", {"command": "/usr/bin/apk", "params": ["search", "nlbwmon"]})
    assert allowed("file", "exec", {"command": "/usr/libexec/package-manager-call", "params": ["install", "luci-app-nlbwmon"]})
    assert not allowed("file", "exec", {"command": "/usr/libexec/package-manager-call", "params": ["install", "--force-broken-world"]})
    assert not allowed("file", "exec", {"command": "/usr/libexec/package-manager-call", "params": ["install", "a", "b"]})
    assert not allowed("file", "exec", {"command": "/usr/bin/apk", "params": ["del", "busybox"]})
    assert not allowed("rc", "init", {"name": "x; reboot", "action": "start"})
    assert not allowed("rc", "init", {"name": "cron", "action": "explode"})
