import { afterEach, describe, it } from 'vitest';
import { TypeScriptExamples } from '../dsl/typescript-output.js';

afterEach(() => TypeScriptExamples.dispose());

describe('native contracts remain recognizable', { timeout: 30_000 }, () => {
  it('gives StoreGame real types and an explicit unimplemented save', async () => {
    const project = await TypeScriptExamples.connect();
    project.source(`type Pair<T> = [T, T]
type ShoppingCart { itemsCount: Number }
type PlayerStateSnapshot {
  characterPosition: Pair<Number>
  shoppingCart: ShoppingCart
}
class StoreGame {
  depends on PlayerStateSnapshot
  public save
  capability save(snapshot: PlayerStateSnapshot) returns Nothing {
    promises "Save the snapshot to disk."
  }
}`);
    await project.create({ directory: 'src' });

    project.expectNativeAlias('Pair', ['T'], '[T, T]');
    project.expectNativeFields('PlayerStateSnapshot', ['characterPosition: Pair<number>', 'shoppingCart: ShoppingCart']);
    project.expectNativeMethod('StoreGame.save', ['snapshot: PlayerStateSnapshot'], 'void');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
    await project.runConsumer(`import { StoreGame } from './src/StoreGame.js';
new StoreGame().save({ characterPosition: [0, 0], shoppingCart: { itemsCount: 0 } });`);
    project.expectThrownError('Not implemented: StoreGame.save');
    project.expectNoGeneratedTestFiles();
    project.expectNoGeneratedPersistence();
  });

  it('preserves literal, union, tuple, list and optional type contracts', async () => {
    const project = await TypeScriptExamples.connect();
    project.source(`type Pair<T> = [T, T]
type Settings {
  os: "windows" | "linux"
  enabled: true
  position: Pair<Number>
  titles: List<Text>
  note: Text?
}`);
    await project.create({ directory: 'src' });
    await project.checkConsumer(`import type { Settings } from './src/Settings.js';
const settings: Settings = { os: 'windows', enabled: true, position: [0, 1], titles: ['Dune'] };
settings.titles.push('Foundation');`);
    project.expectNativeCheckPassed();
    project.expectNativeFields('Settings', ['os: "windows" | "linux"', 'enabled: true', 'position: Pair<number>', 'titles: Array<string>', 'note?: string | undefined']);
  });

  it('lets the native compiler reject a wrong tuple and literal', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Settings { os: "windows"\nposition: [Number, Number] }');
    await project.create({ directory: 'src' });
    await project.checkConsumer(`import type { Settings } from './src/Settings.js';
const settings: Settings = { os: 'other', position: [0] };`);
    project.expectNativeTypeErrorAt('os', 'typescript-2322');
    project.expectNativeTypeErrorAt('position', 'typescript-2322');
  });

  it('offers a deliberate interface policy without changing explicit declarations', async () => {
    const project = await TypeScriptExamples.connect();
    project.source(`concept StoreGame {
  public save
  capability save() returns Nothing
}
class Engine {}
interface Storage { capability load() returns Text }`);
    await project.create({ directory: 'src', concepts: 'interface' });
    project.expectNativeDeclaration('StoreGame', 'interface');
    project.expectNativeDeclaration('Engine', 'class');
    project.expectNativeDeclaration('Storage', 'interface');
    await project.checkConsumer(`import type { StoreGame } from './src/StoreGame.js';
const game: StoreGame = { save() {} };`);
    project.expectNativeCheckPassed();
    project.expectNoInventedImplementationClass('StoreGame');
  });

  it('represents interface construction separately from the instance', async () => {
    const project = await TypeScriptExamples.connect();
    project.source(`interface StoreGame {
  construction(title: Text)
  public save
  capability save() returns Nothing
}`);
    await project.create({ directory: 'src' });
    project.expectNativeConstructSignature('StoreGameConstructor', ['title: string'], 'StoreGame');
    project.expectNoInstanceConstructSignature('StoreGame');
    await project.checkConsumer(`import type { StoreGame, StoreGameConstructor } from './src/StoreGame.js';
class Game implements StoreGame { constructor(readonly title: string) {} save() {} }
const factory: StoreGameConstructor = Game;
const game: StoreGame = new factory('Store Game');`);
    project.expectNativeCheckPassed();
  });

  it('makes authored construction visibly unimplemented', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame { construction(title: Text) }');
    await project.create({ directory: 'src' });
    project.expectNativeConstructor('StoreGame', ['title: string']);
    await project.runConsumer(`import { StoreGame } from './src/StoreGame.js';
new StoreGame('Store Game');`);
    project.expectThrownError('Not implemented: StoreGame.construction');
  });

  it('keeps internal capabilities private and local types inside their owner file', async () => {
    const project = await TypeScriptExamples.connect();
    project.source(`class StoreGame {
  local type Cache { title: Text }
  public save
  capability save() returns Nothing
  capability cache(value: Cache) returns Nothing
}`);
    await project.create({ directory: 'src' });
    project.expectPrivateMethod('StoreGame.cache', ['value: StoreGame_Cache']);
    project.expectUnexportedTypeInFile('StoreGame_Cache', 'src/StoreGame.ts');
    await project.checkConsumer(`import { StoreGame } from './src/StoreGame.js';
new StoreGame().cache({ title: 'Dune' });`);
    project.expectNativeTypeErrorAt('cache');
  });

  it('keeps an unspecified result distinct from Nothing', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('function load()\nfunction shutDown() returns Nothing');
    await project.create({ directory: 'src' });
    project.expectNativeFunction('load', [], 'unknown');
    project.expectNativeFunction('shutDown', [], 'void');
    project.expectDocumentation('load', 'Result unspecified in .expec; unknown is a scaffold placeholder.');
    project.expectSourceResultStillUnspecified('load');
    await project.checkConsumer(`import { load } from './src/load.js';
const title: string = load();`);
    project.expectNativeTypeErrorAt('title');
  });
});

describe('workspace input and native imports have explicit boundaries', { timeout: 30_000 }, () => {
  it('generates relative workspace uses and includes without generating a provider library', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('storage-lib', 'interface Storage { capability save() returns Nothing }');
    await project.workspace({
      'main.expec': `use Snapshot from "./player-state.expec"
use Storage from "storage-lib"
include "./settings.expec"
class StoreGame {
  depends on Snapshot, Storage, Settings
  public save
  capability save(snapshot: Snapshot) returns Nothing
}`,
      'player-state.expec': 'type Snapshot { title: Text }',
      'settings.expec': 'type Settings { brightness: Number }',
    });
    await project.create({ directory: 'src', imports: [
      { module: 'storage-lib', declaration: ['Storage'], name: 'Storage', from: 'storage-sdk' },
    ] });
    project.expectGeneratedFiles(['src/StoreGame.ts', 'src/Snapshot.ts', 'src/Settings.ts']);
    project.expectNoGeneratedFile('src/Storage.ts');
    project.expectNativeImport('StoreGame', 'Storage', 'storage-sdk');
    project.expectNoSourceProviderFilesChanged();
  });

  it('defaults a direct caller to entry-only generation', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('library', 'type Book { title: Text }');
    project.source('use Book from "library"\nfunction save(book: Book) returns Nothing');
    await project.create({ directory: 'src', imports: [
      { module: 'library', declaration: ['Book'], name: 'Book', from: 'books' },
    ] });
    project.expectGeneratedFiles(['src/save.ts']);
    project.expectNativeImport('save', 'Book', 'books');
  });

  it('keeps equal provider export names distinct through explicit local aliases', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('catalog-a', 'type Book { title: Text }');
    project.library('catalog-b', 'type Book { copies: Number }');
    project.source('use Book as First from "catalog-a"\nuse Book as Second from "catalog-b"\nfunction compare(first: First, second: Second) returns Nothing');
    await project.file('native/a.ts', 'export type Book = { title: string };');
    await project.file('native/b.ts', 'export type Book = { copies: number };');
    await project.create({ directory: 'src', imports: [
      { module: 'catalog-a', declaration: ['Book'], name: 'Book', from: '../native/a.js', as: 'FirstBook' },
      { module: 'catalog-b', declaration: ['Book'], name: 'Book', from: '../native/b.js', as: 'SecondBook' },
    ] });
    project.expectNativeImportAlias('compare', 'Book', 'FirstBook', '../native/a.js');
    project.expectNativeImportAlias('compare', 'Book', 'SecondBook', '../native/b.js');
    project.expectNativeFunction('compare', ['first: FirstBook', 'second: SecondBook'], 'void');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('refuses colliding local imports when no alias was specified', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('catalog-a', 'type Book { title: Text }');
    project.library('catalog-b', 'type Book { copies: Number }');
    project.source('use Book as First from "catalog-a"\nuse Book as Second from "catalog-b"\nfunction compare(first: First, second: Second) returns Nothing');
    await project.create({ directory: 'src', imports: [
      { module: 'catalog-a', declaration: ['Book'], name: 'Book', from: 'catalog-a' },
      { module: 'catalog-b', declaration: ['Book'], name: 'Book', from: 'catalog-b' },
    ] });
    project.expectNativeNameConflict('Book');
    await project.expectNoWrites();
  });

  it('does not acquire a provider parent by extending it from a workspace file', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('storage-lib', 'interface Storage {}');
    await project.workspace({ 'main.expec': 'use Storage from "storage-lib"\nextend Storage { public save\ncapability save() returns Nothing }' });
    await project.create({ directory: 'src', imports: [
      { module: 'storage-lib', declaration: ['Storage'], name: 'Storage', from: 'storage-sdk' },
    ] });
    project.expectUnsupportedAugmentation('Storage.save');
    await project.expectNoWrites();
    project.expectNoSourceProviderFilesChanged();
  });

  it('refuses an imported declaration that would shadow the emitted list type', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Array { title: Text }\ntype Shelf { favorite: Array\nbooks: List<Text> }');
    await project.create({ directory: 'src' });
    project.expectNativeNameConflict('Array');
    await project.expectNoWrites();
    await project.create({ directory: 'src', names: [{ declaration: ['Array'], name: 'Book' }] });
    project.expectNativeFields('Shelf', ['favorite: Book', 'books: Array<string>']);
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('keeps a parameter from shadowing the native unimplemented exception', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('function save(Error: Text) returns Nothing');
    await project.create({ directory: 'src' });
    project.expectNativeNameConflict('Error');
    await project.expectNoWrites();
    await project.create({ directory: 'src', names: [{ declaration: ['save', 'Error'], name: 'detail' }] });
    await project.runConsumer("import { save } from './src/save.js'; save('Dune');");
    project.expectThrownError('Not implemented: save');
  });

  it('captures workspace membership per opened output', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('library', 'type Book { title: Text }');
    project.source('use Book from "library"\nfunction save(book: Book) returns Nothing');
    const context = { workspaceModules: ['library'] };
    project.open({ directory: 'src' }, context);
    context.workspaceModules.length = 0;
    await project.createOpened();
    project.expectGeneratedFiles(['src/save.ts', 'src/Book.ts']);
    project.expectCallerContext({ workspaceModules: [] });
    project.expectCheckedSpecificationUnchanged();
  });

  it('does not generate captured modules absent from the checked entry', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    project.open({ directory: 'src' }, { workspaceModules: ['unrelated'] });
    await project.createOpened();
    project.expectGeneratedFiles(['src/StoreGame.ts']);
  });

  it('rejects malformed shared context before an adapter is opened', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    await project.openWithInvalidContext({ workspaceModules: ['main', 'main'] });
    project.expectProblem('invalid-output-context');
    project.expectAdapterNotOpened();
    await project.expectNoWrites();
  });

  it('requires a deliberate native meaning for an opaque type', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('opaque type URL\ntype SystemConfig { gameroot: URL }');
    await project.create({ directory: 'src' });
    project.expectMissingNativeMapping('URL');
    await project.expectNoWrites();
    await project.create({ directory: 'src', imports: [
      { module: 'main', declaration: ['URL'], name: 'URL' },
    ] });
    project.expectGeneratedFiles(['src/SystemConfig.ts']);
    await project.checkConsumer(`import type { SystemConfig } from './src/SystemConfig.js';
const configuration: SystemConfig = { gameroot: new URL('https://example.com/game') };`);
    project.expectNativeCheckPassed();
  });

  it('refuses provider-owned members under an otherwise owned class', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('library', 'use Game from "main"\nextend Game { public save\ncapability save() returns Nothing\nlocal type Cache { value: Text } }');
    project.source('include "library"\nclass Game {}');
    await project.create({ directory: 'src' });
    project.expectUnsupportedAugmentation('Game.save');
    project.expectUnsupportedAugmentation('Game.Cache');
    await project.expectNoWrites();
  });

  it('emits an extension when its source belongs to the captured workspace', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('library', 'use Game from "main"\nextend Game { public save\ncapability save() returns Nothing\nlocal type Cache { value: Text } }');
    project.source('include "library"\nclass Game {}');
    project.open({ directory: 'src' }, { workspaceModules: ['library'] });
    await project.createOpened();
    project.expectNativeMethod('Game.save', [], 'void');
    project.expectUnexportedTypeInFile('Game_Cache', 'src/Game.ts');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });
  it('keeps attached provider test declarations outside native ownership checks', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('examples', 'examples { observation quantity(title: Text) returns Number }');
    project.source('examples for Game from "examples"\nclass Game {}');
    await project.create({ directory: 'src' });
    project.expectWriteStatus('applied');
    project.expectGeneratedFiles(['src/Game.ts']);
    project.expectNoNativeDeclaration('quantity');
  });
  it('refuses a workspace local type contributed beneath a provider parent', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('library', 'interface Storage {}');
    project.source('use Storage from "library"\nextend Storage { local type Cache = Text }');
    await project.create({ directory: 'src' });
    project.expectUnsupportedAugmentation('Storage.Cache');
    await project.expectNoWrites();
  });

  it('makes human names explicit and refuses a guessed native spelling', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('concept `Store Game` { capability `save game`() returns Nothing }');
    await project.create({ directory: 'src' });
    project.expectInvalidNativeName('Store Game');
    await project.expectNoWrites();
    await project.create({ directory: 'src', names: [{ declaration: ['Store Game'], name: 'StoreGame' }] });
    project.expectNativeDeclaration('StoreGame', 'class');
    project.expectNativeMethod('StoreGame.save game', [], 'void');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('does not silently suffix colliding native names', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('concept `Store Game` {}\nclass StoreGame {}');
    await project.create({ directory: 'src', names: [{ declaration: ['Store Game'], name: 'StoreGame' }] });
    project.expectNativeNameConflict('StoreGame');
    await project.expectNoWrites();
  });

  it('documents required packages without installing or editing package configuration', async () => {
    const project = await TypeScriptExamples.connect();
    project.availablePackage('vite', 'build');
    project.source('concept StoreGame { requires package "vite" for build }');
    await project.file('package.json', '{"name":"my-game","private":true}\n');
    await project.create({ directory: 'src' });
    project.expectDocumentation('StoreGame', 'Requires package: vite (build)');
    await project.expectFile('package.json', '{"name":"my-game","private":true}\n');
    project.expectNoPackageInstall();
  });
});

describe('defaults, numbers and failures retain honest native meanings', { timeout: 30_000 }, () => {
  it('documents field defaults without pretending they materialize omitted data', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Book { copies: Number = 1\nnote: Text? }');
    await project.create({ directory: 'src' });
    project.expectDocumentation('Book.copies', '@default 1');
    await project.checkConsumer(`import type { Book } from './src/Book.js';
const missing: Book = {};`);
    project.expectNativeTypeErrorAt('missing');
    await project.checkConsumer(`import type { Book } from './src/Book.js';
const supplied: Book = { copies: 2 };`);
    project.expectNativeCheckPassed();
    project.expectNoGeneratedFactory('Book');
  });

  it('allows a defaulted input to be omitted without running its unfinished default', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('function startingCopies() returns Number\nfunction save(copies: Number = startingCopies()) returns Nothing');
    await project.create({ directory: 'src' });
    project.expectNativeFunction('save', ['copies?: number'], 'void');
    project.expectDocumentation('save.copies', '@default startingCopies()');
    await project.runConsumer(`import { save } from './src/save.js';
save();`);
    project.expectThrownError('Not implemented: save');
    project.expectNoNativeDefaultInitializer('save.copies');
  });

  it('retains ordinary decimal literals and documents binary64 arithmetic', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Tenth = 0.1\ntype One = 1e0');
    await project.create({ directory: 'src' });
    await project.checkConsumer(`import type { Tenth } from './src/Tenth.js';
import type { One } from './src/One.js';
const tenth: Tenth = 0.1;
const one: One = 1;`);
    project.expectNativeCheckPassed();
    project.expectDocumentedNumberProfile('JavaScript binary64');
  });

  it('refuses an integer literal that native Number would change', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Exact = 9007199254740993');
    await project.create({ directory: 'src' });
    project.expectUnsupportedNumberAt('9007199254740993');
    await project.expectNoWrites();
  });

  it('refuses a finite source literal that native Number would make infinite', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Exact = 1e309');
    await project.create({ directory: 'src' });
    project.expectUnsupportedNumberAt('1e309');
    await project.expectNoWrites();
  });

  it('refuses a nonzero source literal that native Number would erase', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Exact = 1e-400');
    await project.create({ directory: 'src' });
    project.expectUnsupportedNumberAt('1e-400');
    await project.expectNoWrites();
  });

  it('provides an error-data family and a usable exception without changing successful results', async () => {
    const project = await TypeScriptExamples.connect();
    project.source(`type Account { id: Text }
error type Rejected<T> {
  code: "duplicate-account" | "invalid-account"
  payload: T
  \`message\`: Text
}
function createAccount(email: Text) returns Account fails with Rejected<Text>`);
    await project.create({ directory: 'src' });
    project.expectNativeFunction('createAccount', ['email: string'], 'Account');
    project.expectDocumentation('createAccount', '@throws Rejected');
    await project.runConsumer(`import { RejectedError } from './src/Rejected.js';
try {
  throw new RejectedError({ code: 'duplicate-account', payload: 'reader@example.com', message: 'My payload message' });
} catch (error) {
  if (!(error instanceof RejectedError)) throw error;
  console.log(JSON.stringify({ code: error.details.code, payload: error.details.payload,
    payloadMessage: error.details.message, message: error.message, name: error.name }));
}`);
    project.expectPrintedJson({ code: 'duplicate-account', payload: 'reader@example.com',
      payloadMessage: 'My payload message', message: 'duplicate-account', name: 'RejectedError' });
    await project.search('Rejected');
    project.expectNativeDefinitions(['Rejected', 'RejectedError']);
  });

  it('reuses the original exception family through a transparent error alias', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('error type Rejected { code: "no" }\ntype SaveFailure = Rejected\nfunction save() returns Nothing fails with SaveFailure');
    await project.create({ directory: 'src' });
    project.expectNativeAlias('SaveFailure', [], 'Rejected');
    project.expectNoNativeDeclaration('SaveFailureError');
    project.expectDocumentation('save', 'RejectedError');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('refuses an exception companion that would hide an authored declaration', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('error type Rejected { code: "no" }\nclass RejectedError {}');
    await project.create({ directory: 'src' });
    project.expectNativeNameConflict('RejectedError');
    await project.expectNoWrites();
  });

  it('documents an external error family without inventing an exception companion', async () => {
    const project = await TypeScriptExamples.connect();
    project.library('errors', 'error type Rejected { code: "no" }');
    project.source('use Rejected from "errors"\nfunction save() returns Nothing fails with Rejected');
    await project.create({ directory: 'src', imports: [
      { module: 'errors', declaration: ['Rejected'], name: 'NativeRejected', from: 'native-errors' },
    ] });
    project.expectDocumentation('save', '@throws Rejected (NativeRejected): implementation obligation.');
    project.expectNoNativeDeclaration('NativeRejectedError');
  });
});

it('retains only generated syntax as its future comparison baseline', async () => {
  const project = await TypeScriptExamples.connect();
  project.source('class StoreGame { capability save() returns Nothing }');
  await project.create({ directory: 'src' });
  await project.rememberGeneratedBaseline('src/StoreGame.ts');
  await project.append('src/StoreGame.ts', '\n// Private handwritten implementation note.\n');
  project.change('class StoreGame { capability save(title: Text) returns Nothing }');
  await project.update();
  project.expectWriteStatus('applied');
  project.expectNativeMethod('StoreGame.save', ['title: string'], 'void');
  project.expectGeneratedBaselineContains('src/StoreGame.ts', 'save(title: string): void');
  await project.read('StoreGame');
  project.expectWholeCurrentFile('src/StoreGame.ts', ['Private handwritten implementation note.']);
  project.expectBaselineExcludes('Private handwritten implementation note.');
});

it('refuses a tampered generated baseline before changing code', async () => {
  const project = await TypeScriptExamples.connect();
  project.source('class StoreGame {}');
  await project.create({ directory: 'src' });
  await project.tamperGeneratedBaseline('src/StoreGame.ts', 'export class Different {}');
  await project.rememberProject();
  await project.update();
  project.expectProblem('invalid-output-state');
  await project.expectProjectBytesUnchanged();
});

it('inserts an unrelated contract while retaining a handwritten owned file', async () => {
  const project = await TypeScriptExamples.connect();
  project.source('class StoreGame {}');
  await project.create({ directory: 'src' });
  await project.append('src/StoreGame.ts', '\n// Keep my implementation note.\n');
  await project.rememberFile('src/StoreGame.ts');
  project.change('class StoreGame {}\ntype Snapshot { title: Text }');
  await project.insert();
  project.expectWriteStatus('applied');
  project.expectGeneratedFile('src/Snapshot.ts');
  await project.expectRememberedFileUnchanged('src/StoreGame.ts');
});

describe('scaffold evolution is based on current native content and ownership', { timeout: 30_000 }, () => {
  it('reads the whole generated file and finds an unmodeled native launcher', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame { capability save() returns Nothing }');
    await project.create({ directory: 'src' });
    await project.append('src/StoreGame.ts', '\n// My implementation note.\n');
    await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js";\nnew StoreGame();');
    await project.read('StoreGame');
    project.expectWholeCurrentFile('src/StoreGame.ts', ['save()', 'My implementation note.']);
    await project.search('StoreGame');
    project.expectUnmodeledConsumer('launcher.ts', 'new StoreGame()');
  });

  it('rebuilds unchanged scaffolds without rewriting their files', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    await project.create({ directory: 'src' });
    await project.rememberProject();
    await project.create({ directory: 'src' });
    project.expectWriteStatus('unchanged');
    await project.expectProjectBytesUnchanged();
  });

  it('inserts a new root and keeps existing owned declarations byte-for-byte', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    await project.create({ directory: 'src' });
    await project.rememberFile('src/StoreGame.ts');
    project.change('class StoreGame {}\ntype Snapshot { title: Text }');
    await project.insert();
    project.expectWriteStatus('applied');
    project.expectGeneratedFile('src/Snapshot.ts');
    await project.expectRememberedFileUnchanged('src/StoreGame.ts');
  });

  it('requires update for a changed signature instead of treating it as insertion', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame { capability save() returns Nothing }');
    await project.create({ directory: 'src' });
    await project.rememberProject();
    project.change('class StoreGame { capability save(title: Text) returns Nothing }');
    await project.insert();
    project.expectProblem('not-addition-only');
    await project.expectProjectBytesUnchanged();
    await project.update();
    project.expectNativeMethod('StoreGame.save', ['title: string'], 'void');
  });

  it('renames an owned declaration and updates its owned imports using explicit identity', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('type Snapshot { title: Text }\nfunction save(snapshot: Snapshot) returns Nothing');
    await project.create({ directory: 'src' });
    project.change('type PlayerStateSnapshot { title: Text }\nfunction save(snapshot: PlayerStateSnapshot) returns Nothing',
      { rename: { Snapshot: 'PlayerStateSnapshot' } });
    await project.update();
    project.expectSameIdentity('Snapshot', 'PlayerStateSnapshot');
    project.expectNoGeneratedFile('src/Snapshot.ts');
    project.expectNativeImport('save', 'PlayerStateSnapshot', './PlayerStateSnapshot.js');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('renames the proven native uses in an unowned current caller', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    await project.create({ directory: 'src' });
    await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js"; new StoreGame();');
    await project.rememberProject();
    project.change('class Game {}', { rename: { StoreGame: 'Game' } });
    await project.update();
    project.expectWriteStatus('applied');
    await project.expectFile('launcher.ts', 'import { Game } from "./src/Game.js"; new Game();');
    project.expectNoGeneratedFile('src/StoreGame.ts');
    project.expectGeneratedFile('src/Game.ts');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('keeps a handwritten save implementation and private helpers when a new promise needs work', async () => {
    const project = await TypeScriptExamples.withStoreGameScaffold();
    await project.replaceSaveBody(`this.assertRunning();
localStorage.setItem("store-game-save", JSON.stringify(snapshot));`);
    await project.addPrivateMethod('assertRunning', 'if (!this.running) throw new Error("Not running");');
    await project.rememberProject();
    project.renameSaveAndPromise('saveGame', 'Save the snapshot to Supabase.');
    await project.update();
    project.expectWriteStatus('applied');
    project.expectNativeMethod('StoreGame.saveGame', ['snapshot: Snapshot'], 'void');
    project.expectMethodBody('StoreGame.saveGame', 'this.assertRunning();\nlocalStorage.setItem("store-game-save", JSON.stringify(snapshot));');
    project.expectMethodBody('StoreGame.assertRunning', 'if (!this.running) throw new Error("Not running");');
    project.expectDocumentation('StoreGame.saveGame', 'Save the snapshot to Supabase.');
    project.expectDocumentation('StoreGame.saveGame', 'Unverified implementation obligation.');
  });

  it('does not adopt a pre-existing file simply because it has the expected class name', async () => {
    const project = await TypeScriptExamples.connect();
    await project.file('src/StoreGame.ts', 'export class StoreGame { save() { return "handwritten"; } }');
    project.source('class StoreGame { capability save() returns Nothing }');
    await project.rememberProject();
    await project.create({ directory: 'src' });
    project.expectConflictAt('src/StoreGame.ts');
    await project.expectProjectBytesUnchanged();
  });

  it('catches up an output skipped between two valid specification changes', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    await project.create({ directory: 'src' });
    project.change('class StoreGame { capability save() returns Nothing }');
    project.rememberIdentityWithoutGenerating();
    project.change('class StoreGame { capability save(title: Text) returns Nothing }');
    await project.update();
    project.expectNativeMethod('StoreGame.save', ['title: string'], 'void');
    await project.update();
    project.expectWriteStatus('unchanged');
  });

  it('removes an unused owned root and makes a repeated deletion unchanged', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}\ntype Snapshot { title: Text }');
    await project.create({ directory: 'src' });
    await project.delete('Snapshot');
    project.expectWriteStatus('applied');
    project.expectNoGeneratedFile('src/Snapshot.ts');
    project.expectGeneratedFile('src/StoreGame.ts');
    await project.delete('Snapshot');
    project.expectWriteStatus('unchanged');
  });

  it('does not certify partial native search as permission to remove code', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    await project.create({ directory: 'src' });
    await project.file('load.ts', 'export const load = (name: string) => import(name);');
    await project.rememberProject();
    await project.delete('StoreGame');
    project.expectProblem('incomplete-output-search');
    await project.expectProjectBytesUnchanged();
  });

  it('does not confirm associations after a stopped state write or adopt files on retry', async () => {
    const project = await TypeScriptExamples.connect();
    project.source('class StoreGame {}');
    project.failActualOutputStateWrite();
    await project.create({ directory: 'src' });
    project.expectWriteStatus('stopped');
    project.expectNoConfirmedArtifacts();
    project.restoreWriter();
    await project.rememberProject();
    await project.create({ directory: 'src' });
    project.expectConflictAt('src/StoreGame.ts');
    await project.expectProjectBytesUnchanged();
  });
});

