from __future__ import annotations

import logging


def configure_logging(level: str) -> None:
    normalized = level.upper().strip() or "INFO"
    logging.basicConfig(
        level=getattr(logging, normalized, logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
