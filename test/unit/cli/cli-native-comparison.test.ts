import { afterEach, describe, expect, it } from 'vitest';
import { hash } from '../../../src/project/connection/project-files.js';
import { asUint8ArraySlices, createNativeBuild, expectNativeDisagreement, fileText, observeEditableArrayBodyClones,
  replaceFile, swapFiles, type NativeBuildExample } from '../../driver/cli/build-native-comparison.js';

const builds: NativeBuildExample[] = [];
afterEach(async () => { for (const build of builds.splice(0)) await build.dispose(); });
async function nativeBuild(files: Record<string, string>): Promise<NativeBuildExample> {
  const build = await createNativeBuild(files); builds.push(build); return build;
}
const source = "import type { Value } from 'tiny-types';\nexport const value: Value = { n: 1 };\n";
class AuditMetadata { constructor(readonly source: string, readonly detail: { revision: number }) {} }

describe('collecting the same editable project for native builds', () => {
  it('accepts equal Buffer and Uint8Array slices with different offsets', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.nativeObservation(asUint8ArraySlices);
    const result = await build.collect();
    expect(result.complete).toBe(true); expect(result.problems).toEqual([]);
    expect(fileText(result, 'node_modules/tiny-types/index.d.ts', true)).toBe('export interface Value { n: number }');
    expect(fileText(result, 'assets/data.bin')).toBe('one');
  });
  it('rejects different visible bytes even when the declared version is retained', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.nativeObservation(files => replaceFile(files, 'assets/data.bin', { bytes: Buffer.from('two') }));
    expectNativeDisagreement(await build.collect());
  });
  it('rejects a changed declared version even when the visible bytes agree', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.nativeObservation(files => replaceFile(files, 'assets/data.bin', { version: hash(Buffer.from('two')) }));
    expectNativeDisagreement(await build.collect());
  });
  it('rejects a missing file rather than treating native acquisition as equivalent', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.nativeObservation(files => files.filter(file => file.path !== 'assets/data.bin'));
    expectNativeDisagreement(await build.collect());
  });
  it('retains editable file order', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/a.bin': 'one', 'assets/b.bin': 'two' });
    build.nativeObservation(files => swapFiles(files, 'assets/a.bin', 'assets/b.bin'));
    expectNativeDisagreement(await build.collect());
  });
  it('rejects a changed path even when the version and bytes agree', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.nativeObservation(files => replaceFile(files, 'assets/data.bin', { path: 'assets/renamed.bin' }));
    expectNativeDisagreement(await build.collect());
  });
  it('retains structured-clone normalization of extra non-byte metadata', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.fileMetadata('assets/data.bin', { audit: new AuditMetadata('caller', { revision: 1 }) });
    const result = await build.collect();
    expect(result.complete).toBe(true); expect(result.problems).toEqual([]);
  });
  it('rejects changed nested metadata rather than comparing just path and version', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.fileMetadata('assets/data.bin', { audit: { revision: 1 } });
    build.nativeObservation(files => replaceFile(files, 'assets/data.bin', { audit: { revision: 2 } }));
    expectNativeDisagreement(await build.collect());
  });
  it('distinguishes missing metadata from an own present-undefined field', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    build.nativeObservation(files => replaceFile(files, 'assets/data.bin', { audit: undefined }));
    expectNativeDisagreement(await build.collect());
  });
  it('compares native editable files without cloning their bodies for equality', async () => {
    const build = await nativeBuild({ 'src/value.ts': source, 'assets/data.bin': 'one' });
    const copies = observeEditableArrayBodyClones(['assets/data.bin', 'expec.json', 'package.json', 'src/value.ts']);
    try {
      const result = await build.collect();
      expect(result.complete).toBe(true); expect(result.problems).toEqual([]);
      expect(copies.fileArraysWithBodies()).toEqual([]);
      expect(copies.ownedSnapshotCopies()).toBeGreaterThan(0);
      expect(fileText(result, 'node_modules/tiny-types/index.d.ts', true)).toBe('export interface Value { n: number }');
    } finally { copies.restore(); }
  });
});
