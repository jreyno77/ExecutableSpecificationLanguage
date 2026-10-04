import importlib.util
import json
import pathlib
import sys

sys.path.insert(0, sys.argv[1])
spec = importlib.util.spec_from_file_location("integrity", sys.argv[2])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = pathlib.Path(sys.argv[3])
data = json.loads((root / "request.json").read_text())
before = [{"file": "case.py", "text": data["before"], "driver": data["driver"]}]
after = [{**before[0], "text": data["desired"]}]
problems = module.check(before, root)
rewritten = []
if not problems:
    rewritten, problems = module.preserve(before, after, root, ["case.py"], {})
print(json.dumps({"rewritten": rewritten, "problems": problems}))
