import json
import pathlib
import runpy
import sys
import sysconfig

root, inspector = pathlib.Path(sys.argv[2]), sys.argv[3]
path = root.parent / 'request.json'
request = json.loads(path.read_text())
request.update(root=str(root), cache=str(root.parent / 'cache'), sites=[sys.argv[1]],
               paths=sys.path + [sys.argv[1]], stdlib=[sysconfig.get_path('stdlib')], main=['src'], mainPaths=[str(root / 'src')], testPaths=[])
path.write_text(json.dumps(request))
sys.argv = [inspector, str(path)]
runpy.run_path(inspector, run_name='__main__')
