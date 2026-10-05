import { expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { javaAssets } from '../../src/project/java/java-inputs.js';

it('ships exact upstream source coordinates and notice bytes beside every native library', async () => {
  const manifest = JSON.parse(await fs.readFile(join(javaAssets, 'artifacts.json'), 'utf8')) as {
    artifacts: { file: string; version: string; coordinate?: string; source?: string; notices?: string[] }[];
  };
  expect(manifest.artifacts.map(item => item.file).sort()).toEqual((await fs.readdir(javaAssets)).filter(file => file.endsWith('.jar')).sort());
  expect(manifest.artifacts.find(item => item.file === 'org.eclipse.jdt.core-3.47.0.jar')).toMatchObject({
    coordinate: 'org.eclipse.jdt:org.eclipse.jdt.core:3.47.0',
    source: 'https://repo.maven.apache.org/maven2/org/eclipse/jdt/org.eclipse.jdt.core/3.47.0/org.eclipse.jdt.core-3.47.0-sources.jar',
    notices: ['notices/org.eclipse.jdt.core-3.47.0.jar/about.html'],
  });
  const libraries = manifest.artifacts.filter(item => item.file !== 'expec-java-bridge.jar');
  expect(libraries).toHaveLength(19);
  for (const item of manifest.artifacts) {
    expect(createHash('sha256').update(await fs.readFile(join(javaAssets, item.file))).digest('hex'), item.file).toBe(item.version);
    if (item.file === 'expec-java-bridge.jar') continue;
    expect(item.coordinate, item.file).toMatch(/^[^:]+:[^:]+:[^:]+$/);
    expect(item.source, item.file).toMatch(/^https:\/\/repo\.maven\.apache\.org\/maven2\/.+-sources\.jar$/);
    expect(item.notices?.length, item.file).toBeGreaterThan(0);
    for (const path of item.notices!) {
      expect(path, item.file).toMatch(new RegExp('^notices/' + item.file.replaceAll('.', '\\.') + '/'));
      expect((await fs.readFile(join(javaAssets, path))).length, path).toBeGreaterThan(0);
    }
  }
});
