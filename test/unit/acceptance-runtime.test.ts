import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { acceptanceRuntime } from '../../src/acceptance-runtime.js';

const code = ts.transpileModule(acceptanceRuntime, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const { comparisonData, comparisonEqual, finiteNumber } = new Function('require', 'exports', code
  + '; return { comparisonData, comparisonEqual, finiteNumber };')(createRequire(import.meta.url), {}) as {
  comparisonData(value: unknown, operand: string): unknown;
  comparisonEqual(left: unknown, right: unknown): boolean;
  finiteNumber(value: unknown, operand: string): number;
};
const rejects = (value: unknown, path: string, reason: string, operand = 'actual') => {
  expect(() => comparisonData(value, operand)).toThrow(operand);
  expect(() => comparisonData(value, operand)).toThrow(path);
  expect(() => comparisonData(value, operand)).toThrow(reason);
};

describe('emitted comparison data retains only explicitly observed plain data', () => {
  it('copies a nested book without mutating or retaining application objects', () => {
    const original = Object.freeze({ title: 'Dune', copies: Object.freeze([1, 2]), available: true });
    const result = comparisonData(original, 'actual') as typeof original;
    expect(result).toStrictEqual({ title: 'Dune', copies: [1, 2], available: true });
    expect(result).not.toBe(original); expect(result.copies).not.toBe(original.copies);
    expect(original).toStrictEqual({ title: 'Dune', copies: [1, 2], available: true });
  });
  it('normalizes signed zero at every record and list depth', () => {
    const result = comparisonData({ counts: [-0, { value: -0 }] }, 'actual');
    expect(result).toStrictEqual({ counts: [0, { value: 0 }] });
    expect(comparisonEqual({ counts: [-0] }, { counts: [0] })).toBe(true);
  });
  it('compares ordinary and null-prototype records independently of insertion order', () => {
    const book = Object.assign(Object.create(null), { title: 'Dune', copies: 1 });
    const admitted = comparisonData(book, 'actual');
    expect(Object.getPrototypeOf(admitted)).toBe(Object.prototype);
    expect(Object.keys(admitted as object)).toEqual(['copies', 'title']);
    expect(comparisonEqual(book, { copies: 1, title: 'Dune' })).toBe(true);
    expect(comparisonEqual(book, { copies: 1, title: 'Dune', note: 'extra' })).toBe(false);
  });
  it('keeps an absent optional field absent and rejects explicit undefined', () => {
    expect(comparisonData({ title: 'Dune' }, 'actual')).toStrictEqual({ title: 'Dune' });
    rejects({ title: 'Dune', note: undefined }, '$.note', 'undefined');
    rejects({ note: undefined }, '$.note', 'undefined', 'expected');
  });
  it('keeps __proto__ as an ordinary own data key without changing any prototype', () => {
    const book = JSON.parse('{"__proto__":{"title":"Dune"},"copies":1}');
    const result = comparisonData(book, 'actual') as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result['__proto__']).toStrictEqual({ title: 'Dune' });
    expect(comparisonEqual(book, { copies: 1 })).toBe(false);
  });
  it('allows shared acyclic data and refuses an actual back edge at its data path', () => {
    const book = { title: 'Dune' };
    expect(comparisonData([book, book], 'actual')).toStrictEqual([{ title: 'Dune' }, { title: 'Dune' }]);
    const cycle: { title: string; child?: unknown } = { title: 'Dune' }; cycle.child = cycle;
    rejects({ book: cycle }, '$.book.child', 'cycle');
  });
  it('distinguishes an array hole from an explicit undefined element', () => {
    rejects(Array(1), '$[0]', 'array hole');
    rejects([undefined], '$[0]', 'undefined');
  });
  it('rejects named properties on arrays instead of discarding them', () => {
    rejects(Object.assign([1], { note: 'extra' }), '$.note', 'extra array property');
  });
  it('rejects a nonenumerable record property and a nonenumerable array element', () => {
    rejects(Object.defineProperty({ title: 'Dune' }, 'secret', { value: 1 }), '$.secret', 'nonenumerable');
    rejects(Object.defineProperty([1], '0', { value: 1, enumerable: false }), '$[0]', 'nonenumerable');
  });
  it('refuses record accessors without invoking them', () => {
    let calls = 0;
    rejects({ get title() { calls++; throw Error('getter ran'); } }, '$.title', 'accessor');
    expect(calls).toBe(0);
  });
  it('refuses array accessors without invoking them', () => {
    let calls = 0;
    const values = Object.defineProperty([1], '0', { get() { calls++; return 1; } });
    rejects(values, '$[0]', 'accessor'); expect(calls).toBe(0);
  });
  it('rejects symbol-keyed data rather than silently dropping it', () => {
    rejects({ title: 'Dune', [Symbol('secret')]: 1 }, '$', 'symbol key');
    rejects(Object.assign([1], { [Symbol.iterator]: () => [2].values() }), '$', 'symbol key');
  });
  it('rejects nonplain class and Date objects', () => {
    class Book { title = 'Dune'; }
    rejects(new Book(), '$', 'nonplain object'); rejects(new Date(0), '$', 'nonplain object');
  });
  it('does not invoke serialization or coercion hooks', () => {
    let calls = 0;
    rejects({ title: 'Dune', toJSON() { calls++; return { title: 'Dune' }; } }, '$.toJSON', 'function');
    rejects({ valueOf() { calls++; return 1; } }, '$.valueOf', 'function');
    expect(calls).toBe(0);
  });
  it('rejects proxies before invoking their reflection traps', () => {
    let calls = 0;
    const value = new Proxy({}, { ownKeys() { calls++; throw Error('trap ran'); }, getPrototypeOf() { calls++; throw Error('trap ran'); } });
    rejects(value, '$', 'proxy'); expect(calls).toBe(0);
  });
  it('rejects null, symbols, functions and bigint with a readable path', () => {
    rejects(null, '$', 'null'); rejects({ value: Symbol('x') }, '$.value', 'symbol');
    rejects({ run() {} }, '$.run', 'function'); rejects({ value: 1n }, '$.value', 'bigint');
  });
  it('reports quoted data keys unambiguously', () => {
    rejects({ 'a.b': { 'quote"': null } }, '$["a.b"]["quote\\\""]', 'null');
  });
  it('uses a deterministic failing key rather than application insertion order', () => {
    rejects({ zebra: undefined, alpha: null }, '$.alpha', 'null');
  });
});

describe('nested and direct comparisons use the same finite Number profile', () => {
  it('compares actual supported values without treating a mismatch as equal', () => {
    expect(comparisonEqual({ title: 'Dune', copies: [1] }, { title: 'Dune', copies: [2] })).toBe(false);
    expect(comparisonEqual(0.1 + 0.2, 0.3)).toBe(false);
    expect(comparisonEqual('1', 1)).toBe(false);
  });
  it('reports an unsupported left operand before inspecting the right operand', () => {
    expect(() => comparisonEqual({ value: undefined }, { value: null })).toThrow('left');
    expect(() => comparisonEqual({ value: undefined }, { value: null })).toThrow('$.value');
    expect(() => comparisonEqual({ value: 1 }, { value: undefined })).toThrow('right');
  });
  it('rejects each nonfinite value even when compared with itself', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      rejects({ numbers: [value] }, '$.numbers[0]', String(value));
      expect(() => comparisonEqual(value, value)).toThrow('left');
    }
  });
  it('guards numeric operands and arithmetic intermediates without decimal rounding', () => {
    expect(finiteNumber(0.1 + 0.2, 'addition result')).toBe(0.30000000000000004);
    expect(Object.is(finiteNumber(-0, 'left'), 0)).toBe(true);
    expect(() => finiteNumber(1 / 0, 'division result')).toThrow('division result');
    expect(() => finiteNumber(1 / 0, 'division result')).toThrow('Infinity');
    expect(() => finiteNumber('1', 'right')).toThrow('right');
    expect(() => finiteNumber('1', 'right')).toThrow('number');
  });
});
