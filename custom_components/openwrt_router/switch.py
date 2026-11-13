"""Switches: lights of each node, Wi-Fi on/off for the network, client access."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import BAND_LABEL
from .controls import bands
from .coordinator import OpenWrtCoordinator
from .entity import ClientEntity, NodeEntity, tracked_clients

_RADIO_SWITCHES = (
    ("enabled", "wifi_enabled", None),
    ("hidden", "wifi_hidden", EntityCategory.CONFIG),
    ("isolate", "wifi_isolate", EntityCategory.CONFIG),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    data = coordinator.data
    entities: list[SwitchEntity] = [
        LedSwitch(coordinator, node_id)
        for node_id, node in data["nodes"].items()
        if node.get("leds") is not None
    ]
    for band in bands(data):
        entities += [
            RadioSwitch(coordinator, band, setting, key, category)
            for setting, key, category in _RADIO_SWITCHES
        ]
    for mac in tracked_clients(coordinator):
        name = (data["clients"].get(mac) or {}).get("name") or mac
        entities.append(ClientInternetSwitch(coordinator, mac, name))
    async_add_entities(entities)


class LedSwitch(NodeEntity, SwitchEntity):
    _attr_translation_key = "leds"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str) -> None:
        super().__init__(coordinator, node_id, "leds")

    @property
    def is_on(self) -> bool | None:
        return (self.node or {}).get("leds")

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.coordinator.async_run(self.coordinator.api.set_leds, self._node_id, True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.coordinator.async_run(self.coordinator.api.set_leds, self._node_id, False)


class RadioSwitch(NodeEntity, SwitchEntity):
    """A Wi-Fi setting that is kept the same on every node."""

    def __init__(
        self,
        coordinator: OpenWrtCoordinator,
        band: str,
        setting: str,
        key: str,
        category: EntityCategory | None,
    ) -> None:
        super().__init__(coordinator, coordinator.data["main"], f"wifi_{band}_{setting}")
        self._band = band
        self._setting = setting
        self._attr_translation_key = key
        self._attr_translation_placeholders = {"band": BAND_LABEL[band]}
        self._attr_entity_category = category

    @property
    def is_on(self) -> bool | None:
        return (((self.node or {}).get("radios") or {}).get(self._band) or {}).get(self._setting)

    async def _set(self, value: bool) -> None:
        await self.coordinator.async_run(
            self.coordinator.api.set_radio, None, self._band, self._setting, value
        )

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class ClientInternetSwitch(ClientEntity, SwitchEntity):
    """On while the client may reach the internet."""

    _attr_translation_key = "client_internet"

    def __init__(self, coordinator: OpenWrtCoordinator, mac: str, name: str) -> None:
        super().__init__(coordinator, mac, "internet", name)
        self._blocked: bool | None = None

    @property
    def is_on(self) -> bool | None:
        client = self.client
        if client is not None:
            self._blocked = client["blocked"]
        return None if self._blocked is None else not self._blocked

    async def _set(self, allowed: bool) -> None:
        label = (self.client or {}).get("name")
        await self.coordinator.async_run(
            self.coordinator.api.block_client, self._mac, not allowed, label
        )
        self._blocked = not allowed

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)
