import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Compiler, ConfigurationReader, FileProjectWriter, LangiumModel, LangiumReader, Outputs, ProjectConnector,
  SourceComposer, SpecificationIdentity, pythonOutput, type IdentifiedSpecification, type OutputWrite, type ProjectContext, type Specification } from '../../src/index.js';

/** Real compiler/output calls, files, native mypy and intentional Python execution. */
export class PythonOutputDriver {
  directory = '';
  root = '';
  context!: ProjectContext;
  current!: IdentifiedSpecification;
  written!: OutputWrite;
  readonly outputs = new Outputs();
  private next = 0;
  readonly identity = new SpecificationIdentity(() => 'python-example-' + ++this.next);
  native = { code: -1, text: '' };
  runtime = { code: -1, text: '' };
  async initialize(): Promise<void> {
    this.directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-output-'));
    this.root = join(this.directory, 'project'); await fs.mkdir(this.root); this.outputs.register(pythonOutput);
    const configuration = new ConfigurationReader(this.outputs.profiles).read({ sourceId: 'expec.json', text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['main.expec'] },
    }) });
    if (!configuration.value) throw new Error(JSON.stringify(configuration));
    const connected = await new ProjectConnector(join(this.directory, 'expec.json'), {
      excludeNames: ['.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.uv-cache'],
    }).connect(configuration.value);
    if (connected.value?.status !== 'connected') throw new Error(JSON.stringify(connected)); this.context = connected.value.context;
  }
  protected compile(text: string): Specification {
    const read = new LangiumReader().read({ sourceId: 'main.expec', text });
    if (read.status !== 'accepted') throw new Error('Invalid acceptance source: ' + JSON.stringify(read));
    const checked = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('main', read.document), { modules: [], packages: [] }) });
    if (!checked.value) throw new Error('Invalid acceptance source: ' + JSON.stringify(checked));
    return checked.value;
  }
  source(text: string): void {
    const identified = this.identity.associate(this.compile(text)); if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
  }
  async build(options: Record<string, unknown> = {}): Promise<void> {
    const opened = this.outputs.open('python', { module: 'store.contracts', ...options }, this.context, new FileProjectWriter(this.context));
    this.written = opened.value ? await opened.value.create(this.current) : { problems: opened.problems };
  }
  async file(path: string, text: string): Promise<void> { const target = join(this.root, path); await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, text); }
  async python(code: string, args: string[] = []): Promise<{ code: number; text: string }> {
    const python = process.env.EXPEC_TEST_PYTHON;
    if (!python) throw new Error('Set EXPEC_TEST_PYTHON to the explicitly provisioned Python3.12 test interpreter.');
    try { const run = await promisify(execFile)(python, ['-I', '-S', '-B', '-c', code, ...args], { cwd: this.root, timeout: 30_000, windowsHide: true }); return { code: 0, text: run.stdout + run.stderr }; }
    catch (error) { const run = error as { code?: number; stdout?: string; stderr?: string }; return { code: run.code ?? -1, text: (run.stdout ?? '') + (run.stderr ?? '') }; }
  }
  async checkConsumer(text: string): Promise<void> {
    await this.file('consumer.py', text);
    const tools = process.env.EXPEC_TEST_PYTHON_SITE;
    if (!tools) throw new Error('Set EXPEC_TEST_PYTHON_SITE to the explicitly provisioned pinned tooling directory.');
    this.native = await this.python('import sys, os; sys.path.insert(0, sys.argv[1]); os.environ["MYPYPATH"] = sys.argv[2]; from mypy import api; out, err, status = api.run(["--strict", "--no-incremental", "--follow-imports=normal", "--show-error-codes", sys.argv[3]]); print(out + err); sys.exit(status)', [tools, join(this.root, 'src'), join(this.root, 'consumer.py')]);
  }
  async runConsumer(): Promise<void> { this.runtime = await this.python('import sys, runpy; sys.path.insert(0, sys.argv[1]); runpy.run_path(sys.argv[2], run_name="__main__")', [join(this.root, 'src'), join(this.root, 'consumer.py')]); }
  async dispose(): Promise<void> {
    if (!this.directory) return;
    const directory = await fs.realpath(this.directory), within = relative(await fs.realpath(tmpdir()), directory);
    if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) throw new Error('Unexpected temporary project root.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
