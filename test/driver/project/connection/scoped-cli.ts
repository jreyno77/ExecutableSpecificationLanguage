import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import { runCli } from '../../../../src/cli/cli.js';
import * as native from '../../../../src/project/connection/native-process.js';
import { NpmDependencies } from '../../../../src/project/dependencies/npm-dependencies.js';
import { SourceLoader, type SourceLoad, type Diagnostic } from '../../../../src/index.js';

/** The real CLI owns admission, capture and compilation; only its native command port is controlled. */
export class ScopedCliDriver {
  report: { status: string; exitCode: number; problems: Diagnostic[] } | undefined;
  loaded: SourceLoad | undefined;
  inventory: readonly { name: string; version: string }[] | undefined;
  readonly calls: { command: string; args: readonly string[]; cwd: string }[] = [];
  loads = 0;
  constructor(private readonly manifest: string, private readonly target: string) {}
  async run(command: 'check' | 'install', recordedInventory = false): Promise<void> {
    const driver = this, load = SourceLoader.prototype.load, read = NpmDependencies.prototype.read;
    const loading = vi.spyOn(SourceLoader.prototype, 'load').mockImplementation(async function (this: SourceLoader, ...args) {
      driver.loads++; driver.loaded = await Reflect.apply(load, this, args); return driver.loaded;
    });
    const reading = vi.spyOn(NpmDependencies.prototype, 'read').mockImplementation(async function (this: NpmDependencies, ...args) {
      const result = await Reflect.apply(read, this, args); driver.inventory = result.value; return result;
    });
    const running = vi.spyOn(native, 'runNative').mockImplementation(async (tool, args, cwd) => {
      driver.calls.push({ command: tool, args: [...args], cwd });
      if (!recordedInventory) return { code: 1, stdout: '', error: 'Native work is unavailable in this metadata-only fixture.' };
      if (cwd !== driver.target || tool !== 'npm') throw new Error('The actual CLI requested a foreign native project or command.');
      if (args[0] === '--version') return { code: 0, stdout: '11.20.0\n' };
      const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
      const dependencies: Record<string, unknown> = {}, locations: unknown[] = [];
      for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
        const location = 'node_modules/' + name, path = join(cwd, location);
        const actual = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
        dependencies[name] = { name: actual.name, version: actual.version, path };
        locations.push({ name: actual.name, version: actual.version, path, location });
      }
      if (args[0] === 'ls') return { code: 0, stdout: JSON.stringify({ dependencies }) };
      if (args[0] === 'query') return { code: 0, stdout: JSON.stringify(locations) };
      throw new Error('The metadata check unexpectedly requested a native mutating command: ' + args[0]);
    });
    try {
      let text = '';
      const exitCode = await runCli([command, '--config', this.manifest, '--json'], {},
        { stdout: chunk => { text += chunk; }, stderr: chunk => { throw new Error('Unexpected CLI stderr: ' + chunk); } });
      const report = JSON.parse(text);
      if (report.exitCode !== exitCode) throw new Error('The actual CLI return disagreed with its JSON report.');
      this.report = report;
    } finally { running.mockRestore(); reading.mockRestore(); loading.mockRestore(); }
  }
}
