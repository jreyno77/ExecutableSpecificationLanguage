import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { inspectArchive } from '../../../.github/ci/package-delivery.js';

it('records the real archive and refuses changed bytes at publication', () => {
  const directory = mkdtempSync(join(tmpdir(), 'expec-delivery-'));
  const entry = fileURLToPath(new URL('../../../.github/ci/package-delivery.ts', import.meta.url));
  const env = { ...process.env, MERGE_SHA: 'a'.repeat(40), BUILD_RUN: '900', BUILD_ATTEMPT: '1', PR_NUMBER: '53', PACKAGE_VERSION: '0.1.0-pr.53' };
  try {
    mkdirSync(join(directory, 'package'));
    writeFileSync(join(directory, 'package/package.json'), JSON.stringify({ name: 'executable-specification-language', version: '0.1.0-pr.53' }));
    writeFileSync(join(directory, 'package/README.md'), 'Verified content');
    const pack = () => execFileSync('tar', ['-czf', join(directory, 'executable-specification-language-0.1.0-pr.53.tgz'),
      '-C', directory, 'package'], { stdio: 'pipe' });
    pack();
    expect(inspectArchive(directory)).toMatchObject({ name: 'executable-specification-language', version: '0.1.0-pr.53' });
    execFileSync(process.execPath, [entry, 'record', directory], { env, stdio: 'pipe' });
    execFileSync(process.execPath, [entry, 'verify', directory], { env, stdio: 'pipe' });
    const evidence = readFileSync(join(directory, 'provenance.json'), 'utf8');
    writeFileSync(join(directory, 'package/README.md'), 'Changed after checking');
    pack();
    const rejected = spawnSync(process.execPath, [entry, 'verify', directory], { env, encoding: 'utf8' });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('digest');
    expect(readFileSync(join(directory, 'provenance.json'), 'utf8')).toBe(evidence);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('refuses an absent package instead of manufacturing delivery evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'expec-delivery-'));
  try { expect(() => inspectArchive(directory)).toThrow('Expected one package archive'); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});