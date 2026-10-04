import { readFile, stat } from 'node:fs/promises';
import { expect } from 'vitest';
import { ConnectedBuildDriver } from '../driver/connected-build.js';

export class ConnectedBuild {
  private manifestRegions: string[] = [];
  private constructor(private readonly driver: ConnectedBuildDriver) {}
  static async create(options: { connected?: boolean } = {}): Promise<ConnectedBuild> {
    const driver = new ConnectedBuildDriver(); await driver.initialize(options.connected ?? true); return new ConnectedBuild(driver);
  }
  static prepare = ConnectedBuildDriver.prepare;
  source(name: string, text: string): Promise<void> { return this.driver.write('spec/' + name, text); }
  file(name: string, text: string): Promise<void> { return this.driver.write('project/' + name, text); }
  async entries(entries: string[]): Promise<void> { this.driver.manifest.build = { entries }; await this.driver.saveManifest(); }
  async rememberAllBytes(): Promise<void> { this.driver.before = await this.driver.capture(); }
  async requirePackage(alias: string, name: string, version: string, phases: string[]): Promise<void> {
    this.driver.manifest.packages = [{ alias, name, version, phases }]; await this.driver.saveManifest();
  }
  serveRealPackage(name: string, version: string): Promise<void> { return this.driver.servePackage(name, version); }
  async expectActualInstalledVersion(name: string, version: string): Promise<void> {
    expect(JSON.parse(await readFile(this.driver.path('project/node_modules/' + name + '/package.json'), 'utf8'))).toMatchObject({ name, version });
    expect(JSON.parse(await readFile(this.driver.path('project/package-lock.json'), 'utf8')).packages['node_modules/' + name].version).toBe(version);
  }
  expectByteReceipts(): void {
    const writes = this.driver.report.stages.flatMap((stage: any) => [stage.write, stage.initialization?.write].filter(Boolean));
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) for (const outcome of write.outcomes) for (const observation of [...outcome.before, ...outcome.after]) {
      if (observation.state === 'file') {
        expect(observation.bytes).toEqual({ encoding: 'base64', data: expect.any(String) });
        expect(Buffer.from(observation.bytes.data, 'base64').length).toBeGreaterThan(0);
      }
    }
  }
  async outputs(outputs: { id: string; options: object }[]): Promise<void> { this.driver.manifest.outputs = outputs; await this.driver.saveManifest(); }
  destinationFile(name: string, text: string): Promise<void> { return this.driver.write(name, text); }
  runInteractive(args: string[], answers: string[]): Promise<void> { return this.driver.run(args, '', answers); }
  afterInitializationBeforeManifestWrite(change: Record<string, unknown>): void { this.driver.manifestChange = change; }
  async rememberManifestOutsideConnection(): Promise<void> {
    const text = await readFile(this.driver.path('spec/expec.json'), 'utf8');
    this.manifestRegions = text.split('\n').filter(line => /"formatVersion"|"version"|"build"|"entries"|"main.expec"/.test(line));
    expect(this.manifestRegions.length).toBeGreaterThan(3);
  }
  async expectRememberedManifestRegionsUnchanged(): Promise<void> {
    const text = await readFile(this.driver.path('spec/expec.json'), 'utf8');
    for (const region of this.manifestRegions) expect(text).toContain(region);
  }
  async expectManifestValue(path: string[], value: unknown): Promise<void> {
    let actual = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    for (const part of path) actual = actual?.[part];
    expect(actual).toEqual(value);
  }
  expectNoManifestProperty(path: string[]): Promise<void> { return this.expectManifestValue(path, undefined); }
  async expectSelectedOutputs(ids: string[]): Promise<void> {
    const manifest = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    expect(manifest.outputs.map((output: any) => output.id)).toEqual(ids);
  }
  async expectDeclaredPackage(alias: string, name: string, version: string, phases: string[]): Promise<void> {
    const manifest = JSON.parse(await readFile(this.driver.path('spec/expec.json'), 'utf8'));
    expect(manifest.packages).toContainEqual({ alias, name, version, phases });
  }
  async expectDestinationText(path: string, text: string): Promise<void> { expect(await readFile(this.driver.path(path), 'utf8')).toBe(text); }
  async expectNoDestinationFile(path: string): Promise<void> { await expect(stat(this.driver.path(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  expectStage(name: string, status: string): void {
    if (this.driver.report) expect(this.driver.report.stages).toEqual(expect.arrayContaining([expect.objectContaining({ name, status })]));
    else expect(this.driver.result.stdout + this.driver.result.stderr).toContain(name + ': ' + status);
  }
  expectProblem(code: string): void { expect(this.driver.report.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code })])); }
  run(args: string[]): Promise<void> { return this.driver.run(args); }
  expectExit(code: number): void { expect(this.driver.result, this.driver.result.stderr).toMatchObject({ code }); }
  expectStatus(status: string): void { if (this.driver.report) expect(this.driver.report).toMatchObject({ format: 1, status }); else expect(this.driver.result.stdout + this.driver.result.stderr).toContain(status + ':'); }
  async expectAllBytesUnchanged(): Promise<void> { expect(await this.driver.capture()).toEqual(this.driver.before); }
  expectNoNativeExecution(): void {
    expect(this.driver.report.stages.every((stage: any) => stage.native === undefined && stage.execution === undefined)).toBe(true);
  }
  expectNoInitializationPrompt(): void { expect(this.driver.result.stdout + this.driver.result.stderr).not.toContain('Initialize'); }
  expectMessageContains(text: string): void { expect(this.driver.result.stdout + this.driver.result.stderr).toContain(text); }
  async expectLocatedProblem(code: string, file: string, text: string): Promise<void> {
    const source = await this.driver.sourceText(file);
    const finding = this.driver.report.problems.find((problem: any) => problem.code === code && problem.at.kind === 'source'
      && problem.at.range.sourceId.endsWith('/' + file) && Array.from(source).slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') === text);
    expect(finding, JSON.stringify(this.driver.report)).toBeDefined();
  }
  expectSyntaxIn(file: string): void {
    expect(this.driver.report.syntax.some((finding: any) => finding.primaryRange.sourceId.endsWith('/' + file))).toBe(true);
  }
  dispose(): Promise<void> { return this.driver.dispose(); }
}
