"""Echo Plugin — reference implementation for adOmnia Python plugins."""

import json
import time

from adomnia import api, log
from adomnia.worker import BaseWorker, action


class EchoPlugin(BaseWorker):
    def on_init(self, config: dict) -> None:
        log.info("Echo plugin initialized", config=str(config))

    @action("echo")
    def echo(self, payload: bytes) -> bytes:
        """Return the payload unchanged."""
        log.debug("echo called", size=str(len(payload)))
        return payload

    @action("analyze")
    def analyze(self, payload: bytes) -> bytes:
        """Analyze the current request from the composer."""
        request = api.get_current_request()
        env_vars = api.get_env_variables()

        analysis = {
            "request": {
                "method": request.get("method", ""),
                "url": request.get("url", ""),
                "header_count": len(request.get("headers", {})),
            },
            "environment": {
                "variable_count": len(env_vars),
                "variables": list(env_vars.keys()),
            },
            "timestamp": time.time(),
        }

        api.emit("analysis_complete", analysis)
        return json.dumps(analysis).encode()

    @action("stream_count", streaming=True)
    def stream_count(self, payload: bytes) -> bytes:
        """Stream numbers from 1 to N."""
        data = json.loads(payload) if payload else {}
        count = data.get("count", 10)

        for i in range(1, count + 1):
            api.emit("progress", {"percent": int(i / count * 100), "current": i})
            time.sleep(0.1)
            yield json.dumps({"number": i}).encode()

    def on_shutdown(self) -> None:
        log.info("Echo plugin shutting down")


if __name__ == "__main__":
    EchoPlugin.serve()
