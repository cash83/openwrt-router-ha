# OpenWrt Router for Home Assistant

Routers and access points running OpenWrt, read over ubus (the JSON interface behind LuCI).
One router is the entry point; the other access points of the same network are found
through `usteer` and use the same login.

## What you get

- **A device per node** with the devices attached to it (total, 2.4 GHz, 5 GHz), processor
  and memory load, uptime, firmware, lights, a restart button, and for satellites the mesh
  link (signal and rates).
- **The network as a whole** on the main router: internet state, public IP, WAN address,
  gateway, DNS, traffic totals, current speed, who is using the most, DHCP range.
- **Wi-Fi settings**: on/off, hidden, isolation, standard, channel width, power and channel.
  They are kept equal on every node, except the channel of a band that carries no link
  between nodes, which each node chooses for itself.
- **Clients you choose to follow**: presence, signal, the node they are on, and a switch
  that cuts their internet access.
- **Services** `openwrt_router.kick_client` and `openwrt_router.block_client`.
- **A page in the sidebar** ("Wi-Fi") designed for a phone: state of the network, the
  nodes, the Wi-Fi settings and the list of devices with quick actions. It loads nothing
  from the internet, so it opens the same way at home and through a VPN.

## Router side

Each router needs LuCI (`uhttpd-mod-ubus`, `rpcd`, `luci-base`) and, to list the other
nodes, `usteer`. Reading works with the rights a LuCI login already has. Changing things
needs a few more; install the rights file on every node:

    scp openwrt/openwrt-router-ha.json root@ROUTER:/usr/share/rpcd/acl.d/
    ssh root@ROUTER 'echo /usr/share/rpcd/acl.d/openwrt-router-ha.json >> /etc/sysupgrade.conf; /etc/init.d/rpcd restart'

Without it the lights, the radio restart and the exact processor load are not available
(the load average is shown instead).

A radio that carries both an access point and the link between nodes does not bring the
access point back after a plain reload. The integration restarts that radio after every
change, which costs about half a minute of Wi-Fi on that band.

## Install

Copy `custom_components/openwrt_router` into the `custom_components` folder of Home
Assistant, restart, then add "OpenWrt Router" from Settings > Devices & services.

## Development

    python -m pytest tests            # no Home Assistant needed
    python tools/make_translations.py # after editing the texts
    python -m http.server 8770        # then open /preview/index.html

## Android app ("Wi-Fi di casa")

The `android` folder holds a small app that shows the same page as the sidebar. It can
reach the network in two ways, chosen on its first screen:

- **Home Assistant**: you type its address and sign in on Home Assistant's own login
  page. The app keeps only the refresh token it is handed, encrypted on the phone.
  With the switch on, it asks Home Assistant for its Nabu Casa address and uses it when
  the home address does not answer.
- **Router only**: address, user and password of the OpenWrt router; the app talks to
  it directly (`assets/direct.js` mirrors `api.py`). Works on the home network or
  through a VPN. The public IP is asked by the router itself (needs the rights file).

Build (JDK 17, Gradle 8.7, Android SDK 35): `gradle assembleDebug` in `android`.
