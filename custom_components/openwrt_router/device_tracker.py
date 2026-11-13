"""Presence of the clients the user chose to track."""

from __future__ import annotations

from typing import Any

from homeassistant.components.device_tracker import ScannerEntity, SourceType
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OpenWrtCoordinator
from .entity import ClientEntity, tracked_clients


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    async_add_entities(
        ClientTracker(
            coordinator, mac, (coordinator.data["clients"].get(mac) or {}).get("name") or mac
        )
        for mac in tracked_clients(coordinator)
    )


class ClientTracker(ClientEntity, ScannerEntity):
    _attr_name = None

    def __init__(self, coordinator: OpenWrtCoordinator, mac: str, name: str) -> None:
        super().__init__(coordinator, mac, "tracker", name)

    @property
    def source_type(self) -> SourceType:
        return SourceType.ROUTER

    @property
    def is_connected(self) -> bool:
        return self.client is not None

    @property
    def ip_address(self) -> str | None:
        return (self.client or {}).get("ip")

    @property
    def mac_address(self) -> str:
        return ":".join(self._mac[i : i + 2] for i in range(0, 12, 2))

    @property
    def hostname(self) -> str | None:
        return (self.client or {}).get("name")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        client = self.client or {}
        return {
            "node": client.get("node"),
            "connection": client.get("connection"),
            "signal": client.get("signal"),
        }
