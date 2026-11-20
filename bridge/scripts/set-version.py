"""Stamp the release version into the app before a release build.

The release tag (`desktop-v<version>`) is the only place a release's version is
written. The release workflow runs this with that version, so the installer,
the updater manifest and the version the app reports all come from the tag.
The versions committed in the files are only what local builds report.

Usage: python bridge/scripts/set-version.py 0.2.0
"""

import json
import re
import sys
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
CRATES = ("spectra-bridge", "spectra-bridge-core")


def replace_once(text: str, pattern: str, replacement: str, what: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        sys.exit(f"Could not find {what}.")
    return updated


def main() -> None:
    if len(sys.argv) != 2 or not SEMVER.match(sys.argv[1]):
        sys.exit("Give the version as MAJOR.MINOR.PATCH, such as 0.2.0.")
    version = sys.argv[1]

    conf_path = BRIDGE / "bridge-app" / "tauri.conf.json"
    conf = replace_once(
        conf_path.read_text(encoding="utf-8"),
        r'^(  "version": )"[^"]*"',
        rf'\g<1>"{version}"',
        "the version in bridge/bridge-app/tauri.conf.json",
    )
    if json.loads(conf)["version"] != version:
        sys.exit("tauri.conf.json did not take the version.")
    conf_path.write_text(conf, encoding="utf-8")

    cargo_path = BRIDGE / "Cargo.toml"
    cargo = cargo_path.read_text(encoding="utf-8")
    cargo = replace_once(
        cargo,
        r'(\[workspace\.package\][^\[]*?^version = )"[^"]*"',
        rf'\g<1>"{version}"',
        "the version under [workspace.package] in bridge/Cargo.toml",
    )
    cargo_path.write_text(cargo, encoding="utf-8")

    lock_path = BRIDGE / "Cargo.lock"
    lock = lock_path.read_text(encoding="utf-8")
    for crate in CRATES:
        lock = replace_once(
            lock,
            rf'(^name = "{re.escape(crate)}"\nversion = )"[^"]*"',
            rf'\g<1>"{version}"',
            f"{crate} in bridge/Cargo.lock",
        )
    lock_path.write_text(lock, encoding="utf-8")

    print(f"Spectra for desktop {version}")


if __name__ == "__main__":
    main()
