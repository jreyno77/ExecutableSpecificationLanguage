import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { onTestFinished } from 'vitest';
import {
  acceptanceOutput, Compiler, ConfigurationReader, FileProjectWriter, SourceComposer, SourceLoader, TypeScriptContext,
  type Check, type OutputWrite,
} from '../../../../src/index.js';
import { PreservationDriver } from '../typescript/typescript-preservation.js';
import { copyInstalledPackages } from '../typescript/typescript-context.js';

export interface PreservedTypeScriptProjectSettings {
  readonly packages: readonly unknown[];
  readonly source: string;
}
export interface SharedToolingRequirements {
  readonly project: { readonly build?: readonly string[]; readonly test?: readonly string[] };
}

/** A tiny saved source and target exercise actual loading and both preserving outputs. */
export class PreservedTypeScriptProjectDriver {
  private readonly driver = new PreservationDriver();
  private readonly manifestLocation = join(this.driver.directory, 'expec.json');
  private readonly sourceLocation = join(this.driver.directory, 'src/core/store.expec');
  private readonly handwritten = new Map<string, Uint8Array>();
  private readonly manifest: Record<string, unknown>;
  private generated = false;
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  private disposal: Promise<void> | undefined;

  constructor(private readonly settings: PreservedTypeScriptProjectSettings) {
    this.manifest = { formatVersion: 1, version: '0.1.0', project: { root: 'project' },
      build: { entries: ['src/core/store.expec'] }, packages: structuredClone(settings.packages) };
    this.driver.outputs.register(acceptanceOutput);
  }

  initialize(): Promise<void> { return this.owned(() => this.initializeProject()); }
  generate(): Promise<void> { return this.owned(() => this.generateProject()); }
  implement(owner: string, name: string, body: string): Promise<void> {
    return this.owned(() => this.implementMethod(owner, name, body));
  }
  actualSignature(owner: string, name: string): Promise<string> {
    return this.owned(() => this.readSignature(owner, name));
  }
  actualBody(owner: string, name: string): Promise<string> {
    return this.owned(() => this.readBody(owner, name));
  }
  actualAcceptanceBytes(owner: string): Promise<Readonly<Record<string, Uint8Array>>> {
    return this.owned(() => this.readAcceptanceBytes(owner));
  }
  moveSharedTooling(requirements: SharedToolingRequirements): Promise<void> {
    return this.owned(() => this.migrateSharedTooling(requirements));
  }
  handwrittenFilesUnchanged(): Promise<boolean> {
    return this.owned(() => this.compareHandwrittenFiles());
  }

  private async initializeProject(): Promise<void> {
    await fs.mkdir(dirname(this.sourceLocation), { recursive: true });
    await fs.writeFile(this.sourceLocation, this.settings.source);
    await this.saveManifest();
    await this.driver.initialize();
    await copyInstalledPackages(this.driver.root, { vitest: '5.0.2', '@types/node': '24.13.6' });
    for (const [path, text] of Object.entries({
      'package.json': JSON.stringify({ name: 'scoped-preservation-consumer', private: true, type: 'module' }) + '\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }) + '\n',
      'src/handwritten.ts': 'export const ownerLabel = "keep handwritten";\n',
      'notes.txt': 'Keep these authored notes beside the generated project.\n',
    })) {
      await this.driver.file(path, text);
      this.handwritten.set(path, Uint8Array.from(await fs.readFile(this.targetPath(path))));
    }
    this.driver.context = new TypeScriptContext(this.driver.context, { configFile: 'tsconfig.json', imports: ['vitest'] });
  }
  private async generateProject(): Promise<void> {
    const configuration = accepted(new ConfigurationReader(this.driver.outputs.profiles).read({
      sourceId: this.manifestLocation, text: await fs.readFile(this.manifestLocation, 'utf8'),
    }), 'saved project configuration');
    // This is the one reader-captured availability catalog for the entire source closure.
    const loaded = await new SourceLoader(this.manifestLocation).load(configuration, { modules: [],
      packages: configuration.packages.map(({ alias, phases }) => ({ alias, phases: [...phases] })) });
    const sources = accepted(loaded, 'actual saved source loading');
    if (loaded.syntax.length || sources.entries.length !== 1) throw Error('Arrange one grammatical saved source entry: ' + JSON.stringify(loaded));
    const entry = sources.entries[0]!;
    const specification = accepted(new Compiler().compile({
      resolution: new SourceComposer(sources.locate).compose(entry.entry, entry.dependencies),
    }), 'loaded specification');
    this.driver.membership = { workspaceModules: loaded.captures.flatMap(capture => capture.model ? [capture.model.locator] : []),
      manifestLocation: this.manifestLocation };
    this.driver.identify(specification, [], this.generated);
    if (this.generated) { this.driver.open({ directory: 'src', configFile: 'tsconfig.json' }); await this.driver.update(); }
    else await this.driver.create({ directory: 'src', configFile: 'tsconfig.json' });
    this.confirm('typescript', this.driver.written);

    // Recompute the genuine transition after retaining the actual TypeScript associations.
    if (this.generated) this.driver.diff = accepted(this.driver.identity.compare(this.driver.previous.baseline, this.driver.current), 'acceptance transition');
    const output = accepted(this.driver.outputs.open('acceptance', { domain: 'store', configFile: 'tsconfig.json' }, this.driver.context,
      new FileProjectWriter(this.driver.context), this.driver.membership), 'acceptance output');
    this.confirm('acceptance', this.generated ? await output.update(this.driver.diff, this.driver.current) : await output.create(this.driver.current));
    this.generated = true;
  }

  private async implementMethod(owner: string, name: string, body: string): Promise<void> {
    const node = await this.nativeMethod(owner, name), file = node.getSourceFile();
    if (!node.body) throw Error('The generated method has no implementation body.');
    await this.driver.file(file.fileName, file.text.slice(0, node.body.getStart()) + '{\n    ' + body + '\n  }' + file.text.slice(node.body.end));
  }

  private async readSignature(owner: string, name: string): Promise<string> {
    const node = await this.nativeMethod(owner, name);
    return node.getSourceFile().text.slice(node.getStart(), node.body?.getStart() ?? node.end).trim();
  }

  private async readBody(owner: string, name: string): Promise<string> {
    const node = await this.nativeMethod(owner, name);
    if (!node.body) throw Error('The actual method has no implementation body.');
    return node.getSourceFile().text.slice(node.body.getStart() + 1, node.body.end - 1).trim();
  }

  private async readAcceptanceBytes(owner: string): Promise<Readonly<Record<string, Uint8Array>>> {
    const current = this.driver.current, subject = current.node(this.driver.subject(owner));
    const groups = [...current.specification.inspection.query('examples')].filter(group =>
      group.subject?.resolution.status === 'bound' && group.subject.resolution.target === subject);
    if (groups.length !== 1) throw Error('Arrange one actual examples group for ' + owner + '.');
    const association = current.baseline.artifacts.find(item => item.specId === current.id(groups[0]!.id)
      && item.locator.outputId === 'acceptance' && item.locator.format === 'typescript-file-1');
    const path = association && artifactFile(association.locator.value);
    const snapshot = await this.driver.context.readSnapshot();
    if (!snapshot.complete || snapshot.problems.length || !path || !snapshot.files.some(file => file.path === path)) {
      throw Error('Actual generated acceptance files are unavailable: ' + JSON.stringify(snapshot.problems));
    }
    // This target starts with no handwritten test files. Include the generated DSL assertion
    // bodies, scenarios, driver contracts, fixture and comparison runtime as actual bytes.
    const files = snapshot.files.filter(file => file.path.startsWith('test/') && file.path.endsWith('.ts'));
    if (!files.length) throw Error('The acceptance output produced no actual TypeScript files.');
    return Object.fromEntries(files.sort((left, right) => left.path.localeCompare(right.path))
      .map(file => [file.path, Uint8Array.from(file.bytes)]));
  }

  private async migrateSharedTooling(requirements: SharedToolingRequirements): Promise<void> {
    const lines = (await fs.readFile(this.sourceLocation, 'utf8')).split('\n'), removed = new Set<number>();
    for (const phase of ['build', 'test'] as const) for (const alias of requirements.project[phase] ?? []) {
      const literal = 'requires package ' + JSON.stringify(alias) + ' for ' + phase;
      const matches = lines.flatMap((line, index) => line.trim() === literal ? [index] : []);
      if (matches.length !== 1 || removed.has(matches[0]!)) throw Error('Move exactly one explicit fixture tooling requirement: ' + literal);
      removed.add(matches[0]!);
    }
    if (!removed.size) throw Error('Arrange explicit shared tooling to move.');
    this.manifest.requirements = structuredClone(requirements);
    await this.saveManifest();
    await fs.writeFile(this.sourceLocation, lines.filter((_line, index) => !removed.has(index)).join('\n'));
  }

  private async compareHandwrittenFiles(): Promise<boolean> {
    if (!this.handwritten.size) throw Error('Capture actual handwritten files before generation.');
    for (const [path, before] of this.handwritten) {
      let actual: Buffer;
      try { actual = await fs.readFile(this.targetPath(path)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      if (!actual.equals(Buffer.from(before))) return false;
    }
    return true;
  }

  dispose(): Promise<void> {
    if (!this.disposal) {
      this.closing = true;
      this.disposal = (async () => {
        await Promise.allSettled([...this.pending]);
        await this.driver.dispose();
      })();
    }
    return this.disposal;
  }

  private owned<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(Error('The preservation fixture is disposing.'));
    const operation = action().then(value => {
      if (this.closing) throw Error('The preservation operation completed after disposal began.');
      return value;
    });
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }


  private async saveManifest(): Promise<void> { await fs.writeFile(this.manifestLocation, JSON.stringify(this.manifest, null, 2) + '\n'); }

  private confirm(outputId: string, written: OutputWrite | undefined): void {
    if (!written?.receipt || written.problems.length || written.receipt.problems.length
      || written.receipt.status === 'stopped' || !written.artifacts?.length) {
      throw Error('Actual ' + outputId + ' generation was refused: ' + JSON.stringify(written));
    }
    this.driver.current = accepted(this.driver.identity.withArtifacts(this.driver.current,
      [...this.driver.current.baseline.artifacts.filter(item => item.locator.outputId !== outputId), ...written.artifacts]), outputId + ' associations');
  }

  private async nativeMethod(owner: string, name: string): Promise<ts.MethodDeclaration> {
    if (!this.generated) throw Error('Generate the actual project before observing its native methods.');
    const id = this.driver.subject(owner + '.' + name);
    const associations = this.driver.current.baseline.artifacts.filter(item => item.specId === id
      && item.locator.outputId === 'typescript' && item.locator.format === 'typescript-symbol-1');
    if (associations.length !== 1) throw Error('Expected one actual TypeScript association for ' + owner + '.' + name + '.');
    const path = artifactFile(associations[0]!.locator.value);
    const source = ts.createSourceFile(path, await fs.readFile(this.targetPath(path), 'utf8'), ts.ScriptTarget.Latest, true);
    const owners = source.statements.filter(ts.isClassDeclaration).filter(node => node.name?.text === owner);
    const methods = owners.flatMap(node => node.members.filter(ts.isMethodDeclaration))
      .filter(node => (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && node.name.text === name);
    if (methods.length !== 1) throw Error('Expected one actual generated method ' + owner + '.' + name + '.');
    return methods[0]!;
  }

  private targetPath(path: string): string {
    const target = resolve(this.driver.root, path), inside = relative(this.driver.root, target);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw Error('The actual artifact escaped its fixture target.');
    return target;
  }
}

export async function preservedTypeScriptProject(settings: PreservedTypeScriptProjectSettings): Promise<PreservedTypeScriptProjectDriver> {
  const driver = new PreservedTypeScriptProjectDriver(settings);
  onTestFinished(() => driver.dispose());
  try { await driver.initialize(); return driver; }
  catch (error) { await driver.dispose(); throw error; }
}

function accepted<T>(result: Check<T>, subject: string): T {
  if (result.value === undefined || result.problems.length || result.deferred.length) throw Error('Invalid ' + subject + ': ' + JSON.stringify(result));
  return result.value;
}
function artifactFile(value: unknown): string {
  if (!value || typeof value !== 'object' || !('file' in value) || typeof value.file !== 'string' || !value.file) throw Error('The actual artifact has no file.');
  return value.file;
}
