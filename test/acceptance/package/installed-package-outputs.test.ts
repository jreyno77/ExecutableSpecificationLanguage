import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../../dsl/package/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
  it('preserves an adopted implementation and its caller through an installed native rename', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.preserveTypeScript({
      source: 'class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }',
      revised: 'class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }',
      implementation: 'export class StoreGame { private saves = 0; save(snapshot: string): void { this.saves++; console.log(snapshot); } }\n',
      caller: 'import { StoreGame } from "./game.js"; new StoreGame().save("Dune");\n',
    });
    consumer.expectAdoptedSourceUnchanged();
    consumer.expectPreservedNativeSource('private saves = 0; saveGame(snapshot: string): void { this.saves++; console.log(snapshot); }');
    consumer.expectPreservedCaller('new StoreGame().saveGame("Dune")');
    consumer.expectPreservedRuntimeOutput('Dune');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer(); consumer.expectDeclarationsAccepted();
  });

  it('generates a natively checked callable scaffold through the installed TypeScript output', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.generateTypeScript('function save(title: Text) returns Nothing',
      'import { save } from "./src/save.js"; save("Dune");',
      'import { save } from "./src/save.js"; save(64);',
      'function save(title: Text, copies: Number) returns Nothing', 'title: number');

    consumer.expectInstalledTypeScriptScaffold('Not implemented: save');
    consumer.expectInvalidNativeArgument('64');
    consumer.expectConflictingNativeSignatureProtected();
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('renders and searches installed diagrams using only captured input and immutable package resources', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.diagramProject('concept Store { public save\ncapability save() returns Nothing }');
    consumer.expectInstalledPackageUsed();
    consumer.expectInstalledDiagramFiles(['design/structure.d2', 'design/structure.svg']);
    consumer.expectInstalledNativeSignature('Store', 'save() → Nothing');
    consumer.expectInstalledSvgLabel('Store');
    consumer.expectInstalledDiagramCoverage();
    consumer.expectOnlyInstalledDiagramResourcesUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('generates readable Markdown and observes notes and links through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.documentProject('concept Game { public save\ncapability save() returns Nothing }', '\nReader note.\n');

    consumer.expectInstalledPackageUsed();
    consumer.expectInstalledDocumentation('reference/Game.md', [
      '# Game', 'capability save() returns Nothing', 'Reader note.',
      'Statically checked specification. Runtime behavior is not verified by this document.',
    ]);
    consumer.expectInstalledDocumentConsumer('guide.md', 'reference/Game.md');
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('uses an independently authored installed output to write, read and discover a new consumer', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.registerCountOutput();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
    await consumer.createCountReport(`concept Storage {}
type Snapshot { title: Text }
concept StoreGame {
  depends on Storage, Snapshot
  public save
  capability save(snapshot: Snapshot) returns Nothing
}`, 'reports');
    consumer.expectDeclarationCounts({ concepts: 2, recordTypes: 1, capabilities: 1 });
    consumer.expectCountReportWritten('applied');

    await consumer.readCountReport('StoreGame');
    consumer.expectWholeCountReport('reports/counts.json', '"capabilities": 1');
    await consumer.writeCountConsumer('Release checklist');
    await consumer.searchCountReport();
    consumer.expectCountDefinition('reports/counts.json');
    consumer.expectCountConsumer('notes/release.counts.json', 'Release checklist');
    consumer.expectCompleteCountCoverage('declaration-count report definitions and references');
    consumer.expectInstalledPackageUsed();
  });
});
