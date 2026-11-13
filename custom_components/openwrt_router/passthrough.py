"""Which router calls the app's own pages may make through Home Assistant.

The app draws the router's sections (log, DHCP, port forwards, services,
diagnostics) itself and reads them with plain ubus calls. Through Home
Assistant those calls are relayed, and only the ones listed here: nothing that
returns a password (wireless and network configuration are left out) and no
command with free arguments.
"""

from __future__ import annotations

import re
from typing import Any

UBUS = {
    "system": {"board", "info"},
    "network.interface": {"dump"},
    "network.device": {"status"},
    "luci-rpc": {"getDHCPLeases", "getHostHints", "getNetworkDevices"},
    "luci": {"getProcessList", "getMountPoints", "getUnixtime", "getTimezones"},
    "iwinfo": {"scan", "info"},
    "usteer": {"local_info", "remote_info", "get_clients"},
    "rc": {"list", "init"},
}

UCI_METHODS = {"get", "set", "add", "delete", "commit"}
UCI_CONFIGS = {"dhcp", "firewall", "system"}
RC_ACTIONS = {"start", "stop", "restart", "reload", "enable", "disable"}
WRITABLE = {"/etc/crontabs/root"}
READABLE = WRITABLE | {"/etc/apk/world"}

_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$")
_NAME = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_PACKAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]{0,80}$")

# command -> fixed arguments; "<host>" stands for one host name or address,
# "<package>" for one package name.
COMMANDS = {
    "/usr/libexec/syslog-wrapper": [[]],
    "/bin/dmesg": [["-r"]],
    "/sbin/ip": [["-4", "route", "show", "table", "all"]],
    "/bin/ping": [["-c", "4", "-W", "2", "<host>"]],
    "/bin/traceroute": [["-m", "12", "-q", "1", "-w", "1", "-n", "<host>"]],
    "/usr/bin/nslookup": [["<host>"]],
    "/usr/bin/apk": [["search", "<package>"]],
    "/usr/libexec/package-manager-call": [
        ["update"], ["install", "<package>"], ["remove", "<package>"],
    ],
}


def _command_allowed(command: Any, params: Any) -> bool:
    shapes = COMMANDS.get(command)
    if shapes is None:
        return False
    params = [] if params is None else params
    if not isinstance(params, list) or not all(isinstance(p, str) for p in params):
        return False
    for shape in shapes:
        if len(shape) != len(params):
            continue
        if all(
            bool(_HOST.match(given)) if wanted == "<host>"
            else bool(_PACKAGE.match(given)) if wanted == "<package>"
            else given == wanted
            for wanted, given in zip(shape, params)
        ):
            return True
    return False


def allowed(obj: str, method: str, args: dict[str, Any] | None) -> bool:
    """True when the app may make this call through Home Assistant."""
    args = args or {}
    if not isinstance(args, dict):
        return False
    if obj == "uci":
        return method in UCI_METHODS and args.get("config") in UCI_CONFIGS
    if obj == "file":
        if method == "exec":
            return set(args) <= {"command", "params"} and _command_allowed(
                args.get("command"), args.get("params")
            )
        if method == "read":
            return args.get("path") in READABLE and set(args) <= {"path"}
        if method == "write":
            return (
                args.get("path") in WRITABLE
                and set(args) <= {"path", "data"}
                and isinstance(args.get("data"), str)
            )
        return False
    if obj == "rc" and method == "init":
        return (
            isinstance(args.get("name"), str)
            and bool(_NAME.match(args["name"]))
            and args.get("action") in RC_ACTIONS
        )
    return method in UBUS.get(obj, ())
