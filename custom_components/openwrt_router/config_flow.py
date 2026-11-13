"""Set-up, re-authentication and options for an OpenWrt network."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_SCAN_INTERVAL, CONF_USERNAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import selector

from .api import OpenWrtApi, mac12
from .const import (
    CONF_NOTIFY,
    CONF_SHOW_PANEL,
    CONF_TRACK_ALL,
    CONF_TRACKED,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)


async def _probe(hass: HomeAssistant, data: dict[str, Any]) -> tuple[dict[str, str] | None, str | None]:
    """(identity, error key). Exactly one of the two is set."""
    api = OpenWrtApi(data[CONF_HOST], data[CONF_USERNAME], data[CONF_PASSWORD])
    try:
        if not await hass.async_add_executor_job(api.authenticate):
            return None, "invalid_auth"
        identity = await hass.async_add_executor_job(api.identity)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("OpenWrt router did not answer", exc_info=True)
        return None, "cannot_connect"
    identity["host"] = api.base_url
    return identity, None


class OpenWrtConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return OpenWrtOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            identity, error = await _probe(self.hass, user_input)
            if error:
                errors["base"] = error
            else:
                await self.async_set_unique_id(identity["unique_id"])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=identity["name"], data={**user_input, CONF_HOST: identity["host"]}
                )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default="192.168.1.1"): str,
                    vol.Required(CONF_USERNAME, default="root"): str,
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {**entry.data, **user_input}
            _identity, error = await _probe(self.hass, data)
            if error:
                errors["base"] = error
            else:
                return self.async_update_reload_and_abort(entry, data=data)
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_USERNAME, default=entry.data.get(CONF_USERNAME, "root")): str,
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )


class OpenWrtOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            user_input[CONF_TRACKED] = sorted({mac12(m) for m in user_input.get(CONF_TRACKED, [])})
            user_input[CONF_NOTIFY] = str(user_input.get(CONF_NOTIFY) or "").strip()
            return self.async_create_entry(title="", data=user_input)

        options = self.config_entry.options
        chosen = [mac12(m) for m in options.get(CONF_TRACKED, [])]
        coordinator = getattr(self.config_entry, "runtime_data", None)
        clients = (coordinator.data or {}).get("clients", {}) if coordinator else {}
        choices = {
            mac: f"{client['name']} ({client['mac']}, {client['node']})"
            for mac, client in clients.items()
        }
        for mac in chosen:
            choices.setdefault(mac, mac)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SCAN_INTERVAL,
                        default=options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                    ): vol.All(
                        vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL, max=MAX_SCAN_INTERVAL)
                    ),
                    vol.Required(
                        CONF_SHOW_PANEL, default=options.get(CONF_SHOW_PANEL, True)
                    ): bool,
                    vol.Optional(
                        CONF_NOTIFY,
                        description={"suggested_value": options.get(CONF_NOTIFY, "")},
                    ): str,
                    vol.Required(CONF_TRACK_ALL, default=options.get(CONF_TRACK_ALL, False)): bool,
                    vol.Optional(CONF_TRACKED, default=chosen): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                selector.SelectOptionDict(value=mac, label=label)
                                for mac, label in sorted(choices.items(), key=lambda i: i[1].lower())
                            ],
                            multiple=True,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    ),
                }
            ),
        )
