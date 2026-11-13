"""OpenWrt Router: routers and access points running OpenWrt, read over ubus."""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME, Platform
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    ConfigEntryNotReady,
    HomeAssistantError,
)
from homeassistant.helpers import config_validation as cv

from .api import RADIO_SETTINGS, OpenWrtApi
from .const import (
    CONF_SHOW_PANEL,
    CONF_TRACK_ALL,
    DOMAIN,
    PANEL_COMPONENT,
    PANEL_FILE,
    PANEL_STATIC_URL,
    PANEL_URL_PATH,
    SERVICE_BLOCK,
    SERVICE_KICK,
)
from .coordinator import OpenWrtCoordinator
from .passthrough import allowed

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.SWITCH,
    Platform.SELECT,
    Platform.BUTTON,
    Platform.DEVICE_TRACKER,
]

_SHARED = f"{DOMAIN}_shared"


def _coordinators(hass: HomeAssistant) -> dict[str, OpenWrtCoordinator]:
    return {
        entry.entry_id: entry.runtime_data
        for entry in hass.config_entries.async_entries(DOMAIN)
        if isinstance(getattr(entry, "runtime_data", None), OpenWrtCoordinator)
    }


def _pick(hass: HomeAssistant, entry_id: str | None) -> OpenWrtCoordinator:
    coordinators = _coordinators(hass)
    if entry_id:
        if entry_id not in coordinators:
            raise HomeAssistantError(f"No OpenWrt network with id {entry_id}")
        return coordinators[entry_id]
    if not coordinators:
        raise HomeAssistantError("No OpenWrt network is set up")
    return next(iter(coordinators.values()))


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    api = OpenWrtApi(entry.data[CONF_HOST], entry.data[CONF_USERNAME], entry.data[CONF_PASSWORD])
    try:
        authenticated = await hass.async_add_executor_job(api.authenticate)
    except Exception as err:  # noqa: BLE001
        raise ConfigEntryNotReady(f"OpenWrt router at {entry.data[CONF_HOST]} did not answer") from err
    if not authenticated:
        raise ConfigEntryAuthFailed("The router refused the user name or the password")

    coordinator = OpenWrtCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await _async_setup_shared(hass)
    await _async_sync_panel(hass)

    # Entities are built from what was there at setup. When a node appears or,
    # with "track every client" on, a new client does, build them again.
    known_nodes = set(coordinator.data["nodes"])
    known_clients = set(coordinator.data["clients"])
    track_all = bool(entry.options.get(CONF_TRACK_ALL))

    @callback
    def _watch() -> None:
        if not coordinator.last_update_success:
            return
        grown = set(coordinator.data["nodes"]) - known_nodes
        if track_all:
            grown |= set(coordinator.data["clients"]) - known_clients
        if grown:
            hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(coordinator.async_add_listener(_watch))
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        entry.runtime_data = None
        await _async_sync_panel(hass)
    return unloaded


# ---------------------------------------------------------------- services


async def _async_setup_shared(hass: HomeAssistant) -> None:
    """Register what is common to every network once: services, websocket, files."""
    if hass.data.get(_SHARED):
        return
    hass.data[_SHARED] = {"panel": False}

    async def kick(call: ServiceCall) -> None:
        coordinator = _pick(hass, call.data.get("entry_id"))
        await coordinator.async_run(
            coordinator.api.kick_client, call.data["mac"], call.data.get("ban_seconds", 0)
        )

    async def block(call: ServiceCall) -> None:
        coordinator = _pick(hass, call.data.get("entry_id"))
        await coordinator.async_run(
            coordinator.api.block_client, call.data["mac"], call.data["blocked"]
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_KICK,
        kick,
        vol.Schema(
            {
                vol.Required("mac"): cv.string,
                vol.Optional("ban_seconds", default=0): vol.All(
                    vol.Coerce(int), vol.Range(min=0, max=3600)
                ),
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_BLOCK,
        block,
        vol.Schema(
            {
                vol.Required("mac"): cv.string,
                vol.Required("blocked"): cv.boolean,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )

    websocket_api.async_register_command(hass, ws_snapshot)
    websocket_api.async_register_command(hass, ws_action)
    websocket_api.async_register_command(hass, ws_ubus)
    websocket_api.async_register_command(hass, ws_backup)

    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_STATIC_URL, str(Path(__file__).parent / PANEL_FILE), False)]
    )


async def _async_sync_panel(hass: HomeAssistant) -> None:
    """Show the sidebar page while at least one network wants it."""
    shared = hass.data.get(_SHARED)
    if shared is None:
        return
    wanted = any(
        coordinator.config_entry.options.get(CONF_SHOW_PANEL, True)
        for coordinator in _coordinators(hass).values()
    )
    if wanted and not shared["panel"]:
        version = (Path(__file__).parent / PANEL_FILE).stat().st_mtime_ns
        frontend.async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title="Wi-Fi",
            sidebar_icon="mdi:router-wireless",
            frontend_url_path=PANEL_URL_PATH,
            config={
                "_panel_custom": {
                    "name": PANEL_COMPONENT,
                    "embed_iframe": False,
                    "trust_external": False,
                    "module_url": f"{PANEL_STATIC_URL}?v={version}",
                }
            },
            require_admin=True,
        )
        shared["panel"] = True
    elif not wanted and shared["panel"]:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        shared["panel"] = False


# --------------------------------------------------------------- websocket


def _public(snapshot: dict[str, Any]) -> dict[str, Any]:
    """The snapshot without the fields only the backend needs."""
    nodes = {
        node_id: {k: v for k, v in node.items() if k != "own_macs"}
        for node_id, node in snapshot["nodes"].items()
    }
    return {**snapshot, "nodes": nodes}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/snapshot"})
@websocket_api.require_admin
@callback
def ws_snapshot(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Everything the panel draws, for every configured network."""
    connection.send_result(
        msg["id"],
        {
            "networks": [
                {
                    "entry_id": entry_id,
                    "title": coordinator.config_entry.title,
                    "ok": coordinator.last_update_success,
                    "interval": coordinator.update_interval.total_seconds()
                    if coordinator.update_interval
                    else None,
                    "data": _public(coordinator.data) if coordinator.data else None,
                }
                for entry_id, coordinator in _coordinators(hass).items()
            ]
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/action",
        vol.Required("action"): vol.In(
            ["refresh", "reboot", "leds", "radio", "restart_radio", "kick", "block", "move"]
        ),
        vol.Optional("entry_id"): str,
        vol.Optional("node"): vol.Any(str, None),
        vol.Optional("band"): str,
        vol.Optional("setting"): vol.In(RADIO_SETTINGS),
        vol.Optional("value"): vol.Any(str, bool),
        vol.Optional("mac"): str,
        vol.Optional("ban_seconds"): vol.All(vol.Coerce(int), vol.Range(min=0, max=3600)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_action(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """One of the things the panel can do to the network."""
    try:
        coordinator = _pick(hass, msg.get("entry_id"))
        api = coordinator.api
        action = msg["action"]
        if action == "refresh":
            await coordinator.async_request_refresh()
        elif action == "reboot":
            await coordinator.async_run(api.reboot, msg["node"])
        elif action == "leds":
            await coordinator.async_run(api.set_leds, msg["node"], bool(msg["value"]))
        elif action == "radio":
            await coordinator.async_run(
                api.set_radio, msg.get("node"), msg["band"], msg["setting"], msg["value"]
            )
        elif action == "restart_radio":
            await coordinator.async_run(api.restart_radio, msg["node"], msg["band"])
        elif action == "kick":
            await coordinator.async_run(api.kick_client, msg["mac"], msg.get("ban_seconds", 0))
        elif action == "move":
            await coordinator.async_run(api.move_client, msg["mac"], msg["node"])
        elif action == "block":
            await coordinator.async_run(api.block_client, msg["mac"], bool(msg["value"]))
    except (HomeAssistantError, KeyError) as err:
        connection.send_error(msg["id"], "failed", str(err))
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/ubus",
        vol.Required("node"): str,
        vol.Required("object"): str,
        vol.Required("method"): str,
        vol.Optional("args"): dict,
        vol.Optional("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ubus(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """One router call for the app's own pages (see passthrough.py for which)."""
    if not allowed(msg["object"], msg["method"], msg.get("args")):
        connection.send_error(
            msg["id"], "not_allowed", f"{msg['object']}.{msg['method']} is not available here"
        )
        return
    try:
        coordinator = _pick(hass, msg.get("entry_id"))
        result = await hass.async_add_executor_job(
            coordinator.api.passthrough, msg["node"], msg["object"], msg["method"], msg.get("args")
        )
    except Exception as err:  # noqa: BLE001 - shown to the user as is
        connection.send_error(msg["id"], "failed", str(err))
        return
    connection.send_result(msg["id"], {"result": result})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/backup",
        vol.Required("node"): str,
        vol.Optional("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_backup(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """A node's configuration archive, for the app to save on the phone."""
    try:
        coordinator = _pick(hass, msg.get("entry_id"))
        archive = await hass.async_add_executor_job(coordinator.api.backup, msg["node"])
    except Exception as err:  # noqa: BLE001 - shown to the user as is
        connection.send_error(msg["id"], "failed", str(err))
        return
    connection.send_result(msg["id"], {"data": base64.b64encode(archive).decode()})
