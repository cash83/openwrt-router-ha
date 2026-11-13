"""Which wireless settings are shared by the whole network and which are per node.

Access points that are linked over the air must sit on the same channel on the
band that carries the link, so that channel is one setting for everybody.
A band without such a link lets every node pick its own channel, which is what
keeps neighbouring access points from talking over each other.
Everything else (on/off, hidden, mode, width, power) is kept equal everywhere.
"""

from __future__ import annotations

from typing import Any


def bands(data: dict[str, Any]) -> list[str]:
    """Bands the main router has, in order."""
    return list(data["nodes"][data["main"]]["radios"])


def band_carries_link(data: dict[str, Any], band: str) -> bool:
    return any(
        (node["radios"].get(band) or {}).get("mesh_ifname") for node in data["nodes"].values()
    )


def channel_owners(data: dict[str, Any], band: str) -> list[tuple[str, str | None]]:
    """(device the selector sits on, node it changes — None for all of them)."""
    if band_carries_link(data, band) or len(data["nodes"]) == 1:
        return [(data["main"], None)]
    return [(node_id, node_id) for node_id, node in data["nodes"].items() if band in node["radios"]]
