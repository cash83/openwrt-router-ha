"""Put the router's rights file where the integration and the app can install it themselves.

The source is openwrt/openwrt-router-ha.json. It is copied into the integration,
and packed (as the one-file archive the router's "restore backup" unpacks) into
a script for the Android app. Run it after changing the rights file.
"""

from __future__ import annotations

import base64
import gzip
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "openwrt" / "openwrt-router-ha.json"
TARGET = "usr/share/rpcd/acl.d/openwrt-router-ha.json"
MARK_PREFIX = "/openwrt-router-ha/v"


def mark(text: str) -> str:
    """The made-up path whose read right tells which version of the file a router has."""
    files = json.loads(text)["openwrt-router-ha"]["read"]["file"]
    return next(key for key in files if key.startswith(MARK_PREFIX))


def archive(text: str) -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        data = text.encode()
        info = tarfile.TarInfo(TARGET)
        info.size = len(data)
        info.mode = 0o644
        tar.addfile(info, io.BytesIO(data))
    packed = io.BytesIO()
    with gzip.GzipFile(fileobj=packed, mode="wb", mtime=0) as out:
        out.write(raw.getvalue())
    return packed.getvalue()


def main() -> None:
    text = SOURCE.read_text(encoding="utf-8")
    (ROOT / "custom_components" / "openwrt_router" / "openwrt-router-ha.json").write_text(
        text, encoding="utf-8", newline="\n"
    )
    script = (
        "/* Written by tools/make_acl.py from openwrt/openwrt-router-ha.json. */\n"
        f"window.ROUTER_ACL = {{ mark: {json.dumps(mark(text))}, "
        f"archive: {json.dumps(base64.b64encode(archive(text)).decode())} }};\n"
    )
    (ROOT / "android" / "app" / "src" / "main" / "assets" / "acl.js").write_text(
        script, encoding="utf-8", newline="\n"
    )
    print("written, mark", mark(text))


if __name__ == "__main__":
    main()
