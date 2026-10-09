import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { BuildContext } from '../../../src/cli/cli-context.js';
import type { CheckedManifest } from '../../../src/cli/cli-check.js';
import type { Configuration } from '../../../src/project/connection/configuration.js';
import type { ProjectContext } from '../../../src/project/connection/project-connection.js';
import { InitialSnapshotDriver } from '../project/connection/initial-snapshot.js';

export class ConfirmedBuildDriver {
  readonly snapshot = new InitialSnapshotDriver();
  selectedAcquisition = 1;
  private context!: BuildContext;
  private rejection: string | undefined;

  async setup(path: string, text: string, ordinary = false, native = false): Promise<void> {
    await this.snapshot.setup(text, path);
    await this.file('expec.json', '{}');
    const checked: CheckedManifest = { manifest: this.snapshot.path('expec.json'), text: '{}', captures: [], problems: [], syntax: [], deferred: [] };
    const actual = this.snapshot.project;
    const project: ProjectContext = { root: actual.root,
      readSnapshot: () => this.snapshot.acquire('ordinary', () => actual.readSnapshot()),
      ...(!ordinary ? { captureSnapshot: () => this.snapshot.acquire('capture', () => {
        if (this.rejection) throw Error(this.rejection);
        return actual.captureSnapshot!();
      }) } : {}),
    };
    const outputs: Configuration['outputs'] = native ? [{ id: 'typescript', options: { imports: [{ from: 'tiny-types' }] } }] : [];
    if (native) {
      await this.file('package.json', '{"name":"confirmed-build-consumer","type":"module","private":true}');
      await this.file('node_modules/tiny-types/package.json', '{"name":"tiny-types","version":"1.0.0","types":"index.d.ts"}');
      await this.file('node_modules/tiny-types/index.d.ts', 'export interface Value { n: number }');
    }
    this.context = new BuildContext(project, checked, outputs);
  }
  private async file(path: string, text: string): Promise<void> {
    const target = this.snapshot.path(path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }
  status(path: string, acquisition = 1): void {
    this.target(path, acquisition); this.snapshot.arrange('status');
  }
  repeatedStatus(path: string): void { this.target(path, 1); this.snapshot.arrange('repeated-status'); }
  replace(path: string, text: string): void { this.target(path, 1); this.snapshot.replaceAfterFirstClose(text); }
  reject(message: string): void { this.rejection = message; }
  private target(path: string, acquisition: number): void {
    if (path !== 'src/book.ts') throw Error('This acquisition example observes only its authored src/book.ts file.');
    this.selectedAcquisition = acquisition;
  }
  collect(): Promise<void> { return this.snapshot.observe(() => this.context.readSnapshot(), this.selectedAcquisition); }
  dispose(): Promise<void> { return this.snapshot.dispose(); }
}
