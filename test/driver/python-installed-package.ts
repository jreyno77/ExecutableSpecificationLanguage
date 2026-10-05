import { PackageDriver } from './installed-package.js';

export interface PythonPackageObservation {
  packageUrl: string; executable: string; privateImportDenied: string;
  generated: Record<string, string>;
  declarations?: { code: number; stdout: string; stderr: string };
  command?: { code: number; stdout: string; stderr: string; report: {
    status: string; exitCode: number; problems: unknown[];
    stages: { name: string; status: string; native?: { exitCode: number }; collected?: unknown[];
      tests?: { title: string; state: string; errors: unknown[] }[]; errors?: unknown[] }[];
  } };
}

/** Installs one real tarball and invokes its public command in separate consumer processes. */
export class PythonInstalledDriver {
  readonly package = new PackageDriver();
  observed!: PythonPackageObservation;
  static prepare(): Promise<void> { return PackageDriver.prepare(); }
  static finish(): Promise<void> { return PackageDriver.finish(); }
  async installProduct(): Promise<void> { await this.package.install(); await this.run('prepare'); }
  async run(command: string, details: { source?: string; copies?: number } = {}): Promise<void> {
    this.observed = await this.package.pythonCommand({ command, ...details }) as PythonPackageObservation;
  }
  dispose(): Promise<void> { return this.package.dispose(); }
}
