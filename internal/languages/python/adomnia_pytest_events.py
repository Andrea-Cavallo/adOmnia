"""adOmnia pytest plugin: writes machine-readable test events for the IDE test tree.

It only appends JSON lines to the file named by ADOMNIA_PYTEST_EVENTS and prints one
marker line so the host knows every event is flushed. It never changes test results.
"""

from __future__ import annotations

import json
import os

_EVENTS = os.environ.get("ADOMNIA_PYTEST_EVENTS")
# Absolute test file per node id: reports only carry the rootdir-relative path.
_FILES = {}


def _emit(payload) -> None:
    if not _EVENTS:
        return
    try:
        with open(_EVENTS, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _file_of(source) -> str:
    path = getattr(source, "path", None)
    if path is not None:
        return str(path)
    fspath = getattr(source, "fspath", None)
    return str(fspath) if fspath is not None else ""


def _skip_reason(report) -> str:
    longrepr = getattr(report, "longrepr", None)
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        return str(longrepr[2])
    return str(longrepr or "")


def _failure_line(report) -> int:
    longrepr = getattr(report, "longrepr", None)
    crash = getattr(longrepr, "reprcrash", None)
    lineno = getattr(crash, "lineno", None)
    if isinstance(lineno, int) and lineno > 0:
        return lineno
    location = getattr(report, "location", None) or ()
    if len(location) > 1 and isinstance(location[1], int):
        return location[1]
    return 0


def pytest_collection_finish(session) -> None:
    for item in session.items:
        path = _file_of(item)
        if path:
            _FILES[item.nodeid] = path
        _emit({"event": "collect", "nodeid": item.nodeid, "file": path})


def pytest_collectreport(report) -> None:
    if report.failed:
        _emit({"event": "collecterror", "nodeid": report.nodeid, "file": _file_of(report),
               "longrepr": str(report.longrepr)})


def pytest_runtest_logreport(report) -> None:
    payload = {"event": "report", "nodeid": report.nodeid,
               "file": _FILES.get(report.nodeid) or _file_of(report),
               "when": report.when, "outcome": report.outcome,
               "duration": round(float(getattr(report, "duration", 0.0) or 0.0), 6),
               "line": _failure_line(report)}
    wasxfail = getattr(report, "wasxfail", None)
    if wasxfail:
        payload["xfail"] = str(wasxfail)
    elif report.skipped:
        payload["skipreason"] = _skip_reason(report)
    if report.failed:
        payload["longrepr"] = str(report.longrepr)
    _emit(payload)


def pytest_sessionfinish(session, exitstatus) -> None:
    _emit({"event": "end"})


def pytest_unconfigure(config) -> None:
    # Printed last, after the "end" event: the host reads the remaining events on this line.
    print("adomnia: pytest events recorded")
