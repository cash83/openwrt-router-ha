"""Buttons: restart a node, or just one of its radios."""

from __future__ import annotations

from homeassistant.components.button import ButtonDeviceClass, ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import BAND_LABEL
from .coordinator import OpenWrtCoordinator
from .entity import NodeEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    entities: list[ButtonEntity] = []
    for node_id, node in coordinator.data["nodes"].items():
        entities.append(RebootButton(coordinator, node_id))
        entities += [RestartRadioButton(coordinator, node_id, band) for band in node["radios"]]
    async_add_entities(entities)


class RebootButton(NodeEntity, ButtonEntity):
    _attr_device_class = ButtonDeviceClass.RESTART
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str) -> None:
        super().__init__(coordinator, node_id, "reboot")

    async def async_press(self) -> None:
        await self.coordinator.async_run(self.coordinator.api.reboot, self._node_id)


class RestartRadioButton(NodeEntity, ButtonEntity):
    """Turns one radio off and on again, which is how a stuck access point recovers."""

    _attr_translation_key = "restart_radio"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str, band: str) -> None:
        super().__init__(coordinator, node_id, f"restart_radio_{band}")
        self._band = band
        self._attr_translation_placeholders = {"band": BAND_LABEL[band]}

    async def async_press(self) -> None:
        await self.coordinator.async_run(
            self.coordinator.api.restart_radio, self._node_id, self._band
        )
