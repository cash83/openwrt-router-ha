"""Connectivity: the internet link, and each node that is not the main router."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import OpenWrtCoordinator
from .entity import NodeEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    data = coordinator.data
    entities: list[BinarySensorEntity] = [InternetSensor(coordinator, data["main"])]
    entities += [
        NodeOnlineSensor(coordinator, node_id)
        for node_id, node in data["nodes"].items()
        if not node["is_main"]
    ]
    async_add_entities(entities)


class InternetSensor(NodeEntity, BinarySensorEntity):
    _attr_translation_key = "internet"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str) -> None:
        super().__init__(coordinator, node_id, "internet")

    @property
    def is_on(self) -> bool:
        return bool(self.coordinator.data["network"]["wan_up"])


class NodeOnlineSensor(NodeEntity, BinarySensorEntity):
    _attr_translation_key = "node_online"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str) -> None:
        super().__init__(coordinator, node_id, "online")

    @property
    def available(self) -> bool:
        # Reporting "disconnected" is the whole point, so stay available.
        return self.coordinator.last_update_success and self.node is not None

    @property
    def is_on(self) -> bool:
        return bool((self.node or {}).get("online"))
