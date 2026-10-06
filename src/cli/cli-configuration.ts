import { promises as fs } from 'node:fs';
import { basename, dirname } from 'node:path';
import { applyEdits, modify } from 'jsonc-parser';
import type { Configuration } from '../project/connection/configuration.js';
import type { Diagnostic } from '../compiler/checking.js';
import { ProjectFiles, hash, sameIdentity, sameObservation, type ObservedFile } from '../project/connection/project-files.js';
import type { WriteResult } from '../project/connection/project-writer.js';

/** The manifest is a separately guarded file, not a partial connected-project snapshot. */
export class ConfigurationFile {
  private constructor(private readonly selected: string, private readonly files: ProjectFiles,
    private readonly before: ObservedFile, private readonly text: string) {}
  static async capture(selected: string, text: string): Promise<ConfigurationFile> {
    for (let path = selected; dirname(path) !== path; path = dirname(path)) {
      if ((await fs.lstat(path)).isSymbolicLink()) throw Error('The manifest must use an ordinary file and parent route.');
    }
    const parent = await fs.realpath(dirname(selected)), info = await fs.lstat(parent, { bigint: true });
    const files = new ProjectFiles({ path: parent, identity: `${info.dev}:${info.ino}:${parent}` });
    const before = await files.read(basename(selected));
    if (before.value.state !== 'file' || !Buffer.from(before.value.bytes).equals(Buffer.from(text)) || before.info!.nlink !== 1n) {
      throw Error('The manifest changed or has multiple links; reread it before initialization.');
    }
    return new ConfigurationFile(selected, files, before, text);
  }
  async save(configuration: Configuration, signal?: AbortSignal): Promise<WriteResult> {
    const path = basename(this.selected), old = JSON.parse(this.text) as Record<string, unknown>;
    let text = this.text;
    const edit = (at: (string | number)[], value: unknown) => {
      text = applyEdits(text, modify(text, at, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: this.text.includes('\r\n') ? '\r\n' : '\n' } }));
    };
    edit(['project', 'root'], configuration.project!.root);
    for (const key of ['outputs', 'packages'] as const) {
      const previous = old[key] as unknown[] | undefined;
      if (!previous) edit([key], configuration[key]);
      else for (let index = previous.length; index < configuration[key].length; index++) edit([key, index], configuration[key][index]);
    }
    const bytes = new TextEncoder().encode(text), change = { kind: 'write' as const, path, bytes };
    const problems: Diagnostic[] = [], files = this.files;
    let attempted = false, complete = false;
    const guard = async () => {
      if (signal?.aborted) throw Error('Manifest persistence was cancelled.');
      if (await fs.realpath(dirname(this.selected)) !== files.root.path) throw Error('The manifest parent route changed.');
      await files.verify(path, this.before);
    };
    try {
      await guard(); await files.acquire(); await files.verifyLock(); await guard();
      attempted = true; await files.write(path, bytes, this.before);
      const observed = await files.read(path);
      complete = observed.value.state === 'file' && observed.value.version === hash(bytes)
        && !!observed.info && sameIdentity(this.before.info!, observed.info);
      if (await fs.realpath(dirname(this.selected)) !== files.root.path) complete = false;
      if (!complete) throw Error('The saved manifest could not be verified.');
      await files.verifyLock();
    } catch (error) {
      problems.push({ code: 'configuration-unsaved', message: String(error), at: { kind: 'dependency', path: ['manifest', this.selected] }, related: [] });
    }
    const cleanup = await files.cleanup(problems), after = await files.observe(path);
    const state = complete ? 'applied' : !attempted || sameObservation(this.before.value, after) ? 'not-applied' : 'uncertain';
    return { root: files.root, status: complete && !problems.length ? 'applied' : 'stopped',
      outcomes: [{ change, state, before: [this.before.value], after: [after] }], problems, ...cleanup };
  }
}
