"""Polls the routers and hands the snapshot to the entities."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Callable

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_SCAN_INTERVAL
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AuthError, OpenWrtApi
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, MAX_SCAN_INTERVAL, MIN_SCAN_INTERVAL

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

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self.hass.async_add_executor_job(self.api.collect)
        except AuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except Exception as err:  # noqa: BLE001 - any failure is "router unreachable"
            raise UpdateFailed(f"OpenWrt router did not answer: {err}") from err

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
