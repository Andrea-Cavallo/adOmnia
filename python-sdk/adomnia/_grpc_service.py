"""Lightweight gRPC service registration for adOmnia workers.

Uses a JSON encoding approach for message serialization rather than
full protobuf compilation. This simplifies the plugin development
experience while maintaining gRPC transport benefits.
"""

import base64
import json
from concurrent import futures

import grpc


def _to_wire(value):
    """Not used directly — we handle serialization manually."""
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, dict):
        return {key: _to_wire(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_wire(item) for item in value]
    return value


def _json_serialize(msg):
    """Serialize a dict to bytes for gRPC transport."""
    return json.dumps(_to_wire(msg)).encode("utf-8")


def _json_deserialize(data, _unused=None):
    """Deserialize bytes from gRPC transport to dict."""
    if not data:
        return {}
    request = json.loads(data.decode("utf-8"))
    payload = request.get("payload")
    if isinstance(payload, str):
        raw_payload = base64.b64decode(payload)
        try:
            request["payload"] = json.loads(raw_payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            request["payload"] = raw_payload
    return request


class _MethodHandler(grpc.RpcMethodHandler):
    """Generic unary-unary method handler."""

    def __init__(self, handler_fn, request_deserializer, response_serializer, stream_response=False):
        self.request_streaming = False
        self.response_streaming = stream_response
        self.request_deserializer = request_deserializer
        self.response_serializer = response_serializer
        if stream_response:
            self.unary_unary = None
            self.unary_stream = handler_fn
            self.stream_unary = None
            self.stream_stream = None
        else:
            self.unary_unary = handler_fn
            self.unary_stream = None
            self.stream_unary = None
            self.stream_stream = None


class _WorkerGenericHandler(grpc.GenericRpcHandler):
    """Routes incoming gRPC calls to the servicer methods."""

    def __init__(self, servicer):
        self._servicer = servicer
        self._methods = {}
        service_name = "adomnia.worker.WorkerService"

        # Register methods
        for method_name in ["Init", "Execute", "Ping", "Shutdown"]:
            full_name = f"/{service_name}/{method_name}"
            handler_fn = getattr(servicer, method_name)
            self._methods[full_name] = _MethodHandler(
                self._make_unary_handler(handler_fn),
                _json_deserialize,
                _json_serialize,
                stream_response=False,
            )

        # ExecuteStream is server-streaming
        full_name = f"/{service_name}/ExecuteStream"
        self._methods[full_name] = _MethodHandler(
            self._make_stream_handler(servicer.ExecuteStream),
            _json_deserialize,
            _json_serialize,
            stream_response=True,
        )

    def _make_unary_handler(self, fn):
        def handler(request, context):
            result = fn(request, context)
            return result
        return handler

    def _make_stream_handler(self, fn):
        def handler(request, context):
            for chunk in fn(request, context):
                yield chunk
        return handler

    def service(self, handler_call_details):
        method = handler_call_details.method
        return self._methods.get(method)


def register_service(server, servicer):
    """Register a WorkerServicer with the gRPC server."""
    handler = _WorkerGenericHandler(servicer)
    server.add_generic_rpc_handlers([handler])
