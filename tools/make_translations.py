"""Write strings.json and the translations from one table, so they cannot drift."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "custom_components" / "openwrt_router"

# key: (English, Italian)
ENTITIES = {
    "sensor": {
        "public_ip": ("Public IP", "IP pubblico"),
        "wan_ip": ("WAN IP", "IP WAN"),
        "gateway": ("Gateway", "Gateway"),
        "dns": ("DNS servers", "Server DNS"),
        "wan_uptime": ("Internet connected for", "Internet collegato da"),
        "download_total": ("Downloaded", "Scaricati"),
        "upload_total": ("Uploaded", "Caricati"),
        "download_speed": ("Download speed", "Velocità download"),
        "upload_speed": ("Upload speed", "Velocità upload"),
        "top_downloader": ("Top downloader", "Chi scarica di più"),
        "top_uploader": ("Top uploader", "Chi carica di più"),
        "network_clients": ("Devices on the network", "Dispositivi in rete"),
        "wired_clients": ("Wired devices", "Dispositivi via cavo"),
        "dhcp_range": ("DHCP range", "Intervallo DHCP"),
        "clients": ("Devices", "Dispositivi"),
        "clients_2g": ("Devices on 2.4 GHz", "Dispositivi a 2,4 GHz"),
        "clients_5g": ("Devices on 5 GHz", "Dispositivi a 5 GHz"),
        "cpu": ("Processor load", "Carico processore"),
        "ram": ("Memory in use", "Memoria usata"),
        "uptime": ("Running for", "Acceso da"),
        "firmware": ("Firmware", "Firmware"),
        "backhaul": ("Link to the network", "Collegamento alla rete"),
        "mesh_signal": ("Mesh link signal", "Segnale collegamento mesh"),
        "mesh_tx_rate": ("Mesh link send rate", "Velocità invio mesh"),
        "mesh_rx_rate": ("Mesh link receive rate", "Velocità ricezione mesh"),
        "radio_channel": ("Wi-Fi {band} current channel", "Canale attuale Wi-Fi {band}"),
        "client_signal": ("Signal", "Segnale"),
        "client_node": ("Connected to", "Collegato a"),
    },
    "binary_sensor": {
        "internet": ("Internet", "Internet"),
        "node_online": ("Reachable", "Raggiungibile"),
    },
    "switch": {
        "leds": ("Lights", "Luci"),
        "wifi_enabled": ("Wi-Fi {band}", "Wi-Fi {band}"),
        "wifi_hidden": ("Wi-Fi {band} hidden network", "Wi-Fi {band} rete nascosta"),
        "wifi_isolate": ("Wi-Fi {band} isolate devices", "Wi-Fi {band} isola i dispositivi"),
        "client_internet": ("Internet access", "Accesso a internet"),
    },
    "select": {
        "wifi_mode": ("Wi-Fi {band} standard", "Wi-Fi {band} standard"),
        "wifi_width": ("Wi-Fi {band} channel width", "Wi-Fi {band} larghezza canale"),
        "wifi_tx_power": ("Wi-Fi {band} transmit power", "Wi-Fi {band} potenza"),
        "wifi_channel": ("Wi-Fi {band} channel", "Wi-Fi {band} canale"),
    },
    "button": {
        "restart_radio": ("Restart Wi-Fi {band} radio", "Riavvia radio Wi-Fi {band}"),
    },
}

TEXT = {
    "config": {
        "step": {
            "user": {
                "title": ("OpenWrt router", "Router OpenWrt"),
                "description": (
                    "Address and login of the main router. Other OpenWrt access points of the "
                    "same network are found on their own and use the same login.",
                    "Indirizzo e accesso del router principale. Gli altri access point OpenWrt "
                    "della stessa rete vengono trovati da soli e usano lo stesso accesso.",
                ),
                "data": {
                    "host": ("Address", "Indirizzo"),
                    "username": ("User name", "Utente"),
                    "password": ("Password", "Password"),
                },
            },
            "reauth_confirm": {
                "title": ("Log in to the router again", "Accedi di nuovo al router"),
                "description": (
                    "The router refused the saved login.",
                    "Il router ha rifiutato l'accesso salvato.",
                ),
                "data": {
                    "username": ("User name", "Utente"),
                    "password": ("Password", "Password"),
                },
            },
        },
        "error": {
            "cannot_connect": (
                "The router did not answer at that address.",
                "Il router non risponde a quell'indirizzo.",
            ),
            "invalid_auth": ("Wrong user name or password.", "Utente o password errati."),
        },
        "abort": {
            "already_configured": ("This router is already set up.", "Questo router è già configurato."),
            "reauth_successful": ("Login updated.", "Accesso aggiornato."),
        },
    },
    "options": {
        "step": {
            "init": {
                "title": ("OpenWrt network options", "Opzioni della rete OpenWrt"),
                "data": {
                    "scan_interval": ("Seconds between two readings", "Secondi tra due letture"),
                    "show_panel": ("Show the Wi-Fi page in the sidebar", "Mostra la pagina Wi-Fi nel menu"),
                    "track_all_clients": (
                        "Create a device for every client",
                        "Crea un dispositivo per ogni client",
                    ),
                    "tracked_clients": ("Clients to follow", "Client da seguire"),
                },
                "data_description": {
                    "tracked_clients": (
                        "Each one gets a presence tracker, its signal, the node it is on and an "
                        "internet access switch.",
                        "Ognuno riceve un rilevatore di presenza, il segnale, il nodo a cui è "
                        "agganciato e un interruttore per l'accesso a internet.",
                    ),
                },
            }
        }
    },
    "services": {
        "kick_client": {
            "name": ("Disconnect a client", "Scollega un client"),
            "description": (
                "Disconnects a Wi-Fi client so that it joins the access point it hears best.",
                "Scollega un client Wi-Fi, che si riaggancia all'access point che sente meglio.",
            ),
            "fields": {
                "mac": {
                    "name": ("Hardware address", "Indirizzo MAC"),
                    "description": ("Address of the client.", "Indirizzo del client."),
                },
                "ban_seconds": {
                    "name": ("Keep away for", "Tieni lontano per"),
                    "description": (
                        "Seconds during which the node it was on refuses it.",
                        "Secondi durante i quali il nodo su cui era lo rifiuta.",
                    ),
                },
                "entry_id": {
                    "name": ("Network", "Rete"),
                    "description": (
                        "Only needed with more than one OpenWrt network.",
                        "Serve solo con più di una rete OpenWrt.",
                    ),
                },
            },
        },
        "block_client": {
            "name": ("Block internet for a client", "Blocca internet a un client"),
            "description": (
                "Adds or removes a firewall rule that keeps a client off the internet.",
                "Aggiunge o toglie una regola del firewall che tiene un client fuori da internet.",
            ),
            "fields": {
                "mac": {
                    "name": ("Hardware address", "Indirizzo MAC"),
                    "description": ("Address of the client.", "Indirizzo del client."),
                },
                "blocked": {
                    "name": ("Blocked", "Bloccato"),
                    "description": ("On to block, off to allow again.", "Acceso per bloccare, spento per riammettere."),
                },
                "entry_id": {
                    "name": ("Network", "Rete"),
                    "description": (
                        "Only needed with more than one OpenWrt network.",
                        "Serve solo con più di una rete OpenWrt.",
                    ),
                },
            },
        },
    },
}


def pick(node, index):
    if isinstance(node, tuple):
        return node[index]
    return {key: pick(value, index) for key, value in node.items()}


def build(index: int) -> dict:
    out = pick(TEXT, index)
    out["entity"] = {
        platform: {key: {"name": names[index]} for key, names in entries.items()}
        for platform, entries in ENTITIES.items()
    }
    return out


def main() -> None:
    (ROOT / "translations").mkdir(exist_ok=True)
    for path, index in (("strings.json", 0), ("translations/en.json", 0), ("translations/it.json", 1)):
        (ROOT / path).write_text(
            json.dumps(build(index), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print("written")


if __name__ == "__main__":
    main()
