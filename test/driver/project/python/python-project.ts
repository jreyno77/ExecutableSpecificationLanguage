import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PythonContext, PythonProject, type ArtifactAssociation, type ProjectContext, type ProjectRead, type ProjectSearch, type ProjectSnapshot } from '../../../../src/index.js';
import { PythonOutputDriver } from './python-output.js';

const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** Arranges an actually installed native environment; no native answer is fabricated. */
export class PythonProjectDriver extends PythonOutputDriver {
  readonly associations: ArtifactAssociation[] = [];
  snapshot!: ProjectSnapshot;
  readResult!: ProjectRead;
  searchResult!: ProjectSearch;
  private upstream!: ProjectContext;
  upstreamInput!: { uri: string; version: string };
  async installFixture(): Promise<void> {
    const python = process.env.EXPEC_TEST_PYTHON, uv = process.env.EXPEC_TEST_UV;
    if (!python || !uv) throw new Error('Provide explicitly provisioned EXPEC_TEST_PYTHON and EXPEC_TEST_UV.');
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PYTHON|UV_|PIP_|VIRTUAL_ENV)/i.test(key)));
    const native = async (args: string[]) => promisify(execFile)(uv, ['--no-config', ...args, '--project', this.root], { cwd: this.root, env: { ...environment, UV_PYTHON_DOWNLOADS: 'never' }, timeout: 90_000, windowsHide: true });
    await this.file('pyproject.toml', '[project]\nname = "expec-native-fixture"\nversion = "0.0.0"\nrequires-python = ">=3.12,<3.13"\ndependencies = ["libcst==1.9.0", "jedi==0.20.0", "mypy==2.4.0", "pytest==9.1.1"]\n');
    await native(['lock', '--python', python]);
    await native(['sync', '--locked', '--no-install-project', '--no-build', '--no-python-downloads', '--link-mode', 'copy', '--python', python]);
    const config = { format: 1, python, uv, sourceRoots: { main: ['src'], test: ['test'] }, environment: '.venv' };
    await this.file('expec.python.json', JSON.stringify(config));
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    const observed = await this.python('import sys, sysconfig, json, pathlib; sys.path.insert(0, sys.argv[1]); import importlib.metadata as m; base=pathlib.Path(sys.base_prefix); lib=pathlib.Path(sysconfig.get_path("stdlib")); print(json.dumps({"version":sys.version.split()[0],"stdlib":[str(lib)]+([str(base/"DLLs")] if (base/"DLLs").exists() else []),"binaries":[str(p) for p in base.glob("python*.dll")]+([str((pathlib.Path(sysconfig.get_config_var("LIBDIR"))/sysconfig.get_config_var("LDLIBRARY")).resolve(strict=True))] if sysconfig.get_config_var("LIBDIR") and sysconfig.get_config_var("LDLIBRARY") else []),"tools":{n:m.version(n) for n in ["libcst","jedi","mypy","pytest"]}}))', [sites]);
    if (observed.code !== 0) throw new Error(observed.text);
    const actual = JSON.parse(observed.text) as { version: string; stdlib: string[]; binaries: string[]; tools: Record<string, string> };
    const report = { format: 1, config: digest(await fs.readFile(join(this.root, 'expec.python.json'))),
      pyproject: digest(await fs.readFile(join(this.root, 'pyproject.toml'))), lock: digest(await fs.readFile(join(this.root, 'uv.lock'))),
      python: { path: python, version: actual.version, stdlib: actual.stdlib, binaries: actual.binaries },
      uv: { path: uv, version: '0.12.23' }, environment: { path: join(this.root, '.venv'), sites: [sites] }, tools: actual.tools, packages: [] };
    await this.file('.expec/python/environment.json', JSON.stringify(report));
    this.upstream = this.context; this.context = new PythonContext(this.upstream);
  }
  async upstreamFile(conflicting = false): Promise<void> {
    const path = conflicting ? join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']), 'selected_library.py') : join(this.directory, 'shared-settings.json');
    const bytes = Buffer.from(conflicting ? 'VALUE = 1\n' : '{"mode":"strict"}'); await fs.writeFile(path, bytes);
    this.upstreamInput = { uri: pathToFileURL(path).href, version: conflicting ? '0'.repeat(64) : digest(bytes) };
    this.context = new PythonContext({ root: this.upstream.root, readSnapshot: async () => ({ ...await this.upstream.readSnapshot(), nativeInputs: [this.upstreamInput] }) });
  }
  map(id: string, file: string, declaration: { kind: string; name: string }[]): void {
    this.associations.push({ specId: id, locator: { outputId: 'python', format: 'python-symbol-1', value: { file, declaration } } });
  }
  async capture(): Promise<void> { this.snapshot = await this.context.readSnapshot(); }
  query(): PythonProject { return new PythonProject({ outputId: 'python' }, this.associations); }
  async read(id: string): Promise<void> { await this.capture(); this.readResult = await this.query().read(id, this.snapshot); }
  async search(id: string): Promise<void> { await this.capture(); this.searchResult = await this.query().search(id, this.snapshot); }
}
