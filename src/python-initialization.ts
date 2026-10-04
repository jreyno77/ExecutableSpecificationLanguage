import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Configuration } from './configuration.js';
import type { Check } from './checking.js';
import type { FileChange } from './project-writer.js';
import { outputProblem } from './output-documents.js';
import { runPython } from './python-process.js';
import { samePythonRelease } from './python-profile.js';

/** Validates explicitly selected tools and proposes files; acquisition remains a separate action. */
export async function pythonStarter(configuration: Configuration, root: string, python: string, uv: string): Promise<Check<{
  configuration: Configuration; changes: readonly FileChange[];
}>> {
  const problems = [], packages = configuration.packages.map(item => structuredClone(item)), outputs = configuration.outputs.map(item => structuredClone(item));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(configuration.version))
    problems.push(outputProblem('unsupported-native-version', root, 'The Python starter requires a three-part release version; other Expec versions need an explicit native version mapping.'));
  for (const [alias, version, phase] of [['libcst', '1.9.0', 'build'], ['jedi', '0.20.0', 'build'], ['mypy', '2.4.0', 'build'], ['pytest', '9.1.1', 'test']] as const) {
    const name = 'pypi:' + alias, existing = packages.filter(item => item.name.toLowerCase().replace(/[-_.]+/g, '-') === name);
    if (existing.length ? existing.some(item => !samePythonRelease(item.version, version)) || !existing.some(item => item.phases.includes(phase)) : packages.some(item => item.alias === alias))
      problems.push(outputProblem('unsupported-initialization-toolchain', root, 'The Python starter requires ' + name + ' ' + version + ' in phase ' + phase + '.'));
    else if (!existing.length) packages.push({ alias, name, version, phases: [phase] });
  }
  for (const [id, options] of [['python', { module: 'store.contracts' }], ['python-acceptance', { domain: 'shopping' }]] as const) {
    const existing = outputs.find(output => output.id === id);
    if (existing && (existing.options.configFile !== undefined && existing.options.configFile !== 'expec.python.json'
      || id === 'python' && existing.options.directory !== undefined && existing.options.directory !== 'src'
      || id === 'python-acceptance' && existing.options.testRoot !== undefined && existing.options.testRoot !== 'test'))
      problems.push(outputProblem('unsupported-initialization-options', root, 'Use the starter src/test roots and expec.python.json.'));
    else if (!existing) outputs.push({ id, options });
  }
  if (problems.length) return { problems, deferred: [] };
  try { await pythonToolchain(python, uv); }
  catch (error) { return { problems: [outputProblem('native-toolchain-unavailable', root, String(error))], deferred: [] }; }
  const files = {
    'pyproject.toml': '[project]\nname = "expec-python-project"\nversion = "' + configuration.version + '"\nrequires-python = ">=3.12,<3.13"\ndependencies = []\n\n[dependency-groups]\nexpec-build = ["libcst==1.9.0", "jedi==0.20.0", "mypy==2.4.0"]\nexpec-test = ["pytest==9.1.1"]\n\n[tool.uv]\npackage = false\n',
    'expec.python.json': JSON.stringify({ format: 1, python, uv, sourceRoots: { main: ['src'], test: ['test'] }, environment: '.venv' }, null, 2) + '\n',
    'src/__init__.py': '', 'test/__init__.py': '', '.gitignore': '.venv/\n__pycache__/\n.pytest_cache/\n.mypy_cache/\n.uv-cache/\n',
  };
  return { value: { configuration: { ...structuredClone(configuration), project: { root }, packages, outputs },
    changes: Object.entries(files).map(([path, text]) => ({ kind: 'write', path, bytes: new TextEncoder().encode(text) })) }, problems: [], deferred: [] };
}

async function pythonToolchain(python: string, uv: string): Promise<void> {
  for (const path of [python, uv]) {
    if (!isAbsolute(path) || path.includes('\0')) throw Error('Provide absolute ordinary Python3.12 and uv0.12.23 executable paths.');
    const info = await fs.lstat(path), canonical = await fs.realpath(path), key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!info.isFile() || info.isSymbolicLink() || key(canonical) !== key(resolve(path))) throw Error('The selected executable is redirected or not an ordinary file: ' + path);
  }
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-toolchain-'));
  try {
    const result = await runPython(python, ['-c', 'import sys; print(sys.implementation.name); print(".".join(map(str, sys.version_info[:3])))'], directory);
    if (result.code !== 0 || result.error || !/^cpython\r?\n3\.12\.\d+\s*$/.test(result.text)) throw Error('The selected interpreter must be CPython3.12.');
    const version = await promisify(execFile)(uv, ['--version'], { cwd: directory, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
    if (!/^uv 0\.12\.23(?:\s|$)/.test(version.stdout) || version.stderr) throw Error('The selected uv must be version0.12.23.');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
