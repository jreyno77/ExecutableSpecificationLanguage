import { expect, onTestFinished } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PackageDriver } from '../driver/installed-package.js';

export class InstalledKotlin {
  private readonly driver = new PackageDriver();
  constructor() { onTestFinished(() => this.driver.dispose()); }
  static prepare() { return PackageDriver.prepare(); }
  static finish() { return PackageDriver.finish(); }
  installCurrentPackage() { return this.driver.install(); }
  deliver(source: string) { return this.driver.deliverKotlin(source); }
  private get observed() { expect(this.driver.result.code, this.driver.result.stderr).toBe(0); expect(this.driver.report.kotlin).toBeDefined(); return this.driver.report.kotlin!; }
  expectInitializedAndInstalled(name: string, version: string): void {
    expect(this.observed.initialized).toBe('applied');
    expect(this.observed.acquired).toMatchObject({ problems: [], deferred: [], value: expect.arrayContaining([{ name, version }]) });
    expect(this.observed.created).toMatchObject({ problems: [], receipt: { status: 'applied' } });
    expect(this.observed.tests).toMatchObject({ problems: [], receipt: { status: 'applied' } });
  }
  expectGeneratedSteps(steps: string[]): void { for (const step of steps) expect(this.observed.testText).toContain(step); }
  expectCurrentReadContains(text: string): void {
    expect(this.observed.observed).toMatchObject({ coverage: { complete: true }, problems: [] });
    expect(this.observed.observed.files.map(file => file.text).join('\n')).toContain(text);
  }
  expectOnlyCaller(file: string, name: string): void {
    const observed = this.observed; expect(observed.search).toMatchObject({ problems: [], incoming: { coverage: { complete: true } } });
    const uses = observed.search.incoming.uses.filter(use => (use.at.value as { file: string }).file === file);
    expect(uses).toHaveLength(1);
    const at = uses[0]!.at.value as { start: number; end: number };
    expect(at.start).toBe(observed.caller.indexOf(name + '(8.0'));
    expect(observed.caller.slice(at.start, at.end)).toBe(name);
  }
  expectImplementedBodyPreserved(): void {
    expect(this.observed.repeated).toMatchObject({ problems: [], receipt: { status: 'unchanged' } });
    expect(this.observed.after).toBe(this.observed.before); expect(this.observed.testUnchanged).toBe(true);
  }
  private tests(which: 'passed' | 'broken') {
    return this.observed[which].xml.flatMap(xml => Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('testcase')));
  }
  expectPassed(name: string): void {
    expect(this.observed.passed.code, this.observed.passed.stderr).toBe(0);
    const tests = this.tests('passed'); expect(tests).toHaveLength(1); expect(tests[0]!.getAttribute('name')).toBe(name + '()');
    expect(tests[0]!.getElementsByTagName('failure')).toHaveLength(0); expect(tests[0]!.getElementsByTagName('error')).toHaveLength(0); expect(tests[0]!.getElementsByTagName('skipped')).toHaveLength(0);
  }
  expectWrongApplicationFailed(name: string, expected: number, actual: number): void {
    expect(this.observed.broken.code).toBe(1);
    const tests = this.tests('broken'); expect(tests).toHaveLength(1); expect(tests[0]!.getAttribute('name')).toBe(name + '()');
    expect(tests[0]!.getElementsByTagName('failure')).toHaveLength(1);
    expect(tests[0]!.textContent).toContain('expected: <' + expected.toFixed(1) + '> but was: <' + actual.toFixed(1) + '>');
  }
  async expectInstalledPackageAndNotices(): Promise<void> {
    expect(this.driver.location.insidePackage).toBe(true); expect(this.driver.location.real).toBe(this.driver.location.expected);
    const packedBytes = await this.driver.packedBytes();
    expect(packedBytes).toBeGreaterThan(0); expect(this.observed.nativeBytes).toBeGreaterThan(0); expect(this.observed.jars).toBe(23);
    expect(this.observed.artifacts).toHaveLength(22);
    for (const artifact of this.observed.artifacts) { expect(artifact.actual, artifact.file).toBe(artifact.expected); expect(artifact.notices.length).toBeGreaterThan(0); for (const notice of artifact.notices) expect(notice.bytes, notice.path).toBeGreaterThan(0); }
    expect(this.observed.notice).toContain('explicitly configured JDK21'); expect(this.observed.notice).toContain('Explicit installation performs Gradle9.1');
    console.info('Installed Kotlin artifact:', { packedBytes, nativeBytes: this.observed.nativeBytes, jars: this.observed.jars, upstreamArtifacts: this.observed.artifacts.length });
  }
  expectCheckoutCanariesDenied(): void { expect(this.observed.canaries).toEqual([true, true]); expect(this.observed.unexpectedDenials).toEqual([]); }
}
