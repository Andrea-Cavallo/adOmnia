"""adOmnia SDK API — access adOmnia state from Python workers."""

import base64
import json
import os

import grpc


class _StorageAPI:
    """Plugin-specific key-value storage."""

    def __init__(self, parent: "_AdOmniaAPI"):
        self._parent = parent

    def get(self, key: str) -> bytes | None:
        channel = self._parent._get_channel()
        resp = channel.unary_unary(
            "/adomnia.sdk.AdOmniaAPI/StorageGet",
            request_serializer=_serialize,
            response_deserializer=_deserialize,
        )({"key": key})
        if resp.get("found"):
            value = resp.get("value", b"")
            if isinstance(value, str):
                return base64.b64decode(value)
            return value
        return None

    def set(self, key: str, value: str | bytes) -> None:
        if isinstance(value, str):
            value = value.encode()
        channel = self._parent._get_channel()
        channel.unary_unary(
            "/adomnia.sdk.AdOmniaAPI/StorageSet",
            request_serializer=_serialize,
            response_deserializer=_deserialize,
        )({"key": key, "value": value})


class _AdOmniaAPI:
    """Main SDK API for accessing adOmnia state."""

    def __init__(self):
        self._channel = None
        self.storage = _StorageAPI(self)

    def _get_channel(self) -> grpc.Channel:
        if self._channel is None:
            port = os.environ.get("ADOMNIA_SDK_PORT", "0")
            self._channel = grpc.insecure_channel(f"localhost:{port}")
        return self._channel

    def get_current_request(self) -> dict:
        """Get the current HTTP request from the composer."""
        channel = self._get_channel()
        resp = channel.unary_unary(
            "/adomnia.sdk.AdOmniaAPI/GetCurrentRequest",
            request_serializer=_serialize,
            response_deserializer=_deserialize,
        )({})
        return resp

    def get_env_variables(self) -> dict[str, str]:
        """Get the active environment variables."""
        channel = self._get_channel()
        resp = channel.unary_unary(
            "/adomnia.sdk.AdOmniaAPI/GetEnvVariables",
            request_serializer=_serialize,
            response_deserializer=_deserialize,
        )({})
        return resp.get("variables", {})

    def emit(self, event_name: str, payload: dict | None = None) -> None:
        """Emit an event to the frontend."""
        channel = self._get_channel()
        data = json.dumps(payload).encode() if payload else b"{}"
        channel.unary_unary(
            "/adomnia.sdk.AdOmniaAPI/EmitEvent",
            request_serializer=_serialize,
            response_deserializer=_deserialize,
        )({"name": event_name, "payload": data})


def _serialize(msg: dict) -> bytes:
    def encode(value):
        if isinstance(value, bytes):
            return base64.b64encode(value).decode("ascii")
        if isinstance(value, dict):
            return {key: encode(item) for key, item in value.items()}
        if isinstance(value, list):
            return [encode(item) for item in value]
        return value

    return json.dumps(encode(msg)).encode("utf-8")


def _deserialize(data: bytes) -> dict:
    if not data:
        return {}
    return json.loads(data.decode("utf-8"))


# Singleton instance
api = _AdOmniaAPI()
