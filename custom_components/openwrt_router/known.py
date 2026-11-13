"""Remember which clients have been seen before, to tell a new one apart.

Kept free of Home Assistant so it can be tested alone; the coordinator stores
the dictionary this module fills.
"""

from __future__ import annotations

from typing import Any

NEW_FOR = 24 * 3600


def mark_new(
    clients: dict[str, dict[str, Any]],
    known: dict[str, float] | None,
    now: float,
) -> tuple[dict[str, float], list[dict[str, Any]]]:
    """Flag recent arrivals in `clients` and return (known, just arrived).

    `known` maps a client's address to when it was first seen. With no memory
    yet (`None`) everything present is taken as already known: the first
    reading of a network must not announce sixty "new" devices.
    """
    if known is None:
        known = {mac: 0.0 for mac in clients}
        for client in clients.values():
            client["is_new"] = False
        return known, []

    arrived = []
    for mac, client in clients.items():
        first_seen = known.get(mac)
        if first_seen is None:
            known[mac] = first_seen = now
            arrived.append(client)
        client["is_new"] = now - first_seen < NEW_FOR
    return known, arrived
