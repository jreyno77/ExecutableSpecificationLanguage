"""Private exact pytest execution; reports contain native phase observations."""
import _thread
import contextlib
import json
import os
import pathlib
import sys
import threading

request = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
report_path = pathlib.Path(request["report"])
sys.path[:] = request["stdlib"] + [str(pathlib.Path(path) / "lib-dynload") for path in request["stdlib"]
                                  if (pathlib.Path(path) / "lib-dynload").is_dir()] + request["sites"]
os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
for key in ("PYTEST_ADDOPTS", "PYTEST_PLUGINS"):
    os.environ.pop(key, None)
import pytest

sys.path[:0] = request["roots"] + request["sourcePath"]
observations = {"collected": [], "phases": [], "errors": [], "cancelled": False}
expected = request["selected"]

class Reports:
    def pytest_collection_finish(self, session):
        observations["collected"] = [{"nodeid": item.nodeid, "file": item.location[0], "line": item.location[1] + 1}
                               for item in session.items]
        actual = [item.nodeid for item in session.items]
        if sorted(actual) != sorted(expected) or len(set(actual)) != len(actual):
            raise pytest.UsageError("Native collection did not exactly match the selected generated cases.")

    def pytest_collectreport(self, report):
        if report.failed:
            observations["errors"].append(str(report.longrepr))

    def pytest_runtest_logreport(self, report):
        observed = report
        observations["phases"].append({"nodeid": observed.nodeid, "file": observed.location[0],
                                 "line": observed.location[1] + 1, "when": observed.when,
                                 "outcome": observed.outcome, "xfail": hasattr(observed, "wasxfail"),
                                 "detail": str(observed.longrepr) if observed.longrepr else "", "sections": observed.sections})

    def pytest_internalerror(self, excrepr):
        observations["errors"].append(str(excrepr))

    def pytest_keyboard_interrupt(self, excinfo):
        observations["cancelled"] = True


channel = os.dup(0)
def cancellation():
    try:
        pending = b""
        while data := os.read(channel, 64):
            pending += data
            if b"cancel\n" in pending:
                observations["cancelled"] = True
                _thread.interrupt_main()
                return
    finally:
        os.close(channel)

threading.Thread(target=cancellation, daemon=True).start()
code = 3
try:
    if pytest.__version__ != "9.1.1":
        raise RuntimeError("The controlled Python profile requires pytest9.1.1.")
    with contextlib.redirect_stdout(sys.stderr):
        code = int(pytest.main(["-q", "-c", request["config"], "--rootdir", request["root"],
                               "--confcutdir", request["root"], "--import-mode=importlib", "-p", "no:cacheprovider",
                               *expected], plugins=[Reports()]))
except BaseException as error:
    observations["errors"].append(type(error).__name__ + ": " + str(error))
finally:
    report_path.write_text(json.dumps(observations, ensure_ascii=True), encoding="utf-8")
sys.exit(code)
