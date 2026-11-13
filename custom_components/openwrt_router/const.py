"""Constants for the OpenWrt Router integration."""

from __future__ import annotations

DOMAIN = "openwrt_router"

CONF_TRACKED = "tracked_clients"
CONF_TRACK_ALL = "track_all_clients"
CONF_SHOW_PANEL = "show_panel"

DEFAULT_SCAN_INTERVAL = 30
MIN_SCAN_INTERVAL = 10
MAX_SCAN_INTERVAL = 3600

PANEL_URL_PATH = "openwrt-router"
PANEL_COMPONENT = "openwrt-router-panel"
PANEL_FILE = "frontend/openwrt-router-panel.js"
PANEL_STATIC_URL = "/openwrt_router_static/openwrt-router-panel.js"

SERVICE_KICK = "kick_client"
SERVICE_BLOCK = "block_client"
