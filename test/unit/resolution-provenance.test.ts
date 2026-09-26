import { expect, it } from 'vitest';
import { originLocation } from '../../src/resolution/problem.js';
import { declarationId } from '../../src/resolution/declaration.js';

it('identifies an external declaration without inventing an array position in supplied metadata', () => {
  const origin = { kind: 'external' as const, module: 'shopping', declaration: 'Cart' };
  const location = originLocation({ id: declarationId(), name: 'Cart', kind: 'record-type', origin });
  expect(location).toEqual({ kind: 'external', module: 'shopping', declaration: 'Cart' });
});
