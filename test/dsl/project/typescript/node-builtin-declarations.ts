import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { ArtifactLocator } from '../../../../src/index.js';
import { NativeContextDriver } from '../../../driver/project/typescript/typescript-context.js';

type Site = { file: string; start: number; end: number; role: string };

export class BuiltinDeclarations {
  private static readonly active: BuiltinDeclarations[] = [];
  private readonly driver = new NativeContextDriver();
  private constructor(private readonly authored: Readonly<Record<string, string>>) {}
  static async author(sources: Record<string, string>): Promise<BuiltinDeclarations> {
    const example = new BuiltinDeclarations(Object.freeze({ ...sources }));
    this.active.push(example);
    await example.driver.connect();
    for (const [path, text] of Object.entries(example.authored)) await example.driver.file(path, text);
    return example;
  }
  static async clean(): Promise<void> {
    for (const example of this.active.splice(0)) await example.driver.dispose();
  }
  installedJavaScript(name: string, text: string): Promise<void> {
    return this.driver.package(name, { main: 'index.js' }, { 'index.js': text });
  }
  forbidInstalledImplementationReads(): void { this.driver.denyReads('runtime'); }
  capture(): Promise<void> { return this.driver.capture(); }
  expectComplete(): void {
    expect(this.driver.snapshot.problems).toEqual([]);
    expect(this.driver.snapshot.complete).toBe(true);
    for (const [path, text] of Object.entries(this.authored)) {
      const file = this.driver.snapshot.files.find(file => file.path === path);
      expect(file, path).toBeDefined();
      expect(Buffer.from(file!.bytes).toString()).toBe(text);
      expect(file!.version).toBe(createHash('sha256').update(text).digest('hex'));
    }
  }
  expectDeclaredClassUsed(module: string, name: string, declarationFile: string, useFile: string): void {
    const id = 'declared-builtin';
    this.driver.select(id, declarationFile, [{ kind: 'namespace', name: module }, { kind: 'class', name }]);
    this.driver.search(id);
    const found = this.driver.found;
    expect(found.problems).toEqual([]);
    expect(found.definitions.map(at => this.site(at).file)).toEqual([declarationFile]);
    expect(found.incoming.coverage.complete).toBe(true);
    expect(found.incoming.unresolved).toEqual([]);
    const source = this.text(useFile);
    const imported = source.indexOf(name), constructed = source.indexOf('new ' + name) + 4;
    expect(imported).toBeGreaterThanOrEqual(0);
    expect(constructed).toBeGreaterThan(imported);
    const uses = found.incoming.uses.map(use => this.site(use.at)).filter(site =>
      site.file === useFile && source.slice(site.start, site.end) === name);
    expect(uses.map(site => ({ start: site.start, end: site.end, role: site.role }))).toEqual([
      { start: imported, end: imported + name.length, role: 'import' },
      { start: constructed, end: constructed + name.length, role: 'construct' },
    ]);
  }
  expectInstalledImplementationRefused(file: string, token: string): void {
    expect(this.driver.snapshot.complete).toBe(false);
    const problem = this.driver.snapshot.problems.find(problem => problem.code === 'unsupported-native-input'
      && problem.at.kind === 'dependency' && problem.at.path[1] === file);
    expect(problem, JSON.stringify(this.driver.snapshot.problems)).toBeDefined();
    if (problem?.at.kind !== 'dependency') throw Error('Expected a located installed implementation refusal.');
    const start = problem.at.path[2], length = problem.at.path[3];
    expect(typeof start).toBe('number');
    expect(typeof length).toBe('number');
    expect(this.text(file).slice(Number(start), Number(start) + Number(length))).toBe(token);
    expect(problem.message).toBe(`Native import ${token.slice(1, -1)} requires installed implementation rather than declarations.`);
  }
  expectNoInstalledJavaScriptConsumed(): void {
    expect(this.driver.forbidden).toEqual([]);
    expect((this.driver.snapshot.readOnlyFiles ?? []).filter(file => /\.(?:[cm]?js|jsx)$/i.test(file.path))).toEqual([]);
  }
  private text(file: string): string {
    const text = this.authored[file];
    if (text === undefined) throw Error('Expected independently authored source ' + file);
    return text;
  }
  private site(at: ArtifactLocator): Site { return at.value as Site; }
}
