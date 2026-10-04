import { expect } from 'vitest';
import { isAbsolute } from 'node:path';
import { CleanPackageDriver } from '../driver/clean-package.js';

export class CleanPackage {
  private constructor(private readonly driver: CleanPackageDriver) {}
  static async installed(): Promise<CleanPackage> { const driver = new CleanPackageDriver(); await driver.prepare(); return new CleanPackage(driver); }
  async expectNoDevelopmentCheckout(): Promise<void> {
    for(const path of ['src','.git','.local-docs'])expect(await this.driver.absent(path),path+' must not be delivered to this consumer job.').toBe(true);
    expect(await this.driver.artifactDigest()).toBe(this.driver.metadata.sha256);
    expect(this.driver.metadata.commit).toMatch(/^[a-f0-9]{40}$/);
  }
  async expectPrivateAndDevelopmentImportsUnavailable(): Promise<void> {
    expect(await this.driver.forbiddenImports()).toEqual({development:'ERR_MODULE_NOT_FOUND',private:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  }
  async expectInstalledResources(): Promise<void> {
    const paths=await this.driver.installedPaths();
    expect(paths.version).toBe(this.driver.metadata.version); expect(isAbsolute(paths.within)||paths.within.startsWith('..')).toBe(false);
    expect(paths.grammar).toContain('executable-specification-language');
    console.log(JSON.stringify({delivery:this.driver.metadata,installed:paths}));
  }
  async expectCommands(commands:string[]): Promise<void> { await this.driver.command(['--help']); expect(this.driver.result.code).toBe(0); for(const command of commands)expect(this.driver.result.stdout).toContain(command); }
  async expectVersion(): Promise<void> { await this.driver.command(['--version']); expect(this.driver.result.code).toBe(0); expect(this.driver.result.stdout.trim()).toBe(this.driver.metadata.version); }
  async expectPublicCapability(name:string): Promise<void> { expect(await this.driver.publicConsumer()).toEqual({capabilities:[name],problems:[],syntax:[],deferred:[]}); }
}
