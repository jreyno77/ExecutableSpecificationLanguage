import { afterEach, describe, it } from 'vitest';
import { WorkspaceExamples, WorkspaceProject } from '../../dsl/compiler/workspace-compilation.js';

afterEach(() => WorkspaceProject.dispose());

describe('independently scoped workspace entries', { timeout: 30_000 }, () => {
it('checks two independently scoped entry contracts in one consumer view', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'function start() returns Text');
  workspace.entry('checkout', 'function total() returns Number');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectCallableResult('game', 'start', 'Text');
  workspace.expectCallableResult('checkout', 'total', 'Number');
  workspace.expectRepresentative('checkout');
  workspace.expectBuiltinCount('Text', 1);
});

it('uses one shared imported declaration and original handle in both entries', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Book from "catalog"\nfunction save(book: Book) returns Nothing');
  workspace.entry('checkout', 'use Book from "catalog"\nfunction price(book: Book) returns Number');
  workspace.module('catalog', 'type Book { title: Text }');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectDeclarationCount('catalog', 'Book', 1);
  workspace.expectOriginalDeclarationIdentity('catalog', 'Book');
  workspace.expectSameParameterType('game', 'save', 'book', 'checkout', 'price', 'book');
  workspace.expectParameterType('game', 'save', 'book', 'catalog', 'Book');
});

it('does not import an entry merely because it was selected for compilation', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'type Snapshot { title: Text }');
  workspace.entry('checkout', 'function save(snapshot: Snapshot) returns Nothing');

  workspace.compile();

  workspace.expectProblem('unresolved-reference', 'checkout', 'Snapshot', { line: 1 });
  workspace.expectNoSpecification();
});

it('lets an explicit import reach another selected root without duplicating its input', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'type Snapshot { title: Text }');
  workspace.entry('checkout', 'use Snapshot from "game"\nfunction save(snapshot: Snapshot) returns Nothing');
  workspace.supplyOnlySelectedRoots();

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectParameterType('checkout', 'save', 'snapshot', 'game', 'Snapshot');
});

it('keeps private members private across selected entries', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game { local type Snapshot { title: Text } }');
  workspace.entry('checkout', 'use Game from "game"\nfunction save(snapshot: Game.Snapshot) returns Nothing');

  workspace.compile();

  workspace.expectProblem('inaccessible-reference', 'checkout', 'Game.Snapshot', { line: 2 });
  workspace.expectNoSpecification();
});

it('keeps equal declaration names in separate modules distinct', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'type Book { title: Text }\nfunction save(book: Book) returns Nothing');
  workspace.entry('shop', 'type Book { price: Number }\nfunction buy(book: Book) returns Nothing');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectDifferentDeclarations('game', 'Book', 'shop', 'Book');
  workspace.expectFieldTypes('game', 'Book', ['title: Text']);
  workspace.expectFieldTypes('shop', 'Book', ['price: Number']);
});

it('resolves the same relative spelling from the actual declaring module', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('left/game', 'use Item from "./types.expec"\nfunction save(item: Item) returns Nothing');
  workspace.entry('right/shop', 'use Item from "./types.expec"\nfunction buy(item: Item) returns Nothing');
  workspace.module('left/types', 'type Item { title: Text }');
  workspace.module('right/types', 'type Item { price: Number }');
  workspace.mapsModule('left/game', './types.expec', 'left/types');
  workspace.mapsModule('right/shop', './types.expec', 'right/types');

  workspace.compile();

  workspace.expectParameterType('left/game', 'save', 'item', 'left/types', 'Item');
  workspace.expectParameterType('right/shop', 'buy', 'item', 'right/types', 'Item');
  workspace.expectCompiled();
});

it('retains one included declaration across two selected roots', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'include "shared"\nfunction save(book: Book) returns Nothing');
  workspace.entry('checkout', 'include "shared"\nfunction price(book: Book) returns Number');
  workspace.module('shared', 'type Book { title: Text }');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectDeclarationCount('shared', 'Book', 1);
  workspace.expectOriginalDeclarationIdentity('shared', 'Book');
  workspace.expectSameParameterType('game', 'save', 'book', 'checkout', 'price', 'book');
});

it('does not repair an included module with a declaration from another selected root', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'include "shared"');
  workspace.entry('checkout', 'type Missing {}');
  workspace.module('shared', 'type Book { item: Missing }');

  workspace.compile();

  workspace.expectProblem('unresolved-reference', 'shared', 'Missing', { line: 1 });
  workspace.expectNoSpecification();
});

it('composes distinct contributions into one effective owner with real origins', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Store from "shared"\nextend Store { capability save() returns Nothing }');
  workspace.entry('checkout', 'use Store from "shared"\nextend Store { capability total() returns Number }');
  workspace.module('shared', 'concept Store {}');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectDeclarationCount('shared', 'Store', 1);
  workspace.expectCapabilities('shared', 'Store', ['total', 'save']);
  workspace.expectMemberOrigin('shared', 'Store.total', 'checkout', 'capability total()', 2);
  workspace.expectMemberOrigin('shared', 'Store.save', 'game', 'capability save()', 2);
});

it('rejects conflicting shared contributions instead of selecting one entry result', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Store from "shared"\nextend Store { capability save() returns Nothing }');
  workspace.entry('checkout', 'use Store from "shared"\nextend Store { capability save() returns Number }');
  workspace.module('shared', 'concept Store {}');

  workspace.compile();

  workspace.expectProblem('duplicate-declaration', 'game', 'capability save()', { line: 2 });
  workspace.expectRelatedSource('checkout', 'capability save()', { line: 2 });
  workspace.expectNoSpecification();
});

it('rejects two entry subjects claiming the same attached examples', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game {}\nexamples for Game from "numbers"');
  workspace.entry('checkout', 'concept Checkout {}\nexamples for Checkout from "numbers"');
  workspace.module('numbers', 'examples { example "number": 1 => 1 }');

  workspace.compile();

  workspace.expectProblem('conflicting-example-subject', 'game', 'Game', { line: 2 });
  workspace.expectRelatedSource('checkout', 'Checkout', { line: 2 });
  workspace.expectNoSpecification();
});

it('keeps valid declaration-import cycles across roots', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('a', 'use B from "b"\ntype A { other: B? }');
  workspace.entry('b', 'use A from "a"\ntype B { other: A? }');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectDeclarationCount('a', 'A', 1);
  workspace.expectDeclarationCount('b', 'B', 1);
  workspace.expectNoProblem('include-cycle');
});

it('reports an include cycle reached from multiple roots only at its real directives', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('a', 'include "b"');
  workspace.entry('b', 'include "a"');

  workspace.compile();

  workspace.expectProblem('include-cycle', 'b', 'include "a"', { line: 1 });
  workspace.expectRelatedSource('a', 'include "b"', { line: 1 });
  workspace.expectProblemCount('include-cycle', 1);
  workspace.expectNoSpecification();
});

it('retains independent failures from each entry and returns no partial success', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game { public saveGame\ncapability save() returns Nothing }');
  workspace.entry('checkout', 'type Price { amount: Number = "many" }');

  workspace.compile();

  workspace.expectProblem('unresolved-reference', 'game', 'saveGame', { line: 1 });
  workspace.expectProblem('incompatible-type', 'checkout', '"many"', { line: 1 });
  workspace.expectNoSpecification();
});

it('does not analyze unrelated supplied modules just because the inventory is shared', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game {}');
  workspace.entry('checkout', 'concept Checkout {}');
  workspace.module('unused', 'function broken(item: Missing) returns Nothing');

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectNotAnalyzed('unused', 'broken');
  workspace.expectNoProblem('unresolved-reference');
});

it('rejects separately captured copies claiming one locator instead of guessing identity', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Book from "catalog"');
  workspace.entry('checkout', 'use Book from "catalog"');
  workspace.dependencyFor('game', 'catalog', 'type Book { title: Text }', { sourceId: 'catalog-a' });
  workspace.dependencyFor('checkout', 'catalog', 'type Book { title: Text }', { sourceId: 'catalog-b' });

  workspace.compile();

  workspace.expectDependencyProblem('invalid-dependency-input', ['entries', 1, 'dependencies', 'modules', 0, 'locator']);
  workspace.expectRelatedDependency(['entries', 0, 'dependencies', 'modules', 0, 'locator']);
  workspace.expectNoSpecification();
});

it('does not allow one authored source identity to describe different modules', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game {}', { sourceId: 'same-document' });
  workspace.entry('checkout', 'concept Checkout {}', { sourceId: 'same-document' });
  workspace.supplyOnlySelectedRoots();

  workspace.compile();

  workspace.expectDependencyProblem('invalid-dependency-input', ['entries', 1, 'entry', 'locator']);
  workspace.expectRelatedDependency(['entries', 0, 'entry', 'locator']);
  workspace.expectNoSpecification();
});

it('accepts the same package facts in different authored orders', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game { requires package "vite" for build }');
  workspace.entry('checkout', 'concept Checkout { requires package "vite" for test }');
  workspace.packagesFor('game', [{ alias: 'vite', phases: ['build', 'test'] }]);
  workspace.packagesFor('checkout', [{ alias: 'vite', phases: ['test', 'build'] }]);

  workspace.compile();

  workspace.expectCompiled();
  workspace.expectNoProblem('invalid-dependency-input');
});

it('refuses conflicting package prerequisites instead of widening their phases', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game { requires package "vite" for build }');
  workspace.entry('checkout', 'concept Checkout { requires package "vite" for runtime }');
  workspace.packagesFor('game', [{ alias: 'vite', phases: ['build'] }]);
  workspace.packagesFor('checkout', [{ alias: 'vite', phases: ['runtime'] }]);

  workspace.compile();

  workspace.expectDependencyProblem('invalid-dependency-input', ['entries', 1, 'dependencies', 'packages', 0, 'phases']);
  workspace.expectRelatedDependency(['entries', 0, 'dependencies', 'packages', 0, 'phases']);
  workspace.expectNoSpecification();
});

it('retains durable identities and context when entry order changes', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Book from "catalog"\nconcept Game {}');
  workspace.entry('checkout', 'use Book from "catalog"\nconcept Checkout {}');
  workspace.module('catalog', 'type Book { title: Text }');
  workspace.compile();
  workspace.identify();
  workspace.rememberIdentity('before');

  workspace.selectEntries(['checkout', 'game']);
  workspace.compile();
  workspace.identifyFrom('before');

  workspace.expectRepresentative('checkout');
  workspace.expectIdentityUnchanged('before');
  workspace.expectDiff({ changes: [], contextChanged: false });
});

it('retains identities across a complete fresh read with different opaque handles', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'type Snapshot { title: Text }');
  workspace.entry('checkout', 'function total() returns Number');
  workspace.compile();
  workspace.identify();
  workspace.rememberIdentity('before');

  workspace.reload();
  workspace.compile();
  workspace.identifyFrom('before');

  workspace.expectNewCapturedHandles('before');
  workspace.expectIdentityUnchanged('before');
  workspace.expectDiff({ changes: [], contextChanged: false });
});

it('keeps a deselected root reachable through a remaining explicit import', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Book from "catalog"\nconcept Game {}');
  workspace.entry('catalog', 'type Book { title: Text }');
  workspace.compile();
  workspace.identify();
  workspace.rememberIdentity('before');

  workspace.selectEntries(['game']);
  workspace.compile();
  workspace.identifyFrom('before');

  workspace.expectCompiled();
  workspace.expectPersistentIdentity('catalog', 'Book', 'before');
  workspace.expectRetiredIdentifiers([]);
  workspace.expectRepresentative('game');
  workspace.expectContextChanged();
});

it('requires explicit retirement only for contracts no longer reached from any root', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Book from "catalog"\nconcept Game {}');
  workspace.entry('shop', 'use Book from "catalog"\nconcept Shop {}');
  workspace.module('catalog', 'type Book { title: Text }');
  workspace.compile();
  workspace.identify();
  workspace.rememberIdentity('before');

  workspace.selectEntries(['game']);
  workspace.compile();
  workspace.identifyFrom('before');
  workspace.expectIdentityProblem('identity-correspondence');
  workspace.retirePriorSubject('before', 'shop', 'Shop');
  workspace.identifyFrom('before');

  workspace.expectPersistentIdentity('game', 'Game', 'before');
  workspace.expectPersistentIdentity('catalog', 'Book', 'before');
  workspace.expectRetiredSubjects('before', ['shop:Shop']);
  workspace.expectRemovedSubjects(['shop:Shop']);
});

it('preserves the existing one-entry contract and persisted baseline', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'use Book from "catalog"\nfunction save(book: Book) returns Nothing');
  workspace.module('catalog', 'type Book { title: Text }');
  workspace.compileWithExistingSingleEntryCall();
  workspace.identify();
  workspace.rememberIdentity('existing');

  workspace.compile();
  workspace.identifyFrom('existing');

  workspace.expectIdentityUnchanged('existing');
  workspace.expectDiff({ changes: [], contextChanged: false });
  workspace.expectRepresentative('game');
  workspace.expectParameterType('game', 'save', 'book', 'catalog', 'Book');
});

it('does not modify input models or an earlier composed result', () => {
  const workspace = new WorkspaceExamples();
  workspace.entry('game', 'concept Game {}');
  workspace.entry('shop', 'concept Shop {}');
  workspace.rememberSuppliedModels();
  workspace.compile();
  workspace.rememberResult('both');

  workspace.selectEntries(['game']);
  workspace.compile();

  workspace.expectSuppliedModelsUnchanged();
  workspace.expectRememberedDeclarations('both', ['game:Game', 'shop:Shop']);
  workspace.expectCurrentDeclarations(['game:Game']);
});

it('loads two real manifest entries and emits their shared contract only once', async () => {
  const project = await WorkspaceProject.connect({ entries: ['game.expec', 'checkout.expec'] });
  await project.writeSource('game.expec', 'use Book from "./catalog.expec"\nfunction save(book: Book) returns Nothing');
  await project.writeSource('checkout.expec', 'use Book from "./catalog.expec"\nfunction price(book: Book) returns Number');
  await project.writeSource('catalog.expec', 'type Book { title: Text }');

  await project.loadAndCompile();
  await project.createTypeScript({ directory: 'src' });

  project.expectGeneratedFiles(['src/Book.ts', 'src/price.ts', 'src/save.ts']);
  project.expectArtifactCount('catalog.expec', 'Book', 1);
  await project.checkNativeConsumer(`import type { Book } from './src/Book.js';
import { save } from './src/save.js';
import { price } from './src/price.js';
const book: Book = { title: 'Dune' };
save(book);
const amount: number = price(book);`);
  project.expectNativeCheckPassed();
});

it('refuses colliding output placement for distinct same-named workspace contracts', async () => {
  const project = await WorkspaceProject.connect({ entries: ['game.expec', 'shop.expec'] });
  await project.writeSource('game.expec', 'type Book { title: Text }');
  await project.writeSource('shop.expec', 'type Book { price: Number }');
  await project.loadAndCompile();

  await project.createTypeScript({ directory: 'src' });

  project.expectOutputProblem('native-name-conflict');
  await project.expectProjectUnchanged();
});

it('uses explicit module-qualified names to place distinct contracts without merging them', async () => {
  const project = await WorkspaceProject.connect({ entries: ['game.expec', 'shop.expec'] });
  await project.writeSource('game.expec', 'type Book { title: Text }');
  await project.writeSource('shop.expec', 'type Book { price: Number }');
  await project.loadAndCompile();

  await project.createTypeScript({ directory: 'src', names: [
    { module: project.module('game.expec'), declaration: ['Book'], name: 'GameBook' },
    { module: project.module('shop.expec'), declaration: ['Book'], name: 'ShopBook' }
  ] });

  project.expectGeneratedFiles(['src/GameBook.ts', 'src/ShopBook.ts']);
  project.expectNativeFields('src/GameBook.ts', 'GameBook', ['title: string']);
  project.expectNativeFields('src/ShopBook.ts', 'ShopBook', ['price: number']);
  await project.checkNativeTypes();
  project.expectNativeCheckPassed();
});

it('keeps source-backed library declarations outside the captured workspace output scope', async () => {
  const project = await WorkspaceProject.connect({ entries: ['game.expec', 'shop.expec'] });
  await project.writeSource('game.expec', 'use Book from "books"\nfunction save(book: Book) returns Nothing');
  await project.writeSource('shop.expec', 'use Book from "books"\nfunction price(book: Book) returns Number');
  project.provideSourceLibrary('books', 'type Book { title: Text }');
  await project.writeNativeFile('native/books.ts', 'export interface Book { title: string }');
  await project.loadAndCompile();

  await project.createTypeScript({ directory: 'src', imports: [
    { module: 'books', declaration: ['Book'], name: 'Book', from: '../native/books.js' }
  ] });

  project.expectGeneratedFiles(['src/price.ts', 'src/save.ts']);
  await project.expectFileAbsent('src/Book.ts');
  await project.expectNativeFileUnchanged('native/books.ts');
  await project.checkNativeTypes();
  project.expectNativeCheckPassed();
});

it('leaves the actual output plan and files unchanged when entries are reordered', async () => {
  const project = await WorkspaceProject.connect({ entries: ['game.expec', 'shop.expec'] });
  await project.writeSource('game.expec', 'concept Game {}');
  await project.writeSource('shop.expec', 'concept Shop {}');
  await project.loadAndCompile();
  await project.createTypeScript({ directory: 'src' });
  await project.rememberProject('generated');
  project.rememberIdentity('before');

  await project.configureEntries(['shop.expec', 'game.expec']);
  await project.loadAndCompileFrom('before');
  await project.planTypeScriptUpdate({ directory: 'src' });

  project.expectPlannedChanges([]);
  project.expectSameArtifactAssociations('before');
  await project.applyPlannedOutput();
  project.expectWriteStatus('unchanged');
  await project.expectProjectEquals('generated');
});
});
