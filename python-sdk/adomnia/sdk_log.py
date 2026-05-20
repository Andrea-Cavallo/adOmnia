"""adOmnia SDK structured logging — forwarded to Go logger."""

import json
import os

import grpc


class _Logger:
    """Structured logger that sends log entries to Go via gRPC."""

    def __init__(self):
        self._channel = None

    def _get_channel(self) -> grpc.Channel:
        if self._channel is None:
            port = os.environ.get("ADOMNIA_SDK_PORT", "0")
            self._channel = grpc.insecure_channel(f"localhost:{port}")
        return self._channel

    def _log(self, level: str, message: str, **fields):
        channel = self._get_channel()
        str_fields = {k: str(v) for k, v in fields.items()}
        try:
            channel.unary_unary(
                "/adomnia.sdk.AdOmniaAPI/Log",
                request_serializer=_serialize,
                response_deserializer=_deserialize,
            )({"level": level, "message": message, "fields": str_fields})
        except Exception:
            import sys
            print(f"[{level.upper()}] {message} {str_fields}", file=sys.stderr)

    def debug(self, message: str, **fields):
        self._log("debug", message, **fields)

    def info(self, message: str, **fields):
        self._log("info", message, **fields)

    def warn(self, message: str, **fields):
        self._log("warn", message, **fields)

    def error(self, message: str, **fields):
        self._log("error", message, **fields)


def _serialize(msg: dict) -> bytes:
    return json.dumps(msg).encode("utf-8")


def _deserialize(data: bytes) -> dict:
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


# Singleton instance
log = _Logger()
