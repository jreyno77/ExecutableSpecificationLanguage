import { afterEach, describe, it } from 'vitest';
import { TypeScriptExamples } from '../../../dsl/project/typescript/typescript-output.js';

afterEach(() => TypeScriptExamples.dispose());

describe('source folders in the connected TypeScript project', () => {
  it('keeps source folders and imports across them', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./generation/expec/src/ui/tabs.expec"',
      'generation/expec/src/core/workspace.expec': 'class WorkspaceCore {}',
      'generation/expec/src/ui/tabs.expec': 'use WorkspaceCore from "../core/workspace.expec"\nclass OutputTabs { construction(core: WorkspaceCore) }',
    });
    await project.create({ sourceRoot: 'generation/expec', directory: '.' });
    project.expectGeneratedFiles(['src/core/WorkspaceCore.ts', 'src/ui/OutputTabs.ts']);
    project.expectNativeImport('OutputTabs', 'WorkspaceCore', '../core/WorkspaceCore.js');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
    await project.rememberProject();
    await project.createOpened();
    await project.expectProjectBytesUnchanged();
  });

  it('creates a newly described nested source folder', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFiles(['src/core/WorkspaceCore.ts']);
    await project.changeWorkspace({
      'main.expec': 'include "./specs/core/workspace.expec"\ninclude "./specs/core/editor/document.expec"',
      'specs/core/editor/document.expec': 'class Document {}',
    });
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectGeneratedFiles(['src/core/WorkspaceCore.ts', 'src/core/editor/Document.ts']);
  });

  it('preserves handwritten code while updating a nested contract', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFile('src/core/WorkspaceCore.ts');
    await project.file('src/core/WorkspaceCore.ts', 'export class WorkspaceCore { title(): string { return "My project"; } }');
    await project.changeWorkspace({
      'specs/core/workspace.expec': 'class WorkspaceCore { public title, close\ncapability title() returns Text\ncapability close() returns Nothing }',
    });
    await project.update();
    project.expectMethodBody('WorkspaceCore.title', 'return "My project";');
    project.expectMethodBody('WorkspaceCore.close', 'throw new Error("Not implemented: WorkspaceCore.close");');
    await project.rememberProject();
    await project.update();
    await project.expectProjectBytesUnchanged();
  });

  it('relocates an implemented class and its consumer without duplicating it', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFile('src/core/WorkspaceCore.ts');
    const identity = project.declarationIdentity('WorkspaceCore');
    await project.file('src/core/WorkspaceCore.ts', 'export class WorkspaceCore { title(): string { return "My project"; } }');
    await project.file('src/consumer.ts', 'import { WorkspaceCore } from "./core/WorkspaceCore.js"; export const title = new WorkspaceCore().title();');
    await project.changeWorkspace({
      'main.expec': 'include "./specs/editor/workspace.expec"',
      'specs/editor/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    }, ['WorkspaceCore']);
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectGeneratedFiles(['src/editor/WorkspaceCore.ts', 'src/consumer.ts']);
    project.expectNoGeneratedFile('src/core/WorkspaceCore.ts');
    project.expectDeclarationIdentity('WorkspaceCore', identity);
    project.expectMethodBody('WorkspaceCore.title', 'return "My project";');
    await project.expectFile('src/consumer.ts', 'import { WorkspaceCore } from "./editor/WorkspaceCore.js"; export const title = new WorkspaceCore().title();');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
    await project.rememberProject();
    await project.update();
    await project.expectProjectBytesUnchanged();
  });

  it('introduces a typed member using the relocated importer directory', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"\ninclude "./specs/data/book.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
      'specs/data/book.expec': 'type Book { title: Text }',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFile('src/core/WorkspaceCore.ts');
    await project.changeWorkspace({
      'main.expec': 'include "./specs/core/editor/workspace.expec"',
      'specs/core/editor/workspace.expec': 'use Book from "../../data/book.expec"\nclass WorkspaceCore { public open\ncapability open(book: Book) returns Nothing }',
    }, ['WorkspaceCore']);
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectGeneratedFiles(['src/core/editor/WorkspaceCore.ts', 'src/data/Book.ts']);
    project.expectNativeImport('WorkspaceCore', 'Book', '../../data/Book.js');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('updates both ends of an import when both source folders move', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/ui/tabs.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
      'specs/ui/tabs.expec': 'use WorkspaceCore from "../core/workspace.expec"\ntype OutputTabs { core: WorkspaceCore }',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFiles(['src/core/WorkspaceCore.ts', 'src/ui/OutputTabs.ts']);
    await project.changeWorkspace({
      'main.expec': 'include "./specs/editor/ui/tabs.expec"',
      'specs/app/workspace.expec': 'class WorkspaceCore {}',
      'specs/editor/ui/tabs.expec': 'use WorkspaceCore from "../../app/workspace.expec"\ntype OutputTabs { core: WorkspaceCore }',
    }, ['WorkspaceCore', 'OutputTabs']);
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectGeneratedFiles(['src/app/WorkspaceCore.ts', 'src/editor/ui/OutputTabs.ts']);
    project.expectNativeImport('OutputTabs', 'WorkspaceCore', '../../app/WorkspaceCore.js');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('imports an adopted class from its actual handwritten location', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/ui/tabs.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
      'specs/ui/tabs.expec': 'use WorkspaceCore from "../core/workspace.expec"\ntype OutputTabs { core: WorkspaceCore }',
    });
    await project.file('lib/handwritten.ts', 'export class WorkspaceCore { title(): string { return "My project"; } }');
    project.mapClass('WorkspaceCore', 'lib/handwritten.ts');
    await project.rememberFile('lib/handwritten.ts');
    await project.create({ sourceRoot: 'specs', directory: 'src', adoptExisting: true });
    project.expectGeneratedFiles(['src/ui/OutputTabs.ts']);
    project.expectNativeImport('OutputTabs', 'WorkspaceCore', '../../lib/handwritten.js');
    await project.expectRememberedFileUnchanged('lib/handwritten.ts');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('imports an adopted class using its actual export name', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/ui/tabs.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
      'specs/ui/tabs.expec': 'use WorkspaceCore from "../core/workspace.expec"\ntype OutputTabs { core: WorkspaceCore }',
    });
    await project.file('lib/handwritten.ts', 'export class NativeWorkspace { title(): string { return "My project"; } }');
    project.mapClass('WorkspaceCore', 'lib/handwritten.ts', 'NativeWorkspace');
    await project.rememberFile('lib/handwritten.ts');
    await project.create({ sourceRoot: 'specs', directory: 'src', adoptExisting: true });
    project.expectGeneratedFiles(['src/ui/OutputTabs.ts']);
    project.expectNativeImportAlias('OutputTabs', 'NativeWorkspace', 'WorkspaceCore', '../../lib/handwritten.js');
    await project.expectRememberedFileUnchanged('lib/handwritten.ts');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('uses an explicit native export alias for a newly generated consumer', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/ui/tabs.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
      'specs/ui/tabs.expec': 'use WorkspaceCore from "../core/workspace.expec"\ntype OutputTabs { core: WorkspaceCore }',
    });
    await project.file('lib/handwritten.ts', 'class NativeWorkspace {} export { NativeWorkspace as Workspace };');
    project.mapClass('WorkspaceCore', 'lib/handwritten.ts', 'NativeWorkspace');
    await project.rememberFile('lib/handwritten.ts');
    await project.create({ sourceRoot: 'specs', directory: 'src', adoptExisting: true });
    project.expectNativeImportAlias('OutputTabs', 'Workspace', 'WorkspaceCore', '../../lib/handwritten.js');
    await project.expectRememberedFileUnchanged('lib/handwritten.ts');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
    await project.rememberProject();
    await project.createOpened();
    await project.expectProjectBytesUnchanged();
  });

  it('refuses a new consumer of an unexported adopted declaration', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/ui/tabs.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
      'specs/ui/tabs.expec': 'use WorkspaceCore from "../core/workspace.expec"\ntype OutputTabs { core: WorkspaceCore }',
    });
    await project.file('lib/handwritten.ts', 'class NativeWorkspace {} export {};');
    project.mapClass('WorkspaceCore', 'lib/handwritten.ts', 'NativeWorkspace');
    await project.rememberProject();
    await project.create({ sourceRoot: 'specs', directory: 'src', adoptExisting: true });
    project.expectProblem('native-mapping-conflict');
    project.expectNoAppliedReceipt();
    await project.expectProjectBytesUnchanged();
  });

  it('adds a consumer using the final name of a renamed adopted class', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
    });
    await project.file('lib/handwritten.ts', 'export class NativeWorkspace {}');
    project.mapClass('WorkspaceCore', 'lib/handwritten.ts', 'NativeWorkspace');
    await project.create({ sourceRoot: 'specs', directory: 'src', adoptExisting: true });
    project.expectWriteStatus('applied');
    await project.changeWorkspace({
      'main.expec': 'include "./specs/ui/tabs.expec"',
      'specs/core/workspace.expec': 'class EditorCore {}',
      'specs/ui/tabs.expec': 'use EditorCore from "../core/workspace.expec"\ntype OutputTabs { core: EditorCore }',
    }, [['WorkspaceCore', 'EditorCore']]);
    project.open({ sourceRoot: 'specs', directory: 'src', adoptExisting: true });
    await project.update();
    project.expectNativeImport('OutputTabs', 'EditorCore', '../../lib/handwritten.js');
    project.expectNoNativeDeclaration('NativeWorkspace');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('retains native declaration-module spelling when its importer moves', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFile('src/core/WorkspaceCore.ts');
    await project.file('src/helper.d.ts', 'export declare function getTitle(): string;');
    await project.file('src/core/WorkspaceCore.ts', 'import { getTitle } from "../helper.js"; export class WorkspaceCore { title(): string { return getTitle(); } }');
    await project.changeWorkspace({
      'main.expec': 'include "./specs/editor/panels/workspace.expec"',
      'specs/editor/panels/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    }, ['WorkspaceCore']);
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectNoGeneratedFile('src/core/WorkspaceCore.ts');
    project.expectNativeImport('WorkspaceCore', 'getTitle', '../../helper.js');
    project.expectMethodBody('WorkspaceCore.title', 'return getTitle();');
    await project.checkNativeTypes();
    project.expectNativeCheckPassed();
  });

  it('refuses an occupied relocation destination before writing', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore {}',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFile('src/core/WorkspaceCore.ts');
    await project.file('src/editor/WorkspaceCore.ts', '// Handwritten destination must remain intact.');
    await project.rememberProject();
    await project.changeWorkspace({
      'main.expec': 'include "./specs/editor/workspace.expec"',
      'specs/editor/workspace.expec': 'class WorkspaceCore {}',
    }, ['WorkspaceCore']);
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectProblem('native-name-conflict');
    project.expectNoAppliedReceipt();
    await project.expectProjectBytesUnchanged();
  });

  it('refuses relocation when a native consumer cannot be resolved', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({
      'main.expec': 'include "./specs/core/workspace.expec"',
      'specs/core/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectGeneratedFile('src/core/WorkspaceCore.ts');
    await project.file('src/consumer.ts', 'import { WorkspaceCore } from "./core/WorkspaceCore.js"; const workspace = new WorkspaceCore(); const key: string = "title"; workspace[key]();');
    await project.rememberProject();
    await project.changeWorkspace({
      'main.expec': 'include "./specs/editor/workspace.expec"',
      'specs/editor/workspace.expec': 'class WorkspaceCore { public title\ncapability title() returns Text }',
    }, ['WorkspaceCore']);
    project.open({ sourceRoot: 'specs', directory: 'src' });
    await project.update();
    project.expectProblem('incomplete-native-rename');
    project.expectNoAppliedReceipt();
    await project.expectProjectBytesUnchanged();
  });

  it('refuses a declaration outside the chosen source root without writing', async () => {
    const project = await TypeScriptExamples.connect();
    await project.workspace({ 'main.expec': 'class Outside {}' });
    await project.create({ sourceRoot: 'specs', directory: 'src' });
    project.expectProblem('invalid-source-layout');
    await project.expectNoWrites();
  });
});
