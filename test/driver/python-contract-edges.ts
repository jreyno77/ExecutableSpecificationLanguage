import { join } from 'node:path';
import { PythonProject, type ProjectSnapshot } from '../../src/index.js';
import { PythonPreservationDriver } from './python-preservation.js';

/** Real contracts, captured bytes and native consumers at the Python output boundary. */
export class PythonContractEdgesDriver extends PythonPreservationDriver {
  options: Record<string, unknown> = {};
  before!: ProjectSnapshot;
  beforeIdentity!: string;
  beforeAssociations!: string;
  syntax = { code: -1, text: '' };
  id(name: string): string {
    const records = this.current.baseline.elements.filter(item => item.address.name === name);
    if (records.length !== 1) throw new Error('The example requires one authored declaration named ' + name + '.');
    return records[0]!.id;
  }
  name(authored: string, native: string): void { this.options.names = [{ id: this.id(authored), name: native }]; }
  importURL(): void { this.options.imports = [{ module: 'main', declaration: ['URL'], moduleName: 'urllib.parse', name: 'ParseResult' }]; }
  async buildContracts(): Promise<void> { await this.generate(this.options); }
  async rememberProject(): Promise<void> {
    this.before = await this.context.readSnapshot();
    if (!this.before.complete) throw new Error(JSON.stringify(this.before.problems));
    this.beforeIdentity = JSON.stringify(this.current.baseline.elements);
    this.beforeAssociations = JSON.stringify(this.current.baseline.artifacts);
  }
  async replaceNativeText(path: string, before: string, after: string): Promise<void> {
    const text = await this.text(path);
    if (text.split(before).length !== 2) throw new Error('The native fixture must contain exactly one ' + before + '.');
    await this.file(path, text.replace(before, after));
  }
  async checkCapturedConsumer(text: string): Promise<void> {
    await this.file('src/consumer.py', text);
    const site = process.env.EXPEC_TEST_PYTHON_SITE;
    if (!site) throw new Error('Provide the pinned native Python tooling directory.');
    this.native = await this.python('import sys, os; sys.path.insert(0, sys.argv[1]); os.environ["MYPYPATH"] = sys.argv[2]; from mypy import api; out, err, status = api.run(["--strict", "--no-incremental", "--follow-imports=normal", "--show-error-codes", sys.argv[3]]); print(out + err); sys.exit(status)',
      [site, join(this.root, 'src'), join(this.root, 'src/consumer.py')]);
  }
  async searchDeclaration(name: string): Promise<void> {
    await this.capture();
    this.searchResult = await new PythonProject({ outputId: 'python' }, this.current.baseline.artifacts).search(this.id(name), this.snapshot);
  }
  async compileNativeFile(path: string): Promise<void> {
    this.syntax = await this.python('import pathlib, sys; compile(pathlib.Path(sys.argv[1]).read_bytes(), sys.argv[1], "exec", dont_inherit=True); print("valid Python")', [join(this.root, path)]);
  }
}
