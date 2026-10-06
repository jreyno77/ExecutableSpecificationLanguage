import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigurationReader } from '../../../src/project/connection/configuration.js';
import { ConfigurationFile } from '../../../src/cli/cli-configuration.js';

const roots: { path: string; parent: string }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { path, parent } of roots.splice(0)) {
    if (dirname(await fs.realpath(path)) !== parent) throw Error('Unexpected manifest fixture cleanup.');
    await fs.rm(path, { recursive: true, force: true });
  }
});
async function manifest() {
  const parent = await fs.realpath(tmpdir()), root = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-cli-manifest-')));
  roots.push({ path: root, parent });
  const path = join(root, 'expec.json'), text = '{ "formatVersion": 1, "version": "1.0.0", "build": { "entries": ["main.expec"] }, "outputs": [] }\n';
  await fs.writeFile(path, text);
  const configuration = new ConfigurationReader([]).read({ sourceId: path, text }).value!;
  return { path, text, file: await ConfigurationFile.capture(path, text), desired: { ...configuration, project: { root: '../application' } } };
}

describe('saving an accepted connection', () => {
  it('retains a concurrently edited manifest and records the actual bytes', async () => {
    const input = await manifest(), updated = input.text.replace('1.0.0', '1.1.0');
    await fs.writeFile(input.path, updated);
    const result = await input.file.save(input.desired);
    expect(result.status).toBe('stopped');
    expect(result.problems.map(problem => problem.code)).toContain('configuration-unsaved');
    expect(await fs.readFile(input.path, 'utf8')).toBe(updated);
    expect(result.outcomes[0]!.state).toBe('not-applied');
    expect(result.outcomes[0]!.after[0]).toMatchObject({ state: 'file', bytes: Buffer.from(updated) });
  });

  it('refuses a same-byte file replacement during persistence', async () => {
    const input = await manifest(), open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === input.path && args[1] === 'r+') {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async (...writeArgs) => {
          await write(...writeArgs);
          await fs.rename(input.path, input.path + '.replaced');
          await fs.writeFile(input.path, writeArgs[0] as Uint8Array);
        };
      }
      return handle;
    });
    const result = await input.file.save(input.desired);
    expect(result.status).toBe('stopped');
    expect(result.outcomes[0]!.state).toBe('uncertain');
    expect(result.problems.map(problem => problem.code)).toContain('configuration-unsaved');
    expect(JSON.parse(await fs.readFile(input.path, 'utf8')).project.root).toBe('../application');
  });

  it('honors cancellation before creating a writer marker or editing bytes', async () => {
    const input = await manifest(), controller = new AbortController(); controller.abort();
    const result = await input.file.save(input.desired, controller.signal);
    expect(result.status).toBe('stopped');
    expect(result.outcomes[0]!.state).toBe('not-applied');
    expect(await fs.readFile(input.path, 'utf8')).toBe(input.text);
    await expect(fs.stat(join(dirname(input.path), '.expec'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
