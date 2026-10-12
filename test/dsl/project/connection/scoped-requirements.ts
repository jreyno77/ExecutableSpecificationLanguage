import { onTestFinished } from 'vitest';
import { ConfigurationReader, type ScopedPackageRequirement } from '../../../../src/index.js';
import { ScopedRequirementsDriver } from '../../../driver/project/connection/scoped-requirements.js';
import { preservedTypeScriptProject as preparePreservedProject } from '../../../driver/project/connection/scoped-preservation.js';
import { scopedNativeManifest as prepareNativeManifest } from '../../../driver/project/connection/scoped-native-manifest.js';

/** Author actions and observations; native mechanics stay in the corresponding drivers. */
class ScopedProject {
  private readonly driver: ScopedRequirementsDriver;
  constructor(settings: Readonly<Record<string, unknown>>) { this.driver = new ScopedRequirementsDriver(settings); onTestFinished(() => this.driver.dispose()); }
  source(path: string, text: string): void { this.driver.source(path, text); }
  outsideSource(path: string, text: string): void { this.driver.outsideSource(path, text); }
  readConfiguration(): void { this.driver.readConfiguration(); }
  configurationAccepted(): boolean { return this.driver.configurationAccepted(); }
  configurationFindings() { return this.driver.configurationFindings(); }
  finding(code: string) { return this.driver.finding(code); }
  check(): Promise<void> { return this.driver.check(); }
  compilationAccepted(): boolean { return this.driver.compilationAccepted(); }
  requirements(path: string): string[] { return this.driver.requirements(path); }
  explicitRequirements(name: string): string[] { return this.driver.explicitRequirements(name); }
  requirementOrigins(path: string, alias: string, phase: string) { return this.driver.requirementOrigins(path, alias, phase); }
  captureLocalPath(path: string) { return this.driver.captureLocalPath(path); }
  outsideCaptureLocalPath(path: string) { return this.driver.outsideCaptureLocalPath(path); }
  outsideRequirements(path: string) { return this.driver.outsideRequirements(path); }
  verifyInventory(packages: readonly { name: string; version: string }[]): void { this.driver.verifyInventory(packages); }
  inventoryAccepted(): boolean { return this.driver.inventoryAccepted(); }
  inventoryFinding(name: string) { return this.driver.inventoryFinding(name); }
  nativeInstallations(): number { return this.driver.nativeInstallations(); }
  editorSource(path: string, text: string, version: number): void { this.driver.editorSource(path, text, version); }
  checkCurrent(): void { this.driver.checkCurrent(); }
  capturedRequirements(path: string) { return this.driver.capturedRequirements(path); }
  currentRequirements(path: string) { return this.driver.currentRequirements(path); }
  previousCurrentRequirements(path: string) { return this.driver.previousCurrentRequirements(path); }
  savedRequirements(requirements: unknown): Promise<void> { return this.driver.savedRequirements(requirements); }
  currentSourceVersion(path: string) { return this.driver.currentSourceVersion(path); }
  currentDeclarationNames() { return this.driver.currentDeclarationNames(); }
  savedSource(path: string): string { return this.driver.savedSource(path); }
  supplyNativeInventoryFiles(name: string, version: string): Promise<void> { return this.driver.supplyNativeInventoryFiles(name, version); }
  cliCheckWithRecordedNativePort(): Promise<void> { return this.driver.cliCheckWithRecordedNativePort(); }
  cliCheck(): Promise<void> { return this.driver.cliCheck(); }
  cliInstall(): Promise<void> { return this.driver.cliInstall(); }
  cliStatus(): string { return this.driver.cliStatus(); }
  cliExitCode(): number { return this.driver.cliExitCode(); }
  cliLoadedRequirements(path: string) { return this.driver.cliLoadedRequirements(path); }
  cliCaptureLocalPath(path: string) { return this.driver.cliCaptureLocalPath(path); }
  cliNativeInventoryVersions() { return this.driver.cliNativeInventoryVersions(); }
  cliFinding(code: string) { return this.driver.cliFinding(code); }
  actualSourceLoadCalls(): number { return this.driver.actualSourceLoadCalls(); }
  actualNativeCalls(): number { return this.driver.actualNativeCalls(); }
  filesUnchangedByCheck(): Promise<boolean> { return this.driver.filesUnchangedByCheck(); }
  filesUnchangedByCommands(): Promise<boolean> { return this.driver.filesUnchangedByCommands(); }
  mapSameCapturedSource(paths: readonly string[]): Promise<void> { return this.driver.mapSameCapturedSource(paths); }
  requirementMappingAccepted(): boolean { return this.driver.requirementMappingAccepted(); }
  mappingFinding(code: string) { return this.driver.mappingFinding(code); }
}
export function scopedProject(settings: Readonly<Record<string, unknown>>): ScopedProject { return new ScopedProject(settings); }
export async function scopedNativeManifest(settings: Readonly<Record<string, unknown>>) {
  const driver = await prepareNativeManifest(settings); onTestFinished(() => driver.dispose()); return driver;
}
export async function preservedTypeScriptProject(settings: { packages: readonly unknown[]; source: string }) {
  const driver = await preparePreservedProject(settings); onTestFinished(() => driver.dispose()); return driver;
}
export function readScopedConfiguration(settings: Readonly<Record<string, unknown>>) {
  const result = new ConfigurationReader([]).read({ sourceId: 'project44/supplied-settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: ['src/ui/view.expec'] }, ...settings,
  }) });
  if (!result.value || result.problems.length || result.deferred.length) throw new Error('The actual supplied configuration was not accepted: ' + JSON.stringify(result));
  return result.value;
}
export function attemptOriginMutation(record: ScopedPackageRequirement, value: string): void {
  if (!record?.at || !record.related[0]) throw new Error('The actual requirement needs both first and repeated origins before mutation.');
  for (const at of [record.at, record.related[0]]) {
    if (at.kind !== 'dependency' || !at.path.length) throw new Error('The actual requirement origin has no dependency path.');
    try { (at.path as (string | number)[])[0] = value; } catch (error) { if (!(error instanceof TypeError)) throw error; }
  }
}