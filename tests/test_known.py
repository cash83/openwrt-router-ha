"""Telling a new client from one already seen."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "custom_components" / "openwrt_router" / "known.py"
_SPEC = importlib.util.spec_from_file_location("openwrt_router_known", _PATH)
known = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = known
_SPEC.loader.exec_module(known)


NOW = 1_800_000_000.0  # a real clock reading: memory seeded with 0 is long past


def _clients(*macs: str) -> dict:
    return {mac: {"mac": mac} for mac in macs}


def test_first_reading_announces_nobody() -> None:
    clients = _clients("a", "b")
    memory, arrived = known.mark_new(clients, None, NOW)
    assert arrived == []
    assert memory == {"a": 0.0, "b": 0.0}
    assert not any(c["is_new"] for c in clients.values())


def test_a_client_never_seen_is_new_for_a_day() -> None:
    memory = {"a": 0.0}
    clients = _clients("a", "b")
    memory, arrived = known.mark_new(clients, memory, NOW)
    assert [c["mac"] for c in arrived] == ["b"]
    assert (clients["a"]["is_new"], clients["b"]["is_new"]) == (False, True)

    # Seen again an hour later: still marked, but not announced twice.
    clients = _clients("a", "b")
    memory, arrived = known.mark_new(clients, memory, NOW + 3600)
    assert arrived == []
    assert clients["b"]["is_new"] is True

    clients = _clients("b")
    memory, arrived = known.mark_new(clients, memory, NOW + known.NEW_FOR + 1)
    assert clients["b"]["is_new"] is False


def test_a_client_that_left_and_came_back_is_not_new() -> None:
    memory = {"a": 0.0}
    known.mark_new(_clients(), memory, NOW)
    clients = _clients("a")
    _memory, arrived = known.mark_new(clients, memory, NOW + 100)
    assert arrived == [] and clients["a"]["is_new"] is False
