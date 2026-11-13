"""Selectors for the wireless settings."""

from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import BAND_LABEL
from .controls import bands, channel_owners
from .coordinator import OpenWrtCoordinator
from .entity import NodeEntity

_SHARED = (("mode", "wifi_mode"), ("width", "wifi_width"), ("tx_power", "wifi_tx_power"))


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    data = coordinator.data
    entities: list[SelectEntity] = []
    for band in bands(data):
        entities += [
            RadioSelect(coordinator, data["main"], None, band, setting, key)
            for setting, key in _SHARED
        ]
        entities += [
            RadioSelect(coordinator, device, target, band, "channel", "wifi_channel")
            for device, target in channel_owners(data, band)
        ]
    async_add_entities(entities)


class RadioSelect(NodeEntity, SelectEntity):
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(
        self,
        coordinator: OpenWrtCoordinator,
        device_node: str,
        target: str | None,
        band: str,
        setting: str,
        key: str,
    ) -> None:
        super().__init__(coordinator, device_node, f"wifi_{band}_{setting}")
        self._target = target
        self._band = band
        self._setting = setting
        self._attr_translation_key = key
        self._attr_translation_placeholders = {"band": BAND_LABEL[band]}

    @property
    def _radio(self) -> dict[str, Any]:
        return ((self.node or {}).get("radios") or {}).get(self._band) or {}

    @property
    def _choices(self) -> dict[str, str]:
        return (self._radio.get("options") or {}).get(self._setting) or {}

    @property
    def options(self) -> list[str]:
        return list(self._choices.values())

    @property
    def current_option(self) -> str | None:
        field = "channel_setting" if self._setting == "channel" else self._setting
        return self._choices.get(str(self._radio.get(field)))

    async def async_select_option(self, option: str) -> None:
        value = next((raw for raw, label in self._choices.items() if label == option), None)
        if value is None:
            raise HomeAssistantError(f"{option} is not offered by this radio")
        await self.coordinator.async_run(
            self.coordinator.api.set_radio, self._target, self._band, self._setting, value
        )
