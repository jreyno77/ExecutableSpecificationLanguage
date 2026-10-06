import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const distribution = new URL('../../../../src/project/kotlin/resources/', import.meta.url);
const text = (path: string) => readFile(new URL(path, distribution), 'utf8');

describe('staged Kotlin native notices', () => {
  it('retains the compiler and embedded component copyright and license terms', async () => {
    expect(await text('licenses/kotlin-2.4.10/NOTICE.txt')).toContain('Copyright 2010-2024 JetBrains');
    expect(await text('licenses/kotlin-2.4.10/third_party/rhino_LICENSE.txt')).toContain('Netscape Public License 1.1');
    expect(await text('licenses/intellij-251.27812.49/JDOM-LICENSE.txt')).toContain('Copyright (C) 2000-2012 Jason Hunter & Brett McLaughlin.');
    expect(await text('licenses/kotlin-1.6.10/third_party/protobuf_license.txt')).toContain('Google Inc.');
  });

  it('identifies every shipped upstream binary and locates its actual notices', async () => {
    const inventory: { artifacts: { coordinate: string; file: string; sha256: string; notices: string[]; source: string }[] } = JSON.parse(await text('dependencies.json'));
    expect(inventory.artifacts).toHaveLength(22);
    expect(inventory.artifacts.map(item => item.coordinate)).toContain('org.jetbrains.kotlin:kotlin-reflect:1.6.10');
    expect(inventory.artifacts.map(item => item.coordinate)).toContain('org.jetbrains.intellij.deps.kotlinx:kotlinx-coroutines-core-jvm:1.10.2-intellij-2');
    expect((await readdir(new URL('lib/', distribution))).filter(file => file.endsWith('.jar')).sort()).toEqual([...inventory.artifacts.map(item => item.file), 'expec-kotlin.jar'].sort());
    for (const artifact of inventory.artifacts) {
      expect(createHash('sha256').update(await readFile(new URL('lib/' + artifact.file, distribution))).digest('hex')).toBe(artifact.sha256);
      expect(artifact.source).toMatch(/^https:\/\//);
      expect(artifact.notices.length).toBeGreaterThan(0);
      for (const notice of artifact.notices) expect((await text(notice)).trim().length, notice).toBeGreaterThan(100);
    }
  });
});
