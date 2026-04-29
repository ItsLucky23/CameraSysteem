"""Per-feature debug logging flags. Mirrors the Pi 5 cameraLogFlagStore.

The Pi 5 admin UI sends a setLogFlags command whenever an admin toggles a
debug switch for this camera. The command_executor calls set_log_flags with
the new full set, replacing the local one. Verbose log call sites use
is_log_enabled('feature') to gate their output so production logs stay clean.
State is in-memory only and resets on camera_node restart.
"""
from __future__ import annotations

# The same feature names defined in server/utils/cameraLogFlagStore.ts. Keep
# in sync — adding a feature requires adding it here and on the Pi 5.
KNOWN_FEATURES = frozenset({
    "ir",
    "recording",
    "performance",
    "streamPipeline",
    "commandQueue",
})


_active: set[str] = set()


def set_log_flags(features: set[str]) -> set[str]:
    """Replace the active feature set. Unknown features are silently dropped
    rather than erroring — Pi 5 may add a feature before the Pi Zero has been
    redeployed, and we'd rather skip it than fail the command."""
    cleaned = {f for f in features if f in KNOWN_FEATURES}
    _active.clear()
    _active.update(cleaned)
    return set(_active)


def is_log_enabled(feature: str) -> bool:
    return feature in _active


def get_active_features() -> set[str]:
    return set(_active)
