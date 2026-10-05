import { expect, it } from 'vitest';
import { kotlinDocumentation } from '../../src/kotlin-documentation.js';

const before = '/**\n * Generated promise.\n */';
const after = '/**\n * Changed promise.\n */';
function updated(current: string, previous = before, next = after): string | undefined {
  const edit = kotlinDocumentation(previous, current, next);
  return edit && current.slice(0, edit.start) + edit.text + current.slice(edit.end);
}
it('replaces an unchanged generated native documentation block', () => {
  expect(updated(before)).toBe(after);
});
it('keeps handwritten lines on both sides of the exact owned interior', () => {
  expect(updated('/**\n * Before: [Book].\n * Generated promise.\n * After: preserve this note.\n */'))
    .toBe('/**\n * Before: [Book].\n * Changed promise.\n * After: preserve this note.\n */');
});
it('refuses duplicate copies of the owned documentation interior', () => {
  expect(updated('/**\n * Generated promise.\n * Generated promise.\n */')).toBeUndefined();
});
it('refuses a handwritten change to the owned documentation interior', () => {
  expect(updated('/**\n * Author changed the promise.\n */')).toBeUndefined();
});
it('refuses a missing owned documentation block', () => {
  expect(updated('')).toBeUndefined();
});
it('adds generated documentation after existing handwritten notes', () => {
  expect(updated('/**\n * Keep [Book].\n */', '', after)).toBe('/**\n * Keep [Book].\n * Changed promise.\n */');
});
it('removes owned documentation without removing handwritten notes', () => {
  expect(updated('/**\n * Generated promise.\n * Keep [Book].\n */', before, '')).toBe('/**\n\n * Keep [Book].\n */');
});
it('removes a wholly generated documentation block', () => {
  expect(updated(before, before, '')).toBe('');
});
