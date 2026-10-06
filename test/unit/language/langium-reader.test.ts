import { describe, expect, it } from 'vitest';
import { LangiumReader } from '../../../src/language/langium/reader.js';

describe('reading syntax through Langium', () => {
  it('reads a capability without requiring its parameter type to exist', () => {
    expect(new LangiumReader().read({ sourceId: 'store.expec', text: 'concept Store { capability save(value: Unknown) }' }).status).toBe('accepted');
  });
  it('rejects an action step that names a value without calling it', () => {
    expect(new LangiumReader().read({ sourceId: 'store.expec', text: 'examples {\n scenario "save" {\n when save\n then true\n }\n}' }).status).toBe('rejected');
  });
});
