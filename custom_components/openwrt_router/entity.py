"""Shared base classes: one device per node, one per tracked client."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import CONNECTION_NETWORK_MAC, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import mac12
from .const import CONF_TRACK_ALL, CONF_TRACKED, DOMAIN
from .coordinator import OpenWrtCoordinator


def node_device(coordinator: OpenWrtCoordinator, node: dict[str, Any]) -> DeviceInfo:
    info = DeviceInfo(
        identifiers={(DOMAIN, node["id"])},
        connections={(CONNECTION_NETWORK_MAC, node["id"].lower())},
        manufacturer="OpenWrt",
        model=node.get("model"),
        name=node["name"],
        sw_version=node.get("firmware"),
        configuration_url=f"http://{node['host']}",
    )
    if not node["is_main"]:
        info["via_device"] = (DOMAIN, coordinator.data["main"])
    return info


def tracked_clients(coordinator: OpenWrtCoordinator) -> list[str]:
    """MAC addresses (12 hex digits) of the clients that get their own device."""
    options = coordinator.config_entry.options
    wanted = {mac12(m) for m in options.get(CONF_TRACKED, [])}
    if options.get(CONF_TRACK_ALL):
        wanted |= set(coordinator.data["clients"])
    return sorted(m for m in wanted if len(m) == 12)


class NodeEntity(CoordinatorEntity[OpenWrtCoordinator]):
    """An entity that belongs to one access point."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str, key: str) -> None:
        super().__init__(coordinator)
        self._node_id = node_id
        self._attr_unique_id = f"{mac12(node_id)}_{key}"
        self._attr_device_info = node_device(coordinator, coordinator.data["nodes"][node_id])

    @property
    def node(self) -> dict[str, Any] | None:
        return self.coordinator.data["nodes"].get(self._node_id)

    @property
    def available(self) -> bool:
        node = self.node
        return super().available and node is not None and node["online"]


class ClientEntity(CoordinatorEntity[OpenWrtCoordinator]):
    """An entity that belongs to one tracked client."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: OpenWrtCoordinator, mac: str, key: str, name: str) -> None:
        super().__init__(coordinator)
        self._mac = mac12(mac)
        self._attr_unique_id = f"{self._mac}_{key}"
        colon = ":".join(self._mac[i : i + 2] for i in range(0, 12, 2))
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"client_{self._mac}")},
            connections={(CONNECTION_NETWORK_MAC, colon)},
            name=name,
            via_device=(DOMAIN, coordinator.data["main"]),
        )

    @property
    def client(self) -> dict[str, Any] | None:
        return self.coordinator.data["clients"].get(self._mac)
