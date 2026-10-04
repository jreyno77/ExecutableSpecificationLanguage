import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../dsl/acceptance-generation.js';

describe('native contract validation and combined authored updates', () => {
  it('refuses different application exports that would share one native import name', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function first() returns Number\nfunction second() returns Number\nexamples { example "sum": first() + second() => 3 }');
    await project.file('first.ts', 'export function count(): number { return 1; }');
    await project.file('second.ts', 'export function count(): number { return 2; }');
    await project.mapApplicationFunction('first', 'first.ts', 'count'); await project.mapApplicationFunction('second', 'second.ts', 'count');
    await project.rememberFiles(); await project.generate({ domain: 'counts' });
    project.expectMappingProblem('native-name-conflict'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('rejects a native parameter narrowed to the one literal used by this example', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { observation count(value: Number) returns Number\nexample "one": count(1) => 1 }');
    await project.connectNativeDriver('export class ManualDriver { count(value: 1): number { return value; } }');
    await project.rememberFiles(); await project.generate({ domain: 'counts' });
    project.expectMappingProblem('incompatible-driver'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('accepts a native union whose alternatives prove the selected source result', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { observation selected() returns Number | Text\nexample "one": selected() => 1 }');
    await project.connectNativeDriver('export class ManualDriver { selected(): number | string { return 1; } }');
    await project.generate({ domain: 'choices' }); project.expectWriteStatus('applied');
    await project.runGeneratedVitest(); project.expectTestsPassed(['one']);
  }, 60_000);
  it('accepts a wider native parameter for the declared literal input', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { observation count(value: 1) returns Number\nexample "one": count(1) => 1 }');
    await project.connectNativeDriver('export class ManualDriver { count(value: number): number { return value; } }');
    await project.generate({ domain: 'counts' }); project.expectWriteStatus('applied');
    await project.runGeneratedVitest(); project.expectTestsPassed(['one']);
  }, 60_000);
  it('does not treat any in a required result field as a proved record contract', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('type Book { copies: Number }\nexamples { observation book() returns Book\nexample "one copy": book() => Book { copies: 1 } }');
    await project.connectNativeDriver('export interface Book { copies: number }\nexport class ManualDriver { book(): { copies: any } { return { copies: 1 }; } }', ['Book']);
    await project.rememberFiles(); await project.generate({ domain: 'books' });
    project.expectMappingProblem('incompatible-driver'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not inspect an unrelated handwritten method to prove the selected payload', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('type Book { copies: Number }\nexamples { observation book() returns Book\nexample "one copy": book() => Book { copies: 1 } }');
    await project.connectNativeDriver('export interface Book { copies: number }\nexport class ManualDriver { book(): Book { return { copies: 1 }; } debug(): any { return undefined; } }', ['Book']);
    await project.generate({ domain: 'books' }); project.expectWriteStatus('applied');
    await project.runGeneratedVitest(); project.expectTestsPassed(['one copy']);
  }, 60_000);
  it('does not treat an any application result as a proved mapped result', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function count() returns Number\nexamples { example "one": count() => 1 }');
    await project.mapApplicationFunction('count', 'count.ts', 'count');
    await project.file('count.ts', 'export function count(): any { return 1; }');
    await project.rememberFiles(); await project.generate({ domain: 'counts' });
    project.expectMappingProblem('incompatible-application'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not treat an any fixture method as the promised typed check', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract(); await project.establishHandwrittenFixtureProject();
    await project.file('test/dsl/existing-test.ts', `import { test as base } from 'vitest';
      import { Shopping } from './shopping.js'; import { BasketDriver } from '../driver/basket.js';
      export const test = base.extend('shopping', () => Object.assign(new Shopping(new BasketDriver()), { expectBookQuantity: (() => {}) as any }));`);
    await project.rememberFiles(); await project.generate({ domain: 'shopping', adoptExisting: true, fixture: {
      outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/dsl/existing-test.ts', declaration: [{ kind: 'variable', name: 'test' }] },
    } });
    project.expectMappingProblem('incompatible-fixture'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not treat an any result as a proved native observation type', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract(); await project.connectRealBasketDriver();
    await project.file('test/driver/basket.ts', `export class BasketDriver {
      bookIsAvailable(title: string): void {}
      startWithEmptyBasket(): void {}
      addBook(title: string): void {}
      bookQuantity(title: string): any { return 'many'; }
    }`);
    await project.rememberFiles(); await project.generate({ domain: 'shopping' });
    project.expectMappingProblem('incompatible-driver'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not treat an any fixture domain as the proved DSL context', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract(); await project.establishHandwrittenFixtureProject();
    await project.file('test/dsl/existing-test.ts', `import { test as base } from 'vitest';
      export const test = base.extend('shopping', (): any => ({}));`);
    await project.rememberFiles(); await project.generate({ domain: 'shopping', adoptExisting: true, fixture: {
      outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: 'test/dsl/existing-test.ts', declaration: [{ kind: 'variable', name: 'test' }] },
    } });
    project.expectMappingProblem('incompatible-fixture'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('checks native compatibility even when the project disables its semantic diagnostics', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract(); await project.connectRealBasketDriver();
    await project.file('test/driver/basket.ts', `export class BasketDriver {
      bookIsAvailable(title: string): void {}
      startWithEmptyBasket(): void {}
      addBook(title: string): void {}
      bookQuantity(title: string): string { return 'many'; }
    }`);
    await project.disableNativeChecking(); await project.rememberFiles(); await project.generate({ domain: 'shopping' });
    project.expectMappingProblem('incompatible-driver'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('updates the authored assertion when the same check is renamed', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    project.renameCheck('expectBookQuantity', 'expectCopies', 'actual == expected + 1');
    await project.update(); project.expectWriteStatus('applied');
    await project.expectAcceptanceCall('shopping.expectCopies("Dune", 1)');
    await project.runGeneratedVitest(); project.expectAssertionFailure({ expected: 2, actual: 1 });
  }, 60_000);
  it('retains competing handwritten check work during a combined rename and assertion update', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.addHandwrittenCheckLogic('expectBookQuantity', 'console.log("keep reasoning");');
    project.renameCheck('expectBookQuantity', 'expectCopies', 'actual == expected + 1');
    await project.rememberFiles(); await project.update(); project.expectMappingProblem('handwritten-check-conflict');
    await project.expectAllBytesUnchanged();
  }, 60_000);
});
