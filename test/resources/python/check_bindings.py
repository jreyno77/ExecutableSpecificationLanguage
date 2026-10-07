import importlib.util
import json
import sys

sys.path.insert(0, sys.argv[1])
import libcst as cst
spec = importlib.util.spec_from_file_location("bindings", sys.argv[2])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
before = cst.parse_module('choice = 1\nchoice = 2\nvalue = choice\n')
after = cst.parse_module('choice = 1\nchoice = 2\nvalue = choice\n')

class Names(cst.CSTVisitor):
    def __init__(self):
        self.names = []

    def visit_Name(self, node):
        self.names.append(node)

old, new = Names(), Names()
before.visit(old)
after.visit(new)
target = lambda line, kind='statement': {"file": "case.py", "line": line, "column": 0, "kind": kind}
prior = {"uses": [{"file": "case.py", "start": 30, "targets": [target(1), target(2)]}]}
targets = [target(1), target(2)] if sys.argv[3] == 'same' else [target(2)] if sys.argv[3] == 'lost' else [target(1), target(2, 'function')]
current = {"uses": [{"file": "case.py", "start": 30, "targets": targets}]}
traces = {"case.py": {"file": "case.py", "before": before, "after": after, "names": dict(zip(old.names, new.names))}}
print(json.dumps(module.conflicts(prior, current, traces)))
