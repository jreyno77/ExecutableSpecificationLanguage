import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { CleanPackageDriver } from './clean-package.js';

type Target = 'java' | 'kotlin' | 'python';
type Phase = { nodeid: string; file: string; when: string; outcome: string; xfail: boolean; detail: string };
export interface NativeWalkthroughReport {
  status: string; problems: { code: string; message: string }[];
  stages: { name: string; status: string;
    native?: { command: string; args: string[]; exitCode: number | null; signal: string | null; closed?: boolean; error?: string };
    tests?: { id: string; file: string; title: string; state: string; errors: string[]; nodeid?: string; phases?: Phase[] }[];
    collected?: { id: string; nodeid: string; file: string; title: string }[]; errors?: string[];
  }[];
}

/** Only installed README recipes and the separately staged consumer are available here. */
export class NativeWalkthroughDriver {
  readonly package = new CleanPackageDriver();
  report!: NativeWalkthroughReport;
  private readme = '';
  private readonly files = new Map<string, string[]>();
  constructor(readonly target: Target) {}
  get result() { return this.package.result; }
  get testRoot(): string { return this.target === 'python' ? 'game/test' : 'game/src/test/' + this.target; }
  get extension(): string { return this.target === 'java' ? '.java' : this.target === 'kotlin' ? '.kt' : '.py'; }
  get driverPath(): string { return this.target === 'python' ? 'game/test/driver/shopping_driver.py'
    : this.testRoot + '/generated/tests/driver/ShoppingDriver' + this.extension; }
  get basketPath(): string { return this.target === 'python' ? 'game/src/basket.py'
    : 'game/src/main/' + this.target + '/generated/Basket' + this.extension; }
  async prepare(): Promise<void> {
    await this.package.prepare();
    this.readme = await readFile(join(this.package.packageRoot, 'README.md'), 'utf8');
    for (const match of this.readme.matchAll(/<!-- expec-example: ([^\r\n]+) -->\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g)) {
      this.files.set(match[1]!, [...this.files.get(match[1]!) ?? [], match[2]! + '\n']);
    }
  }
  private snippet(marker: string): string {
    const snippets = this.files.get(marker) ?? [];
    if (snippets.length !== 1) throw Error('Expected one installed README fence: ' + marker + '; found ' + snippets.length);
    return snippets[0]!;
  }
  async installedExecutable(): Promise<string> {
    const info = JSON.parse(await readFile(join(this.package.packageRoot, 'package.json'), 'utf8'));
    return relative(await realpath(join(this.package.root, 'node_modules')), await realpath(resolve(this.package.packageRoot, info.bin.expec)));
  }
  text(path: string): Promise<string> { return readFile(join(this.package.consumerDirectory, path), 'utf8'); }
  async file(path: string, text: string): Promise<void> {
    const target = join(this.package.consumerDirectory, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text);
  }
  async copySpecification(): Promise<void> {
    await this.file('main.expec', this.snippet('shopping/main.expec'));
    await this.file('expec.json', this.snippet('native-shopping/expec.json'));
  }
  async appendAcceptanceOutput(): Promise<void> {
    const manifest = JSON.parse(await this.text('expec.json'));
    if (!Array.isArray(manifest.outputs)) throw Error('The initialized manifest has no outputs array.');
    manifest.outputs.push(JSON.parse(this.snippet('kotlin-shopping/acceptance-output.json')));
    await this.file('expec.json', JSON.stringify(manifest, null, 2) + '\n');
  }
  async command(command: 'init' | 'install' | 'check' | 'build' | 'test'): Promise<void> {
    const prefix = 'node node_modules/executable-specification-language/dist/cli-entry.js ';
    const lines = [...this.readme.matchAll(/```sh\r?\n([\s\S]*?)\r?\n```/g)].flatMap(match => match[1]!.split(/\r?\n/));
    const candidates = [...new Set(lines.filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length))
      .filter(line => command === 'init' ? line.startsWith('init ') && line.includes('--target ' + this.target + ' ') : line === command))];
    if (candidates.length !== 1) throw Error('Expected one documented ' + this.target + ' ' + command + ' command.');
    const paths: Record<string, string> = { '/absolute/path/to/jdk-21': 'EXPEC_TEST_JAVA_HOME',
      '/absolute/path/to/python3.12': 'EXPEC_TEST_PYTHON', '/absolute/path/to/uv': 'EXPEC_TEST_UV' };
    const args = [...candidates[0]!.matchAll(/"([^"]*)"|(\S+)/g)].map(match => {
      const token = match[1] ?? match[2]!, variable = paths[token];
      if (!variable) return token;
      const value = process.env[variable]; if (!value) throw Error('Native walkthrough prerequisite is absent: ' + variable); return value;
    });
    await this.package.command([...args, '--json'], command === 'build' ? 600_000 : 300_000);
    console.log(JSON.stringify({ target: this.target, command, consumer: this.package.consumerDirectory, delivery: this.package.metadata, ...this.result }));
    if (!this.result.stdout.trim()) throw Error('The installed CLI returned no JSON report.');
    this.report = JSON.parse(this.result.stdout);
  }
  async implementBasket(): Promise<void> {
    await this.restoreBasket(); await this.file(this.driverPath, this.snippet(this.target + '-shopping/' + this.driverPath));
  }
  async restoreBasket(): Promise<void> { await this.file(this.basketPath, this.snippet(this.target + '-shopping/' + this.basketPath)); }
  async removeIncrement(): Promise<{ expected: string; actual: string }> {
    const original = this.snippet(this.target + '-shopping/' + this.basketPath);
    if (await this.text(this.basketPath) !== original) throw Error('The application no longer matches the installed README before the deliberate fault.');
    const statement = this.target === 'java' ? 'contents.put(title, quantity(title) + 1.0);'
      : this.target === 'kotlin' ? 'contents[title] = quantity(title) + 1.0' : 'self.contents[title] = self.quantity(title) + 1.0';
    const lines = original.split('\n');
    if (lines.filter(line => line.trim() === statement).length !== 1) throw Error('Expected one actual documented Basket.add increment.');
    const expected = lines.filter(line => line.trim() !== statement).join('\n');
    await this.file(this.basketPath, expected); return { expected, actual: await this.text(this.basketPath) };
  }
  async generatedFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (path: string): Promise<void> => {
      for (const entry of (await readdir(join(this.package.consumerDirectory, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (['__pycache__', '.pytest_cache'].includes(entry.name)) continue;
        const child = path + '/' + entry.name;
        if (entry.isSymbolicLink()) throw Error('Unexpected linked generated source: ' + child);
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile() && child.endsWith(this.extension) && child !== this.driverPath)
          files[child] = (await readFile(join(this.package.consumerDirectory, child))).toString('base64');
      }
    };
    await walk(this.testRoot); return files;
  }
}
