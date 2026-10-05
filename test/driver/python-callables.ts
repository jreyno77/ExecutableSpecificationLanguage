import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPython } from '../../src/project/python/python-process.js';
import type { PythonFacts } from '../../src/project/python/python-inspection.js';

/** The real shipped lookup bridge over explicit small source files, without a full project capture. */
export class PythonCallableDriver {
  private root = '';
  facts!: PythonFacts;
  stderr = '';
  constructor(readonly files: Record<string, string>) {}
  async initialize(): Promise<void> {
    this.root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-callables-'));
    for (const [file, text] of Object.entries(this.files)) {
      await fs.mkdir(dirname(join(this.root, file)), { recursive: true });
      await fs.writeFile(join(this.root, file), text);
    }
  }
  async inspect(): Promise<void> {
    const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
    if (!python || !sites) throw Error('Provide the explicit native Python and pinned Jedi/LibCST site directory.');
    const request = { root: this.root, cache: join(this.root, 'jedi-cache'), files: Object.keys(this.files), sites: [sites],
      main: ['src'], mainPaths: [join(this.root, 'src')], testPaths: [], sourcePaths: [] };
    const input = join(this.root, 'request.json'); await fs.writeFile(input, JSON.stringify(request));
    const bootstrap = 'import json,pathlib,runpy,sys,sysconfig; path=pathlib.Path(sys.argv[2]); request=json.loads(path.read_text()); '
      + 'request["stdlib"]=[sysconfig.get_path("stdlib")]; request["paths"]=request["sites"]+request["stdlib"]; '
      + 'path.write_text(json.dumps(request),encoding="utf8"); sys.argv=[sys.argv[1],str(path)]; runpy.run_path(sys.argv[0],run_name="__main__")';
    const result = await runPython(python, ['-c', bootstrap, fileURLToPath(new URL('../../src/project/python/runtime/inspect.py', import.meta.url)), input], this.root);
    this.stderr = result.error ?? '';
    if (result.code !== 0 || result.error) throw Error('Actual native lookup failed: ' + JSON.stringify(result));
    this.facts = JSON.parse(result.text) as PythonFacts;
  }
  site(file: string, start: number, end = start): { line: number; column: number; token: string } {
    const text = this.files[file]; if (text === undefined) throw Error('Returned site is outside explicit source: ' + file);
    const lines = text.slice(0, start).split('\n');
    return { line: lines.length, column: [...lines.at(-1)!].length, token: text.slice(start, end) };
  }
  target(file: string, token: string, line: number): { file: string; line: number; column: number } {
    const text = this.files[file]?.split('\n')[line - 1]; if (text === undefined) throw Error('Missing authored target line.');
    const at = text.indexOf(token); if (at < 0 || text.indexOf(token, at + token.length) >= 0) throw Error('Expected one literal token on the authored line.');
    return { file, line, column: [...text.slice(0, at)].length };
  }
  async dispose(): Promise<void> { if (this.root) await fs.rm(this.root, { recursive: true, force: true }); }
}
