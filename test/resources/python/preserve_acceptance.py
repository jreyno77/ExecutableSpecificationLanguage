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
after = [{**before[0], "text": data["desired"]}] if 'desired' in data else []
problems = module.check(before, root)
rewritten = []
traces = {}
if not problems:
    rewritten, problems = module.preserve(before, after, root, ["case.py"], traces, data.get('identities'), data.get('facts'))
renamed = []
for trace in traces.values():
    positions = module.MetadataWrapper(trace['after'], unsafe_skip_copy=True).resolve(module.PositionProvider)
    renamed.extend({'before': old.value, 'after': new.value, 'survives': new in positions}
                   for old, new in trace['names'].items() if old.value != new.value)
print(json.dumps({"rewritten": rewritten, "problems": problems, "renamed": renamed}))
