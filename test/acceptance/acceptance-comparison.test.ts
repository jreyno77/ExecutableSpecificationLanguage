import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../dsl/acceptance-generation.js';

describe('the plain-data comparison profile is consistent and observable', () => {
  it('evaluates both operands in authored order before rejecting unsupported data', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`function first() returns Number
function second() returns Number
examples { example "both observed": first() => second() }`);
    await project.file('application.ts', `export const events: string[] = [];
export function first(): number { events.push('left'); return NaN; }
export function second(): number { events.push('right'); return 1; }`);
    await project.mapApplicationFunctions('application.ts', ['first', 'second']); project.observeApplicationEvents();
    await project.generate({ domain: 'numbers' }); await project.runGeneratedVitest();
    project.expectComparisonDataFailure('both observed', '$', 'NaN');
    await project.expectActualApplicationEvents(['left', 'right']);
  }, 60_000);
  it('equates signed zero in direct and nested comparisons without mutating observations', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Count { value: Number }
function count() returns Count
examples { fixture expected: Count = { value: 0 }
example "direct zero": count() => expected
example "nested zero": (count() == expected) and true => true }`);
    await project.mapApplicationReturning('count', 'return { value: -0 };', 'export interface Count { value: number }');
    await project.generate({ domain: 'counts' }); await project.runGeneratedVitest();
    project.expectTestsPassed(['direct zero', 'nested zero']); await project.expectApplicationRetainedNegativeZero();
  }, 60_000);
  it('keeps optional absence distinct from an explicit undefined property', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Book { title: Text\nnote: Text? }
function book() returns Book
examples { fixture expected: Book = { title: "Dune" }
example "direct book": book() => expected
example "nested book": (book() == expected) and true => true }`);
    await project.mapApplicationReturning('book', 'return { title: "Dune" };', 'export interface Book { title: string; note?: string }');
    await project.generate({ domain: 'books' }); await project.runGeneratedVitest(); project.expectTestsPassed(['direct book', 'nested book']);
    await project.replaceApplicationBody('book', 'return { title: "Dune", note: undefined };'); await project.runGeneratedVitest();
    project.expectComparisonDataFailures(['direct book', 'nested book'], '$.note', 'undefined');
  }, 60_000);
  it('rejects sparse array data rather than accepting an absent element', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function counts() returns List<Number>\nexamples { example "one zero": counts() => [0] }');
    await project.mapApplicationReturning('counts', 'return Array(1) as number[];');
    await project.generate({ domain: 'counts' }); await project.runGeneratedVitest(); project.expectComparisonDataFailure('one zero', '$[0]', 'array hole');
    await project.replaceApplicationBody('counts', 'return [undefined] as unknown as number[];'); await project.runGeneratedVitest();
    project.expectComparisonDataFailure('one zero', '$[0]', 'undefined');
  }, 60_000);
  it('does not serialize a class instance into a matching plain record', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Book { title: Text }
function book() returns Book
examples { fixture dune: Book = { title: "Dune" }
example "plain book": book() => dune }`);
    await project.mapApplicationReturning('book', 'class NativeBook { title = "Dune"; } return new NativeBook();', 'export interface Book { title: string }');
    await project.generate({ domain: 'books' }); await project.runGeneratedVitest(); project.expectComparisonDataFailure('plain book', '$', 'nonplain object');
  }, 60_000);
  it('compares record keys independently of insertion order while detecting extra data', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Book { title: Text\ncopies: Number }
function book() returns Book
examples { fixture dune: Book = { title: "Dune", copies: 1 }
example "same record": book() => dune }`);
    await project.mapApplicationReturning('book', 'return Object.assign(Object.create(null), { copies: 1, title: "Dune" });', 'export interface Book { title: string; copies: number }');
    await project.generate({ domain: 'books' }); await project.runGeneratedVitest(); project.expectTestsPassed(['same record']);
    await project.replaceApplicationBody('book', 'return { title: "Dune", copies: 1, note: "extra" };'); await project.runGeneratedVitest();
    project.expectRecordDifference('same record', 'note', 'extra');
  }, 60_000);
  it('rejects an accessor without invoking its hidden runtime work', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Book { title: Text }
function book() returns Book
examples { fixture dune: Book = { title: "Dune" }
example "data only": book() => dune }`);
    await project.mapApplicationReturning('book', 'return { get title() { throw Error("getter ran"); } };', 'export interface Book { title: string }');
    await project.generate({ domain: 'books' }); await project.runGeneratedVitest();
    project.expectComparisonDataFailure('data only', '$.title', 'accessor'); project.expectNoRuntimeFailureMessage('getter ran');
  }, 60_000);
  it('does not silently discard symbol-keyed application data', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Count { value: Number }
function count() returns Count
examples { fixture expected: Count = { value: 1 }
example "all own data": count() => expected }`);
    await project.mapApplicationReturning('count', 'return { value: 1, [Symbol("secret")]: 2 };', 'export interface Count { value: number }');
    await project.generate({ domain: 'counts' }); await project.runGeneratedVitest(); project.expectComparisonDataFailure('all own data', '$', 'symbol key');
  }, 60_000);
  it('fails on NaN even when both runtime operands are NaN', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function measured() returns Number\nexamples { example "not a number": measured() => measured() }');
    await project.mapApplicationReturning('measured', 'return NaN;');
    await project.generate({ domain: 'numbers' }); await project.runGeneratedVitest(); project.expectComparisonDataFailure('not a number', '$', 'NaN');
  }, 60_000);
  it('fails on positive infinity even when both operands are infinite', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function measured() returns Number\nexamples { example "not finite": measured() => measured() }');
    await project.mapApplicationReturning('measured', 'return Infinity;');
    await project.generate({ domain: 'numbers' }); await project.runGeneratedVitest(); project.expectComparisonDataFailure('not finite', '$', 'Infinity');
  }, 60_000);
  it('fails on negative infinity inside nested comparison data', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function numbers() returns List<Number>\nexamples { example "finite list": numbers() => [0] }');
    await project.mapApplicationReturning('numbers', 'return [-Infinity];');
    await project.generate({ domain: 'numbers' }); await project.runGeneratedVitest(); project.expectComparisonDataFailure('finite list', '$[0]', '-Infinity');
  }, 60_000);
  it('shows the actual binary64 result against an independently authored decimal', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "decimal addition": 0.1 + 0.2 => 0.3 }');
    await project.generate({ domain: 'numbers' }); await project.runGeneratedVitest();
    project.expectAssertionFailure({ expected: 0.3, actual: 0.30000000000000004 });
  }, 60_000);
  it('evaluates and awaits nested call arguments once in authored left-to-right order', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`function first() returns Number
function second() returns Number
function combine(a: Number, b: Number) returns Number
examples { example "ordered arguments": combine(first(), second()) => 23 }`);
    await project.file('application.ts', `export const events: string[] = []; let next = 2;
export async function first() { await Promise.resolve(); events.push('first'); return next++; }
export async function second() { await Promise.resolve(); events.push('second'); return next++; }
export function combine(a: number, b: number) { events.push('combine:' + a + ',' + b); return a * 10 + b; }`);
    await project.mapApplicationFunctions('application.ts', ['first', 'second', 'combine']); project.observeApplicationEvents();
    await project.generate({ domain: 'order' }); await project.runGeneratedVitest();
    project.expectTestsPassed(['ordered arguments']); await project.expectActualApplicationEvents(['first', 'second', 'combine:2,3']);
  }, 60_000);
});
