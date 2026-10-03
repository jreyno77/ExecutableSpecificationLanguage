import { describe, it } from 'vitest';
import { PreservationExamples } from '../dsl/typescript-preservation.js';

describe('existing code can become an explicitly mapped contract', { timeout: 30_000 }, () => {
  it('adopts a handwritten class without rewriting its file', async () => {
    const project = await PreservationExamples.connect();
    project.source('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.file('game.ts', `class StoreGame {
  private running = true;
  save(snapshot: string): void { this.assertRunning(); console.log(snapshot); }
  private assertRunning() { if (!this.running) throw Error("Stopped"); }
}
export const storeGame = new StoreGame();
`);
    project.mapClass('StoreGame', 'game.ts', 'StoreGame');
    project.mapMethod('StoreGame.save', 'game.ts', 'StoreGame', 'save');
    await project.rememberFiles();
    await project.create({ directory: 'src', adoptExisting: true });
    project.expectApplied();
    await project.expectFileBytesUnchanged('game.ts');
    project.expectConfirmedDefinition('StoreGame.save', 'game.ts');
    project.expectNoOwnedSubject('assertRunning');
    project.expectNativeExports('game.ts', ['storeGame']);
    project.expectNoFile('src/StoreGame.ts');
  });

  it('requires adoption permission even when explicit associations identify real code', async () => {
    const project = await PreservationExamples.mappedStoreGame();
    await project.rememberFiles();
    await project.create({ directory: 'src' });
    project.expectConflict('unowned-project-artifact');
    await project.expectNoWrites();
  });

  it('does not guess a mapping from an identical class name', async () => {
    const project = await PreservationExamples.connect();
    project.source('class StoreGame {}');
    await project.file('src/StoreGame.ts', 'export class StoreGame { private count = 3; }\n');
    await project.rememberFiles();
    await project.create({ directory: 'src', adoptExisting: true });
    project.expectConflict('unowned-project-artifact');
    await project.expectNoWrites();
  });

  it('adopts a distributed implementation using actual native import aliases', async () => {
    const project = await PreservationExamples.connect();
    project.source('type Snapshot { title: Text }\nclass StoreGame { public save\ncapability save(snapshot: Snapshot) returns Nothing }');
    await project.file('model.ts', 'export type Snapshot = { title: string };\n');
    await project.file('store.ts', 'import type { Snapshot as State } from "./model.js";\nexport class StoreGame { save(snapshot: State): void { console.log(snapshot.title); } }\n');
    project.mapType('Snapshot', 'model.ts', 'Snapshot');
    project.mapProperty('Snapshot.title', 'model.ts', 'Snapshot', 'title');
    project.mapClass('StoreGame', 'store.ts', 'StoreGame');
    project.mapMethod('StoreGame.save', 'store.ts', 'StoreGame', 'save');
    await project.rememberFiles();
    await project.create({ directory: 'src', adoptExisting: true });
    project.expectApplied();
    await project.expectFileBytesUnchanged('model.ts');
    await project.expectFileBytesUnchanged('store.ts');
    await project.search('Snapshot');
    project.expectIncoming('StoreGame.save', 'store.ts');
  });

  it('declines a mismatched signature instead of normalizing the handwritten implementation', async () => {
    const project = await PreservationExamples.mappedStoreGame('save(snapshot: number): void { console.log(snapshot); }');
    await project.rememberFiles();
    await project.create({ directory: 'src', adoptExisting: true });
    project.expectConflictAt('adoption-contract-mismatch', 'game.ts', 'number');
    await project.expectNoWrites();
  });

  it('does not treat an adopted body as owned merely because it resembles our stub', async () => {
    const project = await PreservationExamples.mappedStoreGame('save(snapshot: string): void { throw new Error("Not implemented: StoreGame.save"); }');
    await project.create({ directory: 'src', adoptExisting: true });
    project.change('class StoreGame {}', { retire: ['StoreGame.save'] });
    await project.rememberFiles();
    await project.update();
    project.expectConflict('handwritten-removal');
    await project.expectNoWrites();
  });
});

describe('native contract edits keep actual implementation bytes', { timeout: 30_000 }, () => {
  it('adds a capability around the original StoreGame implementation', async () => {
    const project = await PreservationExamples.adoptOriginalStoreGame();
    project.addCapability('StoreGame', 'reset', [], 'Nothing');
    await project.rememberImplementation(['StoreGame.startup', 'StoreGame.save', 'StoreGame.delete', 'StoreGame.new', 'StoreGame.shutDown']);
    await project.rememberNativeRegions(['StoreGame.config', 'StoreGame.currentSnapshot', 'StoreGame.running', 'StoreGame.assertRunning']);
    await project.rememberFiles(['launcher.ts']);
    await project.update();
    project.expectApplied();
    project.expectNativeMethod('StoreGame.reset', [], 'void');
    await project.expectImplementationBytesKept();
    await project.expectNativeRegionBytesKept();
    await project.expectFileBytesUnchanged('launcher.ts');
    await project.run('storeGame.reset()');
    project.expectThrownMessage('Not implemented: StoreGame.reset');
  });

  it('changes a result annotation while leaving incompatible implementation work visible', async () => {
    const project = await PreservationExamples.generated('class Counter { public count\ncapability count() returns Number }');
    await project.implement('Counter.count', '{ return 3; }');
    project.change('class Counter { public count\ncapability count() returns Text }');
    await project.rememberImplementation(['Counter.count']);
    await project.update();
    project.expectApplied();
    project.expectNativeMethod('Counter.count', [], 'string');
    await project.expectImplementationBytesKept();
    await project.checkNativeTypes();
    project.expectNativeTypeError('number', 'string');
    project.expectNoRuntimeConformanceClaim();
  });

  it('updates the Supabase obligation without implementing persistence', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing { promises "Save to local storage." } }');
    await project.implement('StoreGame.save', '{ localStorage.setItem("save", snapshot); }');
    project.change('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing { promises "Save to Supabase." } }');
    await project.rememberImplementation(['StoreGame.save']);
    await project.update();
    project.expectApplied();
    project.expectOwnedDocumentation('StoreGame.save', 'Save to Supabase.');
    project.expectObligationMarkedUnverified('StoreGame.save');
    await project.expectImplementationBytesKept();
    project.expectSourceContains('localStorage.setItem("save", snapshot)');
    project.expectNoInventedSupabaseCall();
  });

  it('retains handwritten documentation when owned obligations change', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing { promises "Save to disk." } }');
    await project.addUserDocumentation('StoreGame.save', '/** Keep retry reasoning.\n * @example save("Dune")\n */');
    project.change('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing { promises "Save to Supabase." } }');
    await project.rememberUserDocumentation();
    await project.update();
    project.expectApplied();
    await project.expectUserDocumentationBytesKept();
    project.expectOwnedDocumentation('StoreGame.save', 'Save to Supabase.');
  });

  it('does not discard a handwritten addition inside an owned comment', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing { promises "Save to disk." } }');
    await project.appendToGeneratedDocumentation('StoreGame.save', 'Keep the retry rationale here.');
    project.change('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing { promises "Save to Supabase." } }');
    await project.rememberFiles();
    await project.update();
    project.expectConflictAt('owned-documentation-drift', 'src/StoreGame.ts', 'Keep the retry rationale here.');
    await project.expectNoWrites();
  });

  it('updates record fields while retaining unowned fields and an actual consumer', async () => {
    const project = await PreservationExamples.generated('type Book { title: Text }');
    await project.addNativeField('Book', 'operatorNote?: string; // kept');
    await project.file('reader.ts', 'import type { Book } from "./src/Book.js";\nexport const readTitle = (book: Book) => book.title;\n');
    project.change('type Book { title: Text\ncopies: Number }');
    await project.rememberNativeRegions(['Book.operatorNote']);
    await project.rememberFiles(['reader.ts']);
    await project.update();
    project.expectApplied();
    project.expectNativeField('Book.copies', 'number', { optional: false });
    await project.expectNativeRegionBytesKept();
    await project.expectFileBytesUnchanged('reader.ts');
  });

  it('updates a top-level function without rebuilding its implementation', async () => {
    const project = await PreservationExamples.generated('function title(book: Text) returns Text');
    await project.implement('title', '{ return book.toUpperCase(); }');
    project.change('function title(book: Text, copies: Number) returns Text');
    await project.rememberImplementation(['title']);
    await project.update();
    project.expectApplied();
    project.expectNativeFunction('title', ['book: string', 'copies: number'], 'string');
    await project.expectImplementationBytesKept();
    await project.run('console.log(title("Dune", 2))');
    project.expectStandardOutput('DUNE');
  });

  it('refuses to turn an implemented class into an interface', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.implement('StoreGame.save', '{ console.log(snapshot); }');
    project.change('interface StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }', { keep: ['StoreGame', 'StoreGame.save'] });
    await project.rememberFiles();
    await project.update();
    project.expectConflict('implemented-kind-change');
    await project.expectNoWrites();
  });

  it('retains BOM, CRLF, tabs and astral text outside a changed signature', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.reformatAs('src/StoreGame.ts', { bom: true, newline: '\r\n', indent: '\t' });
    await project.implement('StoreGame.save', '{\r\n\t\tconsole.log("📚", snapshot); // keep\r\n\t}');
    project.change('class StoreGame { public save\ncapability save(snapshot: Text, copies: Number) returns Nothing }');
    await project.rememberOutsideSignature('StoreGame.save');
    await project.update();
    project.expectApplied();
    project.expectNativeMethod('StoreGame.save', ['snapshot: string', 'copies: number'], 'void');
    await project.expectOutsideSignatureBytesKept();
    project.expectFileEncoding('src/StoreGame.ts', { bom: true, newline: '\r\n' });
  });

  it('updates constructor inputs without replacing private initializers or the body', async () => {
    const project = await PreservationExamples.generated('class Cache { construction(size: Number) }');
    await project.addNativeField('Cache', 'private entries = new Map<string, string>();');
    await project.implementConstruction('Cache', '{ this.entries.set("size", String(size)); }');
    project.change('class Cache { construction(size: Text) }');
    await project.rememberNativeRegions(['Cache.entries']);
    await project.rememberImplementation(['Cache.constructor']);
    await project.update();
    project.expectApplied();
    project.expectNativeConstructor('Cache', ['size: string']);
    await project.expectNativeRegionBytesKept();
    await project.expectImplementationBytesKept();
  });

  it('reports competing native signature changes as drift', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.replaceSignature('StoreGame.save', 'save(snapshot: number): void');
    project.change('class StoreGame { public save\ncapability save(snapshot: Boolean) returns Nothing }');
    await project.rememberFiles();
    await project.update();
    project.expectConflictAt('contract-drift', 'src/StoreGame.ts', 'number');
    await project.expectNoWrites();
  });

  it('does not accept an unrecorded header even when it equals desired', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.replaceSignature('StoreGame.save', 'save(snapshot: number): void');
    project.change('class StoreGame { public save\ncapability save(snapshot: Number) returns Nothing }');
    await project.rememberFiles();
    await project.update();
    project.expectConflict('contract-drift');
    await project.expectNoWrites();
  });

  it('leaves unrelated exports and declarations in a shared file untouched', async () => {
    const project = await PreservationExamples.adoptSingleFileStoreAndCart();
    await project.appendNativeCode('game.ts', '\nexport { externalHelper } from "./helper.js";\nexport const label = "StoreGame.save";\n');
    await project.file('helper.ts', 'export const externalHelper = () => 8;\n');
    project.addCapability('StoreGame', 'reset', [], 'Nothing');
    await project.rememberNativeRegions(['Cart', 'label']);
    await project.rememberNativeExports();
    await project.update();
    project.expectApplied();
    await project.expectNativeRegionBytesKept();
    await project.expectNativeExportBytesKept();
    project.expectNoFile('src/StoreGame.ts');
  });
});

describe('established identities guide native refactoring', { timeout: 30_000 }, () => {
  it('renames a method and a real unmodeled consumer while retaining prose and body', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.implement('StoreGame.save', '{ console.log(snapshot); }');
    await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js";\nnew StoreGame().save("Dune"); // save stays prose\nconst label = "save";\n');
    project.change('class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }', { rename: [['StoreGame.save', 'StoreGame.saveGame']] });
    await project.rememberImplementation(['StoreGame.save']);
    await project.update();
    project.expectApplied();
    await project.expectImplementationBytesKept();
    await project.expectFile('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js";\nnew StoreGame().saveGame("Dune"); // save stays prose\nconst label = "save";\n');
    await project.search('StoreGame.saveGame');
    project.expectIncomingProjectFile('launcher.ts');
  });

  it('renames a bound parameter while retaining an object shorthand property name', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
    await project.implement('StoreGame.save', '{ const payload = { snapshot }; console.log(payload, snapshot, "snapshot"); }');
    project.change('class StoreGame { public save\ncapability save(state: Text) returns Nothing }', { rename: [['StoreGame.save.snapshot', 'StoreGame.save.state']] });
    await project.update();
    project.expectApplied();
    project.expectImplementation('StoreGame.save', '{ const payload = { snapshot: state }; console.log(payload, state, "snapshot"); }');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('moves a generated root file while retaining imported aliases and re-exports', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.implement('StoreGame.save', '{ console.log("kept"); }');
    await project.appendNativeCode('src/StoreGame.ts', '\n// Operator note.\n');
    await project.file('launcher.ts', 'import { StoreGame as Cart } from "./src/StoreGame.js";\nnew Cart().save();\n');
    await project.file('index.ts', 'export { StoreGame } from "./src/StoreGame.js";\n');
    project.change('class Game { public save\ncapability save() returns Nothing }', { rename: [['StoreGame', 'Game']] });
    await project.update();
    project.expectApplied();
    project.expectNoFile('src/StoreGame.ts');
    project.expectSourceIn('src/Game.ts', ['console.log("kept")', '// Operator note.']);
    project.expectNativeImport('launcher.ts', { exported: 'Game', local: 'Cart', from: './src/Game.js' });
    project.expectNativeExport('index.ts', { name: 'Game', from: './src/Game.js' });
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('renames an adopted root inside its shared file without relocating its neighbor', async () => {
    const project = await PreservationExamples.adoptSingleFileStoreAndCart();
    project.rename('StoreGame', 'Game');
    await project.rememberNativeRegions(['Cart']);
    await project.update();
    project.expectApplied();
    project.expectNativeDeclaration('game.ts', 'Game');
    await project.expectNativeRegionBytesKept();
    project.expectNoFile('src/Game.ts');
  });

  it('does not change an unrelated same-spelled native method', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.file('other.ts', 'export class Other { save() { return "mine"; } }\nnew Other().save();\n');
    project.rename('StoreGame.save', 'StoreGame.saveGame');
    await project.rememberFiles(['other.ts']);
    await project.update();
    project.expectApplied();
    await project.expectFileBytesUnchanged('other.ts');
  });

  it('declines a rename when a dynamic consumer remains uncertain', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js";\nexport function run(key: keyof StoreGame) { return new StoreGame()[key](); }\n');
    project.rename('StoreGame.save', 'StoreGame.saveGame');
    await project.rememberFiles();
    await project.update();
    project.expectConflict('incomplete-native-rename');
    await project.expectNoWrites();
  });

  it('refuses to move an implementation across owners with different private state', async () => {
    const project = await PreservationExamples.generated('class First { public save\ncapability save() returns Nothing }\nclass Second {}');
    await project.addNativeField('First', 'private count = 0;');
    await project.implement('First.save', '{ this.count++; }');
    project.change('class First {}\nclass Second { public save\ncapability save() returns Nothing }', { move: [['First.save', 'Second.save']] });
    await project.rememberFiles();
    await project.update();
    project.expectConflict('unsupported-implementation-move');
    await project.expectNoWrites();
  });

  it('moves an untouched stub between explicitly corresponding owners', async () => {
    const project = await PreservationExamples.generated('class First { public save\ncapability save() returns Nothing }\nclass Second {}');
    project.change('class First {}\nclass Second { public save\ncapability save() returns Nothing }', { move: [['First.save', 'Second.save']] });
    await project.update();
    project.expectApplied();
    project.expectNoNativeMethod('First.save');
    project.expectNativeMethod('Second.save', [], 'void');
    project.expectSameIdentity('First.save', 'Second.save');
    await project.run('new Second().save()');
    project.expectThrownMessage('Not implemented: Second.save');
  });
});

describe('removal and failed delivery protect existing work', { timeout: 30_000 }, () => {
  it('removes an untouched generated method while retaining a private helper', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.addNativeMethod('StoreGame', 'private serialise() { return "mine"; }');
    project.change('class StoreGame {}', { retire: ['StoreGame.save'] });
    await project.rememberNativeRegions(['StoreGame.serialise']);
    await project.update();
    project.expectApplied();
    project.expectNoNativeMethod('StoreGame.save');
    await project.expectNativeRegionBytesKept();
  });

  it('retains an implemented method when its source contract is retired', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.implement('StoreGame.save', '{ console.log("keep this work"); }');
    project.change('class StoreGame {}', { retire: ['StoreGame.save'] });
    await project.rememberFiles();
    await project.update();
    project.expectConflict('handwritten-removal');
    await project.expectNoWrites();
  });

  it('does not repair a remaining consumer by erasing its call', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js";\nnew StoreGame().save();\n');
    project.change('class StoreGame {}', { retire: ['StoreGame.save'] });
    await project.rememberFiles();
    await project.update();
    project.expectConflictAt('remaining-native-use', 'launcher.ts', 'save');
    await project.expectNoWrites();
  });

  it('retains unrelated file content after removing the last generated root', async () => {
    const project = await PreservationExamples.generated('class StoreGame {}');
    await project.appendNativeCode('src/StoreGame.ts', '\nexport const operatorNote = "Keep this";\n');
    await project.delete('StoreGame');
    project.expectApplied();
    project.expectNoNativeDeclaration('StoreGame');
    project.expectSourceIn('src/StoreGame.ts', ['export const operatorNote = "Keep this";']);
    await project.delete('StoreGame');
    project.expectUnchanged();
  });

  it('does not overwrite a body edited after its plan was prepared', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    project.addCapability('StoreGame', 'reset', [], 'Nothing');
    await project.planUpdate();
    await project.implement('StoreGame.save', '{ console.log("newer work"); }');
    await project.applyPreparedPlan();
    project.expectStopped('stale-project');
    project.expectImplementation('StoreGame.save', '{ console.log("newer work"); }');
    project.expectNoNativeMethod('StoreGame.reset');
  });

  it('detects a newly added consumer before applying a prepared removal', async () => {
    const project = await PreservationExamples.generated('class StoreGame {}');
    await project.planDelete('StoreGame');
    await project.file('launcher.ts', 'import { StoreGame } from "./src/StoreGame.js";\nnew StoreGame();\n');
    await project.applyPreparedPlan();
    project.expectStopped('stale-project');
    project.expectNativeDeclaration('src/StoreGame.ts', 'StoreGame');
    project.expectSourceIn('launcher.ts', ['new StoreGame()']);
  });

  it('reports partial effects without adopting unrecorded contracts on retry', async () => {
    const project = await PreservationExamples.generated('class First {}\nclass Second {}');
    project.addCapability('First', 'save', [], 'Nothing');
    project.addCapability('Second', 'save', [], 'Nothing');
    await project.failWriteTo('src/Second.ts');
    await project.update();
    project.expectStoppedWithAppliedFile('src/First.ts');
    project.expectNoConfirmedAssociations();
    await project.restoreWriter();
    await project.rememberFiles();
    await project.update();
    project.expectConflictAt('native-name-conflict', 'src/First.ts', 'save');
    await project.expectNoWrites();
  });

  it('repeats a successful preservation update without source or state churn', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.implement('StoreGame.save', '{ console.log("kept"); }');
    project.addCapability('StoreGame', 'reset', [], 'Nothing');
    await project.update();
    project.expectApplied();
    await project.rememberFiles();
    await project.update();
    project.expectUnchanged();
    await project.expectNoWrites();
  });

  it('plans through captured input without executing implementation code', async () => {
    const project = await PreservationExamples.generated('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.implement('StoreGame.save', '{ throw Error("Do not execute while planning"); }');
    project.addCapability('StoreGame', 'reset', [], 'Nothing');
    await project.denyAmbientProjectAccess();
    await project.planUpdate();
    project.expectApplicablePlan();
    project.expectNoUserCodeExecution();
    project.expectNoAmbientProjectAccess();
    await project.expectPlanningMadeNoWrites();
  });

});
