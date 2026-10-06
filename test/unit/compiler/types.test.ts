import { describe, expect, it } from 'vitest';
import { createNodeId } from '../../../src/model/model.js';
import { Types } from '../../../src/compiler/types.js';
import type { TypeId } from '../../../src/compiler/type-description.js';

describe('a shared type space describes authored and inferred types', () => {
  it('reuses the identity of an identical type description', () => {
    const types = new Types(), declaration = createNodeId();
    const first = types.intern({ kind: 'builtin', declaration, arguments: [] });
    expect(types.intern({ kind: 'builtin', declaration, arguments: [] })).toBe(first);
  });

  it('retains distinct alternatives in their first supplied order', () => {
    const types = new Types(), number = builtin(types), text = builtin(types);
    const union = types.unionOf([number, text, number]);
    expect(types.describe(union)).toEqual({ kind: 'union', alternatives: [number, text] });
    expect(types.unionOf([number, text])).toBe(union);
    expect(types.unionOf([number, number])).toBe(number);
  });

  it('rejects a child type from another type space', () => {
    const types = new Types(), foreign = builtin(new Types());
    expect(() => types.intern({ kind: 'optional', inner: foreign }))
      .toThrow(expect.objectContaining({ code: 'unknown-type', typeId: foreign }));
  });

  it('captures supplied arrays so later caller edits do not alter a type', () => {
    const types = new Types(), number = builtin(types), text = builtin(types);
    const elements = [number], tuple = types.intern({ kind: 'tuple', elements });
    elements.push(text);
    expect(types.describe(tuple)).toEqual({ kind: 'tuple', elements: [number] });
  });

  it('rejects an empty union rather than inventing an unknown type', () => {
    expect(() => new Types().unionOf([])).toThrow(RangeError);
  });
});

function builtin(types: Types): TypeId {
  return types.intern({ kind: 'builtin', declaration: createNodeId(), arguments: [] });
}
