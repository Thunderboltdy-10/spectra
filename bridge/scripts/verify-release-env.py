"""Fails a Bridge release build whose baked-in deployment is missing or local."""
import os
from urllib.parse import urlparse

for name in ("SPECTRA_CONVEX_URL", "SPECTRA_ORIGINS"):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} must be supplied; localhost defaults are not release configuration")

parsed = urlparse(os.environ["SPECTRA_CONVEX_URL"])
if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise SystemExit("SPECTRA_CONVEX_URL must be a complete http:// or https:// URL")
if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
    raise SystemExit("SPECTRA_CONVEX_URL must point to a hosted deployment without credentials, query, or fragment")

for origin in os.environ["SPECTRA_ORIGINS"].split(","):
    parsed = urlparse(origin.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
        raise SystemExit(f"SPECTRA_ORIGINS contains an invalid origin: {origin!r}")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SystemExit(f"SPECTRA_ORIGINS must contain hosted origins without credentials, query, or fragment: {origin!r}")
