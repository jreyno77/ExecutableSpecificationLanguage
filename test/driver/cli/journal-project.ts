import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { onTestFinished, vi } from 'vitest';
import { checkManifest, type CheckedManifest } from '../../../src/cli/cli-check.js';
import { BuildContext } from '../../../src/cli/cli-context.js';
import { BuildJournal } from '../../../src/cli/cli-journal.js';
import { identities, identityBytes, identityPath, pendingPath } from '../../../src/cli/cli-identity.js';
import { canonical } from '../../../src/model/identity-baseline.js';
import type { IdentifiedSpecification } from '../../../src/model/specification-identity.js';
import { ProjectConnector, type ProjectContext, type ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import type { FileChange } from '../../../src/project/connection/project-writer.js';
import type { OutputPlan } from '../../../src/project/output/output.js';
import type { CommandResult } from '../../../src/cli/cli-project.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fixture = new URL('../../resources/cli/format-1-pending-prefix/', import.meta.url);

/** Real checked inputs and filesystem effects for the private journal's caller. */
export class JournalDriver {
  directory!: string;
  context!: ProjectContext;
  checked!: CheckedManifest;
  identified!: IdentifiedSpecification;
  report!: CommandResult;
  original!: ProjectSnapshot;
  remembered!: Record<string, string>;
  pendingIds!: string[];
  historical?: { raw: any; rebound: any; provenance: any };
  private release?: () => void;
  static async create(files: Record<string, string> = {}): Promise<JournalDriver> {
    const driver = new JournalDriver();
    driver.directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-journal-')));
    onTestFinished(async () => { driver.clearFailure(); await fs.rm(driver.directory, { recursive: true, force: true }); });
    await fs.mkdir(join(driver.directory, 'project'));
    await fs.mkdir(join(driver.directory, 'spec'));
    await fs.writeFile(join(driver.directory, 'spec/main.expec'), 'concept First {}\nconcept Second {}');
    await fs.writeFile(join(driver.directory, 'spec/expec.json'), JSON.stringify({ formatVersion: 1, version: '1.0.0', project: { root: '../project' },
      build: { entries: ['main.expec'] }, outputs: [{ id: 'first' }, { id: 'second' }] }));
    for (const [path, text] of Object.entries(files)) await driver.write(path, text);
    await driver.initialize();
    return driver;
  }
  private async initialize(): Promise<void> {
    this.checked = await checkManifest(join(this.directory, 'spec/expec.json'), ['first', 'second'].map(id => ({ id, validate: () => [] })));
    if (!this.checked.specification || !this.checked.configuration) throw Error(JSON.stringify(this.checked.problems));
    const connected = await new ProjectConnector(this.checked.manifest).connect(this.checked.configuration);
    if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
    this.context = connected.value.context;
    const associated = identities().associate(this.checked.specification);
    if (!associated.value) throw Error(JSON.stringify(associated.problems));
    this.identified = associated.value;
  }
  path(name: string): string {
    const target = resolve(this.directory, 'project', name), inside = relative(join(this.directory, 'project'), target);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw Error('Fixture path escaped its owned root.');
    return target;
  }
  async write(path: string, bytes: string | Uint8Array): Promise<void> { await fs.mkdir(dirname(this.path(path)), { recursive: true }); await fs.writeFile(this.path(path), bytes); }
  read(path: string): Promise<Buffer> { return fs.readFile(this.path(path)); }
  async pending(): Promise<any> { return JSON.parse((await this.read(pendingPath)).toString()); }
  async rewritePending(change: (record: any) => void): Promise<void> { const record = await this.pending(); change(record); await this.write(pendingPath, JSON.stringify(record)); }
  plan(changes: FileChange[], outputId = 'first'): OutputPlan {
    const subject = this.identified.baseline.elements.find(element => element.address.name === (outputId === 'first' ? 'First' : 'Second'))!;
    return { outputId, changes, basedOn: this.original, artifacts: [{ specId: subject.id, locator: { outputId, format: 'fixture-file-1', value: { file: 'fixture.txt', subject: subject.id } } }] };
  }
  private buildContext(): BuildContext { return new BuildContext(this.context, this.checked, this.checked.configuration!.outputs); }
  async apply(plans: OutputPlan[], completion?: FileChange): Promise<void> {
    const context = this.buildContext(), snapshot = await context.readSnapshot();
    this.original ??= await this.context.readSnapshot();
    this.report = await new BuildJournal(this.checked, context, new AbortController().signal).apply('contracts', snapshot,
      plans.map(plan => ({ ...plan, basedOn: snapshot })), this.identified.baseline, completion);
  }
  async recover(): Promise<void> {
    const result = await new BuildJournal(this.checked, this.buildContext(), new AbortController().signal).recover(await this.context.readSnapshot());
    this.report = result.value ?? { status: 'invalid', exitCode: 1, problems: [...result.problems], stages: [] };
  }
  stopAtWrite(path: string): void {
    this.clearFailure(); const original = fs.open.bind(fs);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === this.path(path) && args[1] !== 'r') throw Object.assign(Error('Deliberate owned write refusal'), { code: 'EACCES' });
      return original(...args);
    }); this.release = () => spy.mockRestore();
  }
  stopAtRemove(path: string): void {
    this.clearFailure(); const original = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target) === this.path(path)) throw Object.assign(Error('Deliberate owned removal refusal'), { code: 'EACCES' });
      return original(target);
    }); this.release = () => spy.mockRestore();
  }
  clearFailure(): void { this.release?.(); delete this.release; }
  async rememberOriginal(): Promise<void> { this.original = await this.context.readSnapshot(); }
  async confirmOriginalIdentity(): Promise<void> { const first = this.identified.baseline.elements[0]!;
    const before = identities().withArtifacts(this.identified, [{ specId: first.id, locator: { outputId: 'first', format: 'fixture-file-1', value: { file: 'original.txt' } } }]).value!;
    await this.write(identityPath, identityBytes(this.checked, this.context.root, before.baseline)); }
  async files(): Promise<Record<string, string>> { const snapshot = await this.context.readSnapshot(); if (!snapshot.complete) throw Error(JSON.stringify(snapshot.problems));
    return Object.fromEntries(snapshot.files.map(file => [file.path, Buffer.from(file.bytes).toString('base64')])); }
  async rememberFiles(): Promise<void> { this.remembered = await this.files(); }

  // One-time capture executes the pre-change journal; future replay reads these genuine emitted bytes.
  async saveHistoricalFixture(): Promise<void> {
    const bytes = await this.read(pendingPath), record = JSON.parse(bytes.toString());
    if (record.format !== 1 || record.graph.files.some((file: any) => typeof file.bytes !== 'string')) throw Error('Capture must use the unchanged full-byte journal.');
    const original = Object.fromEntries(this.original.files.map(file => [file.path, Buffer.from(file.bytes).toString('base64')]));
    const prefix = await this.files(); delete prefix[pendingPath];
    await fs.mkdir(fixture, { recursive: true });
    await fs.writeFile(new URL('pending.json', fixture), bytes);
    await fs.writeFile(new URL('capture.json', fixture), JSON.stringify({ provenance: {
      commit: '07681c68b614578cca79ad7d3689c7bf3125f037', pendingSHA256: digest(bytes), root: this.context.root,
      manifest: this.checked.manifest, sourceUri: pathToFileURL(join(this.directory, 'spec/main.expec')).href,
      recipe: 'Real checked two-concept source; notes.txt retained; first fixed-file write applied; actual second write refused.' },
      manifest: await fs.readFile(this.checked.manifest, 'utf8'), source: await fs.readFile(join(this.directory, 'spec/main.expec'), 'utf8'), original, prefix }, null, 2) + '\n');
  }
  static async fromLegacy(): Promise<JournalDriver> {
    const capture = JSON.parse(await fs.readFile(new URL('capture.json', fixture), 'utf8'));
    const bytes = await fs.readFile(new URL('pending.json', fixture));
    if (digest(bytes) !== capture.provenance.pendingSHA256) throw Error('Historical fixture hash differs.');
    const driver = await JournalDriver.create();
    await fs.writeFile(join(driver.directory, 'spec/main.expec'), capture.source);
    await fs.writeFile(join(driver.directory, 'spec/expec.json'), capture.manifest);
    for (const [path, body] of Object.entries(capture.prefix)) await driver.write(path, Buffer.from(body as string, 'base64'));
    await driver.initialize();
    const raw = JSON.parse(bytes.toString()), rebound = structuredClone(raw);
    const old = capture.provenance, sourceUri = pathToFileURL(join(driver.directory, 'spec/main.expec')).href;
    if (raw.format !== 1 || raw.graph.files.some((file: any) => typeof file.bytes !== 'string') || raw.candidate.elements.length !== 2
      || raw.candidate.modules.length !== 1 || raw.candidate.entry !== old.sourceUri || raw.candidate.artifacts.length || raw.candidate.retired.length) throw Error('Legacy fixture is outside its bounded flat-source shape.');
    const baseline = (value: any) => {
      if (value.entry !== old.sourceUri || value.modules.length !== 1 || value.modules[0] !== old.sourceUri) throw Error('Unexpected historical module.');
      value.entry = sourceUri; value.modules[0] = sourceUri;
      value.context = 'sha256:' + digest(Buffer.from(JSON.stringify({ entry: sourceUri, roots: [] })));
      for (const element of value.elements) {
        if (element.address.module !== old.sourceUri || element.address.owner !== null || element.origin.kind !== 'source' || element.origin.module !== old.sourceUri
          || element.origin.node.sourceId !== old.sourceUri || element.origin.range.sourceId !== old.sourceUri) throw Error('Unexpected historical source origin.');
        element.address.module = sourceUri; element.origin.module = sourceUri; element.origin.node.sourceId = sourceUri; element.origin.range.sourceId = sourceUri;
      }
    };
    const input = (value: any) => { if (value.uri === pathToFileURL(old.manifest).href) value.uri = pathToFileURL(driver.checked.manifest).href;
      else if (value.uri === old.sourceUri) value.uri = sourceUri; else throw Error('Unexpected historical native URI.'); };
    rebound.graph.root = driver.context.root; rebound.manifest = driver.checked.manifest;
    rebound.graph.nativeInputs.forEach(input);
    const facts = JSON.parse(rebound.facts); facts.root = driver.context.root; facts.native.forEach(input); rebound.facts = canonical(facts);
    baseline(rebound.candidate);
    const ledger = JSON.parse(Buffer.from(rebound.ledger, 'base64').toString());
    ledger.manifest = driver.checked.manifest; ledger.project = driver.context.root; baseline(ledger.baseline);
    rebound.ledger = Buffer.from(canonical(ledger, 2) + '\n').toString('base64');
    driver.historical = { raw, rebound, provenance: capture.provenance };
    driver.pendingIds = raw.candidate.elements.map((element: any) => element.id);
    await driver.write(pendingPath, canonical(rebound) + '\n');
    return driver;
  }
}
