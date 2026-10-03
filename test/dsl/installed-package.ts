import { expect, onTestFinished } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';

/** Consumer intentions and observations, independent of packaging and process mechanics. */
export class PackageExamples {
  private readonly driver = new PackageDriver();
  constructor() { onTestFinished(() => this.driver.dispose()); }
  static prepare(): Promise<void> { return PackageDriver.prepare(); }
  static finish(): Promise<void> { return PackageDriver.finish(); }
  installCurrentPackage(): Promise<void> { return this.driver.install(); }
  installPackageWithoutFile(path: string): Promise<void> { return this.driver.install({ withoutFile: path }); }
  installPackageWithoutDependency(name: string): Promise<void> { return this.driver.install({ withoutDependency: name }); }
  check(text: string): Promise<void> { return this.driver.check(text); }
  checkTypeScriptConsumer(): Promise<void> { return this.driver.checkTypeScript(); }
  runPublicApiCheck(): Promise<void> { return this.check('concept StoreGame { capability saveGame(snapshot: Text) returns Nothing }'); }

  expectInstalledPackageUsed(): void {
    expect(this.driver.location.insidePackage).toBe(true);
    expect(this.driver.location.real).toBe(this.driver.location.expected);
  }
  expectProblem(code: string, text: string): void {
    this.expectConsumerRan();
    expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code, text }));
  }
  expectNoAcceptedSpecification(): void { this.expectConsumerRan(); expect(this.driver.report.accepted).toBe(false); }
  expectDeclarationsAccepted(): void {
    expect(this.driver.declarations.code, this.driver.declarations.stdout + this.driver.declarations.stderr).toBe(0);
  }
  expectSpecificationAccepted(): void {
    this.expectConsumerRan();
    this.expectInstalledPackageUsed();
    expect(this.driver.report).toMatchObject({ accepted: true, syntax: [], problems: [], deferred: [] });
  }
  expectCapabilities(names: string[]): void { expect(this.driver.report.capabilities).toEqual(names); }
  expectConsumerFailedFor(missing: string): void {
    expect(this.driver.result.code).not.toBe(0);
    expect(this.driver.report.error?.code).toBe('ERR_MODULE_NOT_FOUND');
    if (missing.endsWith('.js')) expect(new URL(this.driver.report.error!.url!).pathname.split('/').at(-1)).toBe(missing);
    else expect(this.driver.report.error?.message).toContain(`Cannot find package '${missing}'`);
    this.expectInstalledPackageUsed();
  }
  private expectConsumerRan(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.error).toBeUndefined();
  }
}
