import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess, { type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { vi } from 'vitest';
import { FileProjectWriter, JavaProject, Outputs, javaOutput, type Output, type ProjectRead, type ProjectSearch, type ProjectSnapshot } from '../../../../src/index.js';
import * as inputs from '../../../../src/project/java/java-inputs.js';
import { JavaAnalysisDriver } from './java-analysis.js';

const sourcePath = 'src/main/java/store/Book.java';
interface NativeGate { phase: 1 | 2; held: Promise<void>; reached(): void; released: Promise<void>; release(): void }
interface Question { checks: number; gate?: NativeGate; externalChange?: string }

/** Real Java questions over one retained reader or opened output; observers own only this fixture's questions. */
export class JavaReaderDriver extends JavaAnalysisDriver {
  preparations = 0;
  validations = 0;
  readonly processes: { child: ChildProcess; scratch: string; closed: boolean }[] = [];
  last: ProjectRead | ProjectSearch | undefined;
  earlierRead: ProjectRead | undefined;
  earlierSearch: ProjectSearch | undefined;
  private reader: JavaProject | Output | undefined;
  private readonly owned = new AsyncLocalStorage<Question>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly gates: NativeGate[] = [];
  private nextGate: NativeGate | undefined;
  private nextExternalChange: string | undefined;
  private restoreInputs: (() => void) | undefined;
  private originalConfiguration!: Uint8Array;
  private originalReadOnly!: { present: boolean; value: ProjectSnapshot['readOnlyFiles'] };
  private interruptNext = false;
  private disposing = false;

  override async prepare(source: string, dependency?: { catalogJar?: string; catalogSource?: string }): Promise<void> {
    await super.prepare(source, dependency);
    this.sourceText = source;
    this.originalConfiguration = structuredClone(this.snapshot.files.find(file => file.path === 'expec.java.json')!.bytes);
    this.originalReadOnly = { present: Object.hasOwn(this.snapshot, 'readOnlyFiles'), value: structuredClone(this.snapshot.readOnlyFiles) };

    // The acquired fixture installed its forwarding observer. Capture that implementation rather than recursively calling its spy.
    const observation = vi.spyOn(childProcess, 'spawn'), spawn = observation.getMockImplementation();
    if (!spawn) throw new Error('The acquired Java fixture must retain its real spawn forwarding implementation.');
    observation.mockImplementation(((...args: Parameters<typeof childProcess.spawn>) => {
      const child = Reflect.apply(spawn, childProcess, args);
      if (this.owned.getStore() && Array.isArray(args[1]) && args[1].includes('ExpecJava')) {
        this.preparations++;
        const process = { child, scratch: String(args[1].at(-1)), closed: false };
        this.processes.push(process); child.once('close', () => { process.closed = true; });
        if (this.interruptNext || this.disposing) {
          this.interruptNext = false; child.once('spawn', () => child.kill());
        }
      }
      return child;
    }) as typeof childProcess.spawn);
    syncBuiltinESMExports();

    const read = inputs.javaInputs;
    const native = vi.spyOn(inputs, 'javaInputs').mockImplementation(async (...args) => {
      const question = this.owned.getStore(), owned = question && args[0].root.path === this.root && !args[2];
      if (owned) { question.checks++; this.validations++; }
      const result = await read(...args);
      if (owned && question.externalChange && question.checks === 1) await fs.writeFile(this.externalSource, question.externalChange);
      if (owned && question.gate?.phase === question.checks) {
        question.gate.reached(); await question.gate.released;
      }
      return result;
    });
    this.restoreInputs = () => native.mockRestore();
  }

  openReader(): void { this.reader = new JavaProject({ outputId: 'java' }, this.associations); }
  openOutput(): void {
    const outputs = new Outputs(); outputs.register(javaOutput);
    const opened = outputs.open('java', { package: 'store' }, this.context, new FileProjectWriter(this.context));
    if (!opened.value) throw new Error(JSON.stringify(opened));
    this.reader = opened.value;
  }
  async recordOwnedType(id: string, file: string, type: string): Promise<void> {
    if (file !== sourcePath) throw new Error('The owned Java fixture has one explicitly authored source file.');
    const generated = this.sourceText, artifacts = [{ specId: id, locator: { outputId: 'java', format: 'java-symbol-1', value: { file, type } } }];
    await this.file('.expec/outputs/java.json', JSON.stringify({ format: 1, options: { package: 'store' },
      files: [{ path: file, generated, hash: createHash('sha256').update(generated).digest('hex'), artifacts }] }));
  }
  replaceOwnershipText(text: string): Promise<void> { return this.file('.expec/outputs/java.json', text); }

  private ask<T>(action: (reader: JavaProject | Output) => Promise<T>): Promise<T> {
    if (!this.reader) throw new Error('Open the explicitly configured reader or output first.');
    const question: Question = { checks: 0, ...this.nextGate ? { gate: this.nextGate } : {},
      ...this.nextExternalChange === undefined ? {} : { externalChange: this.nextExternalChange } };
    this.nextGate = undefined; this.nextExternalChange = undefined;
    const result = this.owned.run(question, () => action(this.reader!));
    this.pending.add(result);
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result));
    return result;
  }
  override async read(id: string): Promise<void> {
    this.readResult = await this.ask(reader => reader instanceof JavaProject ? reader.read(id, this.snapshot) : reader.read(id));
    this.last = this.readResult;
  }
  override async search(id: string): Promise<void> {
    this.searchResult = await this.ask(reader => reader instanceof JavaProject ? reader.search(id, this.snapshot) : reader.search(id));
    this.last = this.searchResult;
  }
  async beginRead(id: string): Promise<void> {
    this.earlierRead = await this.ask(reader => reader instanceof JavaProject ? reader.read(id, this.snapshot) : reader.read(id));
  }
  async beginSearch(id: string): Promise<void> {
    this.earlierSearch = await this.ask(reader => reader instanceof JavaProject ? reader.search(id, this.snapshot) : reader.search(id));
  }
  holdNextAnswer(phase: 1 | 2): void {
    let reached!: () => void, release!: () => void;
    const gate: NativeGate = { phase, held: new Promise<void>(resolve => { reached = resolve; }), reached: () => reached(),
      released: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
    this.gates.push(gate); this.nextGate = gate;
  }
  earlierAnswerHeld(): Promise<void> {
    const gate = this.gates.at(-1); if (!gate) throw new Error('No earlier Java question is gated.');
    return gate.held;
  }
  releaseEarlierAnswer(): void { this.gates.at(-1)?.release(); }
  changeExternalAfterNextValidation(text: string): void { this.nextExternalChange = text; }
  interruptNextPreparation(): void { this.interruptNext = true; }

  replaceSuppliedSource(text: string): void { this.replaceSourceBytes(text); }
  replaceSuppliedConfiguration(changes: Record<string, unknown>): void {
    const configuration = JSON.parse(Buffer.from(this.originalConfiguration).toString('utf8'));
    this.replaceCapturedSource('expec.java.json', JSON.stringify({ ...configuration, ...changes }));
  }
  restoreSuppliedConfiguration(): void {
    Object.assign(this.snapshot.files.find(file => file.path === 'expec.java.json')!, { bytes: structuredClone(this.originalConfiguration) });
  }
  supplyIncorrectReadOnlyHash(): void {
    Object.assign(this.snapshot, { readOnlyFiles: [{ path: 'node_modules/example/index.d.ts',
      bytes: Buffer.from('export type Example = string;'), version: '0'.repeat(64) }] });
  }
  restoreSuppliedReadOnlyFiles(): void {
    if (this.originalReadOnly.present) Object.assign(this.snapshot, { readOnlyFiles: structuredClone(this.originalReadOnly.value) });
    else delete (this.snapshot as { readOnlyFiles?: ProjectSnapshot['readOnlyFiles'] }).readOnlyFiles;
  }
  mutateEarlierAnswer(): void {
    if (!this.earlierRead?.artifacts.length) throw new Error('Read an actual owned Java artifact first.');
    this.earlierRead.artifacts[0]!.file.bytes.fill(0); Object.assign(this.earlierRead.coverage, { complete: false });
  }

  override async dispose(): Promise<void> {
    this.disposing = true;
    for (const gate of this.gates) gate.release();
    for (const process of this.processes) if (!process.closed) process.child.kill();
    await Promise.allSettled([...this.pending]);
    this.restoreInputs?.(); this.owned.disable();
    await super.dispose();
  }
}
