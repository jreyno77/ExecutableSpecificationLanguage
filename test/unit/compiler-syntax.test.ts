import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AntlrSyntaxReader } from '../../src/grammar/reader.js';
import { sourceFixture } from '../support/source-fixture.js';

const reader = new AntlrSyntaxReader();

function fixtureFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? fixtureFiles(path) : entry.name.endsWith('.expec') ? [path] : [];
  });
}

describe('compiler input syntax', () => {
  const files = ['valid', 'invalid', 'deferred'].flatMap(area => fixtureFiles(`test/resources/compiler/${area}`));
  for (const file of files.filter(file => !file.endsWith('syntax-error.expec'))) {
    it(`leaves compiler validation decisions unresolved for ${file}`, () => {
      const result = reader.read({ sourceId: file, text: readFileSync(file, 'utf8') });
      expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
    });
  }

  it.each(['source.expec', 'recognition.expec', 'source-model.expec', 'compiler.expec'])(
    'reads the language self-description without loading imports: %s', name => {
      const result = reader.read(sourceFixture(`self-description/${name}`, 'compiler'));
      expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
    },
  );
});
