"""Sensors: the network as a whole, each node, each radio, each tracked client."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    PERCENTAGE,
    SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
    EntityCategory,
    UnitOfDataRate,
    UnitOfInformation,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import BAND_LABEL
from .coordinator import OpenWrtCoordinator
from .entity import ClientEntity, NodeEntity, tracked_clients

Snapshot = dict[str, Any]
Node = dict[str, Any]


@dataclass(frozen=True, kw_only=True)
class OpenWrtSensor(SensorEntityDescription):
    value: Callable[[Snapshot, Node], Any]
    attributes: Callable[[Snapshot, Node], dict[str, Any]] | None = None
    present: Callable[[Node], bool] = lambda node: True


def _top(kind: str) -> Callable[[Snapshot, Node], dict[str, Any]]:
    def attributes(data: Snapshot, _node: Node) -> dict[str, Any]:
        top = data["totals"].get(f"top_{kind}") or {}
        return {"mac": top.get("mac"), "speed_mbit": top.get(kind)}

    return attributes


# Shown once, on the main router: they describe the network, not a box.
NETWORK_SENSORS: tuple[OpenWrtSensor, ...] = (
    OpenWrtSensor(key="public_ip", translation_key="public_ip",
                  value=lambda d, n: d["network"]["public_ip"]),
    OpenWrtSensor(key="wan_ip", translation_key="wan_ip",
                  value=lambda d, n: d["network"]["wan_ip"],
                  attributes=lambda d, n: {"protocol": d["network"]["wan_protocol"],
                                           "gateway": d["network"]["gateway"],
                                           "dns": d["network"]["dns"]}),
    OpenWrtSensor(key="gateway", translation_key="gateway",
                  entity_category=EntityCategory.DIAGNOSTIC,
                  value=lambda d, n: d["network"]["gateway"]),
    OpenWrtSensor(key="dns", translation_key="dns",
                  entity_category=EntityCategory.DIAGNOSTIC,
                  value=lambda d, n: ", ".join(d["network"]["dns"]) or None),
    OpenWrtSensor(key="wan_uptime", translation_key="wan_uptime",
                  device_class=SensorDeviceClass.DURATION,
                  native_unit_of_measurement=UnitOfTime.SECONDS,
                  suggested_unit_of_measurement=UnitOfTime.HOURS,
                  state_class=SensorStateClass.MEASUREMENT,
                  entity_category=EntityCategory.DIAGNOSTIC,
                  value=lambda d, n: d["network"]["wan_uptime"]),
    OpenWrtSensor(key="download_total", translation_key="download_total",
                  device_class=SensorDeviceClass.DATA_SIZE,
                  native_unit_of_measurement=UnitOfInformation.MEBIBYTES,
                  suggested_unit_of_measurement=UnitOfInformation.GIBIBYTES,
                  state_class=SensorStateClass.TOTAL_INCREASING,
                  value=lambda d, n: d["network"]["download_mb"]),
    OpenWrtSensor(key="upload_total", translation_key="upload_total",
                  device_class=SensorDeviceClass.DATA_SIZE,
                  native_unit_of_measurement=UnitOfInformation.MEBIBYTES,
                  suggested_unit_of_measurement=UnitOfInformation.GIBIBYTES,
                  state_class=SensorStateClass.TOTAL_INCREASING,
                  value=lambda d, n: d["network"]["upload_mb"]),
    OpenWrtSensor(key="download_speed", translation_key="download_speed",
                  device_class=SensorDeviceClass.DATA_RATE,
                  native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                  state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=2,
                  value=lambda d, n: d["totals"]["down"]),
    OpenWrtSensor(key="upload_speed", translation_key="upload_speed",
                  device_class=SensorDeviceClass.DATA_RATE,
                  native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                  state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=2,
                  value=lambda d, n: d["totals"]["up"]),
    OpenWrtSensor(key="top_downloader", translation_key="top_downloader",
                  value=lambda d, n: (d["totals"].get("top_down") or {}).get("name"),
                  attributes=_top("down")),
    OpenWrtSensor(key="top_uploader", translation_key="top_uploader",
                  value=lambda d, n: (d["totals"].get("top_up") or {}).get("name"),
                  attributes=_top("up")),
    OpenWrtSensor(key="network_clients", translation_key="network_clients",
                  state_class=SensorStateClass.MEASUREMENT,
                  value=lambda d, n: d["totals"]["clients"],
                  attributes=lambda d, n: {"wifi_2_4_ghz": d["totals"]["wifi_2g"],
                                           "wifi_5_ghz": d["totals"]["wifi_5g"],
                                           "wired": d["totals"]["wired"]}),
    OpenWrtSensor(key="wired_clients", translation_key="wired_clients",
                  state_class=SensorStateClass.MEASUREMENT,
                  value=lambda d, n: d["totals"]["wired"]),
    OpenWrtSensor(key="dhcp_range", translation_key="dhcp_range",
                  entity_category=EntityCategory.DIAGNOSTIC,
                  value=lambda d, n: (f"{d['network']['dhcp_start']} - {d['network']['dhcp_end']}"
                                      if d["network"]["dhcp_start"] else None),
                  attributes=lambda d, n: {"lease_seconds": d["network"]["dhcp_lease"],
                                           "router": d["network"]["lan_ip"],
                                           "netmask": d["network"]["netmask"]}),
)

NODE_SENSORS: tuple[OpenWrtSensor, ...] = (
    OpenWrtSensor(key="clients", translation_key="clients",
                  state_class=SensorStateClass.MEASUREMENT,
                  value=lambda d, n: n.get("clients"),
                  attributes=lambda d, n: {
                      "names": sorted(c["name"] for c in d["clients"].values()
                                      if c["node_id"] == n["id"])}),
    OpenWrtSensor(key="clients_2g", translation_key="clients_2g",
                  state_class=SensorStateClass.MEASUREMENT,
                  value=lambda d, n: n.get("clients_2g")),
    OpenWrtSensor(key="clients_5g", translation_key="clients_5g",
                  state_class=SensorStateClass.MEASUREMENT,
                  value=lambda d, n: n.get("clients_5g")),
    OpenWrtSensor(key="cpu", translation_key="cpu", native_unit_of_measurement=PERCENTAGE,
                  state_class=SensorStateClass.MEASUREMENT,
                  entity_category=EntityCategory.DIAGNOSTIC, value=lambda d, n: n.get("cpu")),
    OpenWrtSensor(key="ram", translation_key="ram", native_unit_of_measurement=PERCENTAGE,
                  state_class=SensorStateClass.MEASUREMENT,
                  entity_category=EntityCategory.DIAGNOSTIC, value=lambda d, n: n.get("ram")),
    OpenWrtSensor(key="uptime", translation_key="uptime",
                  device_class=SensorDeviceClass.DURATION,
                  native_unit_of_measurement=UnitOfTime.SECONDS,
                  suggested_unit_of_measurement=UnitOfTime.DAYS,
                  state_class=SensorStateClass.MEASUREMENT,
                  entity_category=EntityCategory.DIAGNOSTIC, value=lambda d, n: n.get("uptime")),
    OpenWrtSensor(key="firmware", translation_key="firmware",
                  entity_category=EntityCategory.DIAGNOSTIC,
                  value=lambda d, n: n.get("firmware")),
    OpenWrtSensor(key="backhaul", translation_key="backhaul",
                  present=lambda n: not n["is_main"], value=lambda d, n: n.get("backhaul")),
    OpenWrtSensor(key="mesh_signal", translation_key="mesh_signal",
                  device_class=SensorDeviceClass.SIGNAL_STRENGTH,
                  native_unit_of_measurement=SIGNAL_STRENGTH_DECIBELS_MILLIWATT,
                  state_class=SensorStateClass.MEASUREMENT,
                  present=lambda n: bool(n.get("mesh")),
                  value=lambda d, n: (n.get("mesh") or {}).get("signal")),
    OpenWrtSensor(key="mesh_tx_rate", translation_key="mesh_tx_rate",
                  device_class=SensorDeviceClass.DATA_RATE,
                  native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                  state_class=SensorStateClass.MEASUREMENT,
                  present=lambda n: bool(n.get("mesh")),
                  value=lambda d, n: (n.get("mesh") or {}).get("tx_rate")),
    OpenWrtSensor(key="mesh_rx_rate", translation_key="mesh_rx_rate",
                  device_class=SensorDeviceClass.DATA_RATE,
                  native_unit_of_measurement=UnitOfDataRate.MEGABITS_PER_SECOND,
                  state_class=SensorStateClass.MEASUREMENT,
                  present=lambda n: bool(n.get("mesh")),
                  value=lambda d, n: (n.get("mesh") or {}).get("rx_rate")),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: OpenWrtCoordinator = entry.runtime_data
    data = coordinator.data
    entities: list[SensorEntity] = [
        NodeSensor(coordinator, data["main"], description) for description in NETWORK_SENSORS
    ]
    for node_id, node in data["nodes"].items():
        entities += [
            NodeSensor(coordinator, node_id, description)
            for description in NODE_SENSORS
            if description.present(node)
        ]
        entities += [RadioChannelSensor(coordinator, node_id, band) for band in node["radios"]]
    for mac in tracked_clients(coordinator):
        name = (data["clients"].get(mac) or {}).get("name") or mac
        entities += [
            ClientSignalSensor(coordinator, mac, name),
            ClientNodeSensor(coordinator, mac, name),
        ]
    async_add_entities(entities)


class NodeSensor(NodeEntity, SensorEntity):
    entity_description: OpenWrtSensor

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str, description: OpenWrtSensor) -> None:
        super().__init__(coordinator, node_id, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> Any:
        node = self.node
        return None if node is None else self.entity_description.value(self.coordinator.data, node)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        node = self.node
        if node is None or self.entity_description.attributes is None:
            return None
        return self.entity_description.attributes(self.coordinator.data, node)


class RadioChannelSensor(NodeEntity, SensorEntity):
    """The channel a radio is on right now, with the network it broadcasts."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: OpenWrtCoordinator, node_id: str, band: str) -> None:
        super().__init__(coordinator, node_id, f"wifi_{band}_channel_now")
        self._band = band
        self._attr_translation_key = "radio_channel"
        self._attr_translation_placeholders = {"band": BAND_LABEL[band]}

    @property
    def _radio(self) -> dict[str, Any]:
        return ((self.node or {}).get("radios") or {}).get(self._band) or {}

    @property
    def native_value(self) -> Any:
        return self._radio.get("channel")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        radio = self._radio
        return {"ssid": radio.get("ssid"), "mode": radio.get("htmode"),
                "bssid": radio.get("bssid"), "enabled": radio.get("enabled")}


class ClientSignalSensor(ClientEntity, SensorEntity):
    _attr_translation_key = "client_signal"
    _attr_device_class = SensorDeviceClass.SIGNAL_STRENGTH
    _attr_native_unit_of_measurement = SIGNAL_STRENGTH_DECIBELS_MILLIWATT
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: OpenWrtCoordinator, mac: str, name: str) -> None:
        super().__init__(coordinator, mac, "signal", name)

    @property
    def native_value(self) -> Any:
        return (self.client or {}).get("signal")


class ClientNodeSensor(ClientEntity, SensorEntity):
    """Which access point a client is attached to."""

    _attr_translation_key = "client_node"

    def __init__(self, coordinator: OpenWrtCoordinator, mac: str, name: str) -> None:
        super().__init__(coordinator, mac, "node", name)

    @property
    def native_value(self) -> Any:
        return (self.client or {}).get("node")

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        client = self.client
        if client is None:
            return None
        return {"connection": client["connection"], "ip": client["ip"],
                "download_mbit": client["down"], "upload_mbit": client["up"],
                "connected_seconds": client["connected"]}
