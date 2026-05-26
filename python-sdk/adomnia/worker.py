"""Base worker class for adOmnia plugins."""

import json
import os
import time
import signal
import sys
from concurrent import futures
from functools import wraps
from typing import Callable, Generator

import grpc


_ACTIONS_REGISTRY: dict[str, dict] = {}


def action(name: str, streaming: bool = False):
    """Decorator to register a method as a plugin action."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
        wrapper._action_name = name
        wrapper._streaming = streaming
        _ACTIONS_REGISTRY[name] = {"func": wrapper, "streaming": streaming}
        return wrapper
    return decorator


class BaseWorker:
    """Base class for adOmnia plugin workers.

    Subclass this and decorate methods with @action to expose them.
    Call MyPlugin.serve() to start the gRPC server.
    """

    def __init__(self):
        self._start_time = time.time()
        self._config: dict = {}
        self._data_dir: str = ""

    def on_init(self, config: dict) -> None:
        """Override to perform initialization with plugin config."""
        pass

    def on_shutdown(self) -> None:
        """Override to perform cleanup before shutdown."""
        pass

    @classmethod
    def serve(cls):
        """Start the gRPC server and register all actions."""
        port = int(os.environ.get("ADOMNIA_GRPC_PORT", "0"))
        if port == 0:
            print("ERROR: ADOMNIA_GRPC_PORT not set", file=sys.stderr)
            sys.exit(1)

        instance = cls()

        # Collect actions from the class
        for attr_name in dir(instance):
            attr = getattr(instance, attr_name)
            if callable(attr) and hasattr(attr, "_action_name"):
                _ACTIONS_REGISTRY[attr._action_name] = {
                    "func": attr,
                    "streaming": attr._streaming,
                }

        server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
        servicer = _WorkerServicer(instance)
        _register_worker_service(server, servicer)

        server.add_insecure_port(f"localhost:{port}")
        server.start()

        print(f"[adomnia-worker] listening on port {port}", file=sys.stderr)

        def _shutdown(signum, frame):
            instance.on_shutdown()
            server.stop(grace=5)
            sys.exit(0)

        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)

        server.wait_for_termination()


class _WorkerServicer:
    """gRPC servicer implementing WorkerService."""

    def __init__(self, worker: BaseWorker):
        self._worker = worker
        self._start_time = time.time()

    def Init(self, request, context):
        config = dict(request.get("config", {}))
        data_dir = request.get("data_dir", "")
        self._worker._config = config
        self._worker._data_dir = data_dir

        try:
            self._worker.on_init(config)
            return {"ready": True, "error": ""}
        except Exception as e:
            return {"ready": False, "error": str(e)}

    def Execute(self, request, context):
        action_name = request.get("action", "")
        payload = request.get("payload", b"")

        if action_name not in _ACTIONS_REGISTRY:
            return {
                "success": False,
                "result": b"",
                "error": f"unknown action: {action_name}",
                "duration_ms": 0,
            }

        entry = _ACTIONS_REGISTRY[action_name]
        if entry["streaming"]:
            return {
                "success": False,
                "result": b"",
                "error": f"action {action_name} is streaming, use ExecuteStream",
                "duration_ms": 0,
            }

        start = time.time()
        try:
            result = entry["func"](payload)
            if isinstance(result, str):
                result = result.encode()
            elif not isinstance(result, bytes):
                result = json.dumps(result).encode()
            elapsed = int((time.time() - start) * 1000)
            return {
                "success": True,
                "result": result,
                "error": "",
                "duration_ms": elapsed,
            }
        except Exception as e:
            elapsed = int((time.time() - start) * 1000)
            return {
                "success": False,
                "result": b"",
                "error": str(e),
                "duration_ms": elapsed,
            }

    def ExecuteStream(self, request, context):
        action_name = request.get("action", "")
        payload = request.get("payload", b"")

        if action_name not in _ACTIONS_REGISTRY:
            yield {"data": b"", "is_final": True, "error": f"unknown action: {action_name}"}
            return

        entry = _ACTIONS_REGISTRY[action_name]
        try:
            gen = entry["func"](payload)
            for chunk in gen:
                if isinstance(chunk, str):
                    chunk = chunk.encode()
                elif not isinstance(chunk, bytes):
                    chunk = json.dumps(chunk).encode()
                yield {"data": chunk, "is_final": False, "error": ""}
            yield {"data": b"", "is_final": True, "error": ""}
        except Exception as e:
            yield {"data": b"", "is_final": True, "error": str(e)}

    def Ping(self, request, context):
        uptime_ms = int((time.time() - self._start_time) * 1000)
        memory = 0
        try:
            import psutil

            proc = psutil.Process(os.getpid())
            memory = proc.memory_info().rss
        except Exception:
            pass

        return {"uptime_ms": uptime_ms, "memory_bytes": memory}

    def Shutdown(self, request, context):
        self._worker.on_shutdown()
        return {"clean": True}


def _register_worker_service(server, servicer):
    """Register the WorkerService with a simple JSON-over-gRPC approach.

    For the MVP, we use a lightweight implementation that serializes
    messages as JSON. A full protobuf implementation would use generated stubs.
    """
    from adomnia._grpc_service import register_service
    register_service(server, servicer)
