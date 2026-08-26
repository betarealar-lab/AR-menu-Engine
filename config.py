"""Key loading. Put the key in a file once instead of exporting it every session."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"


def load_env() -> None:
    """Read .env into os.environ. Real environment variables always win."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def meshy_key() -> str:
    load_env()
    key = os.environ.get("MESHY_API_KEY", "")
    if not key:
        raise RuntimeError(
            "No Meshy key found.\n"
            f"  Create one at https://meshy.ai/settings/api (shown once), then put it in\n"
            f"  {ENV_FILE}\n"
            f"  as a single line:  MESHY_API_KEY=msy_...\n"
            "  That file is gitignored. Never commit it or put it in client-side code."
        )
    return key


def masked(key: str) -> str:
    return f"{key[:8]}...{key[-4:]}" if len(key) > 14 else "***"
