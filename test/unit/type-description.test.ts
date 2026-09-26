import { describe, expect, it } from 'vitest';
import { inspectText } from '../support/query-inspection.js';
import { describeType } from '../support/type-description.js';

function declaredType(text: string): string {
  const inspection = inspectText(text);
  const declaration = Array.from(inspection.nodes('alias-type-declaration'))[0]!;
  return describeType(inspection, declaration.payload.targetType);
}

describe('a consumer describes complete authored type structure', () => {
  it('retains nested generic arguments', () => {
    expect(declaredType('type Value = List<Pair<Number>>')).toBe('List<Pair<Number>>');
  });

  it('retains grouping, union alternatives and optionality', () => {
    expect(declaredType('type Value = (Number | Text)?')).toBe('(Number | Text)?');
  });

  it('retains ordered tuple elements and their type modifiers', () => {
    expect(declaredType('type Value = [Number, Text?]')).toBe('[Number, Text?]');
  });

  it('retains literal type alternatives including a negative number', () => {
    expect(declaredType('type Value = "quick" | -2 | true')).toBe('"quick" | -2 | true');
  });

  it('keeps a quoted segment distinguishable from two reference segments', () => {
    expect(declaredType('type Value = List<Models.`Player.State`>')).toBe('List<Models.`Player.State`>');
    expect(declaredType('type Value = Models.Player.State')).toBe('Models.Player.State');
  });

  it('keeps escaped quote and backslash data distinguishable in quoted names', () => {
    expect(declaredType('type Value = `A\\`B\\\\C`')).toBe('`A\\`B\\\\C`');
  });
});
