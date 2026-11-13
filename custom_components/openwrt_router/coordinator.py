"""Polls the routers and hands the snapshot to the entities."""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from typing import Any, Callable

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_SCAN_INTERVAL
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AuthError, OpenWrtApi
from .const import (
    CONF_NOTIFY,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    EVENT_NEW_DEVICE,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
)
from .known import mark_new

_LOGGER = logging.getLogger(__name__)


class OpenWrtCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """One coordinator per network (main router plus its nodes)."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, api: OpenWrtApi) -> None:
        seconds = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        seconds = max(MIN_SCAN_INTERVAL, min(MAX_SCAN_INTERVAL, int(seconds)))
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=seconds),
        )
        self.api = api
        self._store: Store[dict[str, float]] = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}.clients")
        self._known: dict[str, float] | None = None
        self._known_loaded = False

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            data = await self.hass.async_add_executor_job(self.api.collect)
        except AuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except Exception as err:  # noqa: BLE001 - any failure is "router unreachable"
            raise UpdateFailed(f"OpenWrt router did not answer: {err}") from err
        await self._async_spot_new(data)
        return data

    async def _async_spot_new(self, data: dict[str, Any]) -> None:
        """Flag clients never seen before, and tell Home Assistant about them."""
        if not self._known_loaded:
            self._known = await self._store.async_load()
            self._known_loaded = True
        first_time = self._known is None
        self._known, arrived = mark_new(data["clients"], self._known, time.time())
        if first_time or arrived:
            self._store.async_delay_save(lambda: self._known or {}, 10)
        for client in arrived:
            self.hass.bus.async_fire(
                EVENT_NEW_DEVICE,
                {
                    "entry_id": self.config_entry.entry_id,
                    "mac": client["mac"],
                    "name": client["name"],
                    "ip": client["ip"],
                    "node": client["node"],
                    "connection": client["connection"],
                },
            )
        service = str(self.config_entry.options.get(CONF_NOTIFY) or "").strip()
        if arrived and service:
            await self._async_notify(service, arrived)

    async def _async_notify(self, service: str, arrived: list[dict[str, Any]]) -> None:
        italian = str(self.hass.config.language or "").startswith("it")
        lines = [
            f"{c['name']} ({c['mac']}) - {c['node']}, {c['connection']}" for c in arrived[:8]
        ]
        if len(arrived) > 8:
            lines.append("…")
        title = (
            ("Nuovo dispositivo in rete" if len(arrived) == 1 else "Nuovi dispositivi in rete")
            if italian
            else ("New device on the network" if len(arrived) == 1 else "New devices on the network")
        )
        domain, _, name = service.removeprefix("notify.").rpartition(".")
        try:
            await self.hass.services.async_call(
                domain or "notify", name, {"title": title, "message": "\n".join(lines)}
            )
        except Exception:  # noqa: BLE001 - a wrong service name must not stop the readings
            _LOGGER.warning("Could not send the new-device notification through %s", service)

    async def async_run(self, action: Callable[..., Any], *args: Any) -> None:
        """Run a blocking router action, then read the new state."""
        try:
            await self.hass.async_add_executor_job(action, *args)
        except Exception as err:  # noqa: BLE001 - shown to the user as is
            raise HomeAssistantError(str(err)) from err
        await self.async_request_refresh()

    @property
    def main(self) -> dict[str, Any]:
        return self.data["nodes"][self.data["main"]]
