from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


_TRUE_VALUES = {"1", "true", "yes", "on"}


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in _TRUE_VALUES


def _parse_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _parse_float(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value.strip())
    except ValueError:
        return default


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"")

        if key:
            os.environ.setdefault(key, value)


@dataclass(slots=True)
class NodeSettings:
    pi5_base_url: str
    node_id: str
    node_secret: str
    camera_id: str
    adapter: str
    poll_interval_ms: int
    telemetry_interval_sec: float
    command_batch_limit: int
    http_timeout_sec: float
    verify_tls: bool
    log_level: str
    ptz_step: int
    cpu_temp_path: str
    ir_gpio_pin: int | None
    pan_servo_gpio_pin: int | None
    tilt_servo_gpio_pin: int | None
    recording_start_command: str | None
    recording_stop_command: str | None


def _parse_optional_int(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    try:
        return int(value.strip())
    except ValueError:
        return None


def load_settings() -> NodeSettings:
    env_file = os.getenv("PI_ZERO_ENV_FILE", ".env")
    _load_env_file(Path(env_file))

    pi5_base_url = os.getenv("PI5_BASE_URL", "").strip().rstrip("/")
    node_id = os.getenv("NODE_ID", "").strip()
    node_secret = os.getenv("NODE_SECRET", "").strip()
    camera_id = os.getenv("CAMERA_ID", "").strip()

    missing = [
        key
        for key, value in {
            "PI5_BASE_URL": pi5_base_url,
            "NODE_ID": node_id,
            "NODE_SECRET": node_secret,
            "CAMERA_ID": camera_id,
        }.items()
        if not value
    ]

    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"Missing required environment values: {joined}")

    settings = NodeSettings(
        pi5_base_url=pi5_base_url,
        node_id=node_id,
        node_secret=node_secret,
        camera_id=camera_id,
        adapter=os.getenv("HARDWARE_ADAPTER", "mock").strip().lower() or "mock",
        poll_interval_ms=max(200, _parse_int(os.getenv("POLL_INTERVAL_MS"), 750)),
        telemetry_interval_sec=max(1.0, _parse_float(os.getenv("TELEMETRY_INTERVAL_SEC"), 5.0)),
        command_batch_limit=max(1, min(100, _parse_int(os.getenv("COMMAND_BATCH_LIMIT"), 20))),
        http_timeout_sec=max(1.0, _parse_float(os.getenv("HTTP_TIMEOUT_SEC"), 8.0)),
        verify_tls=_parse_bool(os.getenv("VERIFY_TLS"), True),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO",
        ptz_step=max(1, _parse_int(os.getenv("PTZ_STEP"), 5)),
        cpu_temp_path=os.getenv("CPU_TEMP_PATH", "/sys/class/thermal/thermal_zone0/temp").strip(),
        ir_gpio_pin=_parse_optional_int(os.getenv("IR_GPIO_PIN")),
        pan_servo_gpio_pin=_parse_optional_int(os.getenv("PAN_SERVO_GPIO_PIN")),
        tilt_servo_gpio_pin=_parse_optional_int(os.getenv("TILT_SERVO_GPIO_PIN")),
        recording_start_command=(os.getenv("RECORDING_START_COMMAND") or "").strip() or None,
        recording_stop_command=(os.getenv("RECORDING_STOP_COMMAND") or "").strip() or None,
    )

    return settings
