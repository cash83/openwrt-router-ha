# OpenWrt Router for Home Assistant

<img src="icon.png" width="96" align="right" alt="">

**Integration, sidebar page and Android app for routers running OpenWrt.**
Not affiliated with the OpenWrt project.

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
- **New devices**: a client never seen before is marked "new" for a day, the event
  `openwrt_router_new_device` is fired, and a notify service can be named in the options
  to get a notification on the phone.
- **Data used** by each device since it joined its node (the counters restart when it
  reconnects or changes node).
- **Send a device to a node**: from its card, "connect to" another node. The other nodes
  turn it away for a minute, so it joins the chosen one; afterwards it is free to roam.
- **Services** `openwrt_router.kick_client` and `openwrt_router.block_client`.
- **The router's own sections in that page**: the sliders button at the top right opens
  status, system and network of each node (log, DHCP and static addresses, port forwards,
  services, packages, backup, diagnostics), the same pages the Android app shows.
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

With HACS: add `https://github.com/cash83/openwrt-router-ha` as a custom repository of
type "Integration", install "OpenWrt Router" and restart Home Assistant. By hand: copy
`custom_components/openwrt_router` into the `custom_components` folder and restart.
Then add "OpenWrt Router" from Settings > Devices & services.

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

The ready-made APK is attached to each [release](https://github.com/cash83/openwrt-router-ha/releases).
It is signed with a development key, so Android asks to allow installation from the
browser or file manager you open it with.

The menu button at the top left opens the one menu of the app: the router's own
sections (status, system, network), drawn by the app in its own style, and the
connection. Per node you get the overview, live traffic, the system log, a scan of the
neighbouring channels, processes, routes, the services, scheduled commands, interfaces,
DHCP with static addresses (add, edit, remove), port forwards (add, switch off, remove),
ping / traceroute / name lookup, and the roaming view. Through Home Assistant these
readings are relayed by the integration, and only the ones listed in `passthrough.py`:
nothing that returns a password, no command with free arguments. The router's web
interface is still one tap away for the rest (firmware, restoring a backup).
The configuration backup of each node is saved to the phone's Download folder.

From the same pages you can also change things: search the package catalogue, install
and remove packages; the Wi-Fi name and password (on every node); the DHCP range, lease
time and the DNS handed to devices; the time zone; and, in router-only mode, the
router's own password (on every node, the app remembers the new one).

Build it yourself (JDK 17, Gradle 8.7, Android SDK 35): `gradle assembleDebug` in `android`.
