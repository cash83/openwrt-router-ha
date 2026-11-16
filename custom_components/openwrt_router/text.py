"""The name of each node, changeable from Home Assistant."""

from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import node_name
from .const import DOMAIN
from .coordinator import OpenWrtCoordinator
from .entity import NodeEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    async_add_entities(NodeNameText(coordinator, node_id) for node_id in coordinator.data["nodes"])


class NodeNameText(NodeEntity, TextEntity):
    """The node's own name, the one its web page and the app show too."""

    _attr_translation_key = "node_name"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_native_min = 1
    _attr_native_max = 63

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str) -> None:
        super().__init__(coordinator, node_id, "name")

    @property
    def native_value(self) -> str | None:
        node = self.node
        return node["name"] if node else None

    async def async_set_value(self, value: str) -> None:
        name = node_name(value)
        if not name:
            raise HomeAssistantError("A name needs at least one letter or digit")
        await self.coordinator.async_run(self.coordinator.api.rename_node, self._node_id, name)
        # The device keeps the name it was created with unless told otherwise.
        registry = dr.async_get(self.hass)
        device = registry.async_get_device(identifiers={(DOMAIN, self._node_id)})
        if device is not None and device.name != name:
            registry.async_update_device(device.id, name=name)
