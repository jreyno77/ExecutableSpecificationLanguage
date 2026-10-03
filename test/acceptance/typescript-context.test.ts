import { afterEach, describe, it } from 'vitest';
import { NativeContextExamples } from '../dsl/typescript-context.js';

afterEach(() => NativeContextExamples.clean());

describe('native imports use actual read-only declarations', { timeout: 30_000 }, () => {
  it('understands installed Vitest while finding the actual Shopping consumer', async () => {
    const project = await NativeContextExamples.connect();
    await project.installNativePackages({ vitest: '5.0.2', '@types/node': '24.13.6' });
    await project.file('test/shopping.ts', 'import { expect } from "vitest"; export class Shopping { expectQuantity(actual: number, expected: number) { expect(actual).toBe(expected); } }');
    await project.file('test/manual.ts', 'import { Shopping } from "./shopping.js"; new Shopping().expectQuantity(1, 1);');
    project.selectMethod('quantity', 'test/shopping.ts', 'Shopping', 'expectQuantity');
    await project.capture(); await project.search('quantity');
    project.expectCaptureComplete(); project.expectIncomingToken('test/manual.ts', 'expectQuantity');
    project.expectNativeCoverageComplete(); project.expectReadOnlyPackage('vitest');
    project.expectOutgoingReadOnlyTarget({ token: 'expect', packageDirectory: 'node_modules' });
    project.expectNoDependencyFilesInEditableCapture();
  });

  it('keeps a missing required package incomplete without inventing its exports', async () => {
    const project = await NativeContextExamples.connect();
    await project.file('test/shopping.ts', 'import { expect } from "vitest"; export const check = expect;');
    await project.file('notes.txt', 'Keep this readable.');
    await project.capture();
    project.expectMissingNativeInput('vitest', 'test/shopping.ts');
    project.expectCapturedText('notes.txt', 'Keep this readable.');
    project.expectCaptureIncomplete(); project.expectNoInventedDeclaration('expect');
  });

  it('captures both native conditional entrypoints and their separate transitives', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { exports: { '.': { import: { types: './esm.d.mts' }, require: { types: './cjs.d.cts' } } } }, {
      'esm.d.mts': 'export type { Book } from "./book.js";', 'book.d.ts': 'export interface Book { title: string }',
      'cjs.d.cts': 'export type { Count } from "./count.cjs";', 'count.d.cts': 'export type Count = number;',
    });
    await project.file('src/importer.mts', 'import type { Book } from "catalog"; export const title: Book["title"] = "Dune";');
    await project.file('src/importer.cts', 'import catalog = require("catalog"); export const copies: catalog.Count = 1;');
    await project.capture({ imports: ['catalog'] }); await project.inspectNativeProgram();
    project.expectReadOnlyPaths(['node_modules/catalog/package.json', 'node_modules/catalog/esm.d.mts',
      'node_modules/catalog/book.d.ts', 'node_modules/catalog/cjs.d.cts', 'node_modules/catalog/count.d.cts']);
    project.expectNativeCoverageComplete();
  });

  it('accepts an import-only seed but keeps a real unsupported require visible', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { exports: { '.': { import: { types: './index.d.mts' } } } }, {
      'index.d.mts': 'export interface Book { title: string }',
    });
    await project.capture({ imports: ['catalog'] }); project.expectCaptureComplete();
    await project.file('src/use.cts', 'import catalog = require("catalog"); export type Book = catalog.Book;');
    await project.capture({ imports: ['catalog'] });
    project.expectMissingNativeInput('catalog', 'src/use.cts'); project.expectCaptureIncomplete();
  });

  it('uses the declared subpath and nested version through native resolution', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { exports: { './testing': { types: './testing.d.ts' } } }, {
      'testing.d.ts': 'export { Mode } from "mode";',
    });
    await project.package('mode', { types: 'index.d.ts' }, { 'index.d.ts': 'export type Mode = "outer";' });
    await project.package('catalog/node_modules/mode', { types: 'index.d.ts' }, { 'index.d.ts': 'export type Mode = "nested";' });
    await project.file('src/use.ts', 'import type { Mode } from "catalog/testing"; export const mode: Mode = "nested";');
    await project.capture({ imports: ['catalog/testing'] }); await project.inspectNativeProgram();
    project.expectNativeCoverageComplete();
    project.expectReadOnlyPath('node_modules/catalog/node_modules/mode/index.d.ts');
    project.expectNoReadOnlyPath('node_modules/mode/index.d.ts');
  });

  it('follows native triple-slash references and terminates a declaration cycle', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': '/// <reference path="./tags.d.ts" />\n/// <reference types="labels" />\nexport interface Book { title: Label; tag: Tag }\nexport type { Shelf } from "./shelf.js";',
      'tags.d.ts': 'interface Tag { value: string }',
      'shelf.d.ts': 'import type { Book } from "./index.js"; export interface Shelf { books: Book[] }',
    });
    await project.package('@types/labels', { types: 'index.d.ts' }, { 'index.d.ts': 'type Label = string;' });
    await project.file('src/use.ts', 'import type { Book } from "catalog"; export const title: Book["title"] = "Dune";');
    await project.capture(); await project.inspectNativeProgram();
    project.expectNativeCoverageComplete(); project.expectReadOnlyPath('node_modules/@types/labels/index.d.ts');
    project.expectEachCapturedPathOnce();
  });

  it('captures a package tsconfig while keeping project roots and native options shared', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('native-config', {}, { 'tsconfig.json': '{"compilerOptions":{"strict":true,"types":[]}}' });
    await project.file('tsconfig.json', '{"extends":"native-config/tsconfig.json","include":["src/**/*.ts"]}');
    await project.file('src/book.ts', 'export const title: string = "Dune";');
    await project.file('outside.ts', 'export const title: number = "outside the program";');
    await project.capture({ configFile: 'tsconfig.json' }); await project.inspectNativeProgram();
    project.expectReadOnlyPath('node_modules/native-config/tsconfig.json');
    project.expectNativeRoots(['src/book.ts']); project.expectNativeCoverageComplete();
  });
});

describe('ambient inclusion follows the selected native configuration', { timeout: 30_000 }, () => {
  it('does not load unrelated ambient packages with the no-config default', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('@types/banner', { types: 'index.d.ts' }, { 'index.d.ts': 'declare const banner: string;' });
    await project.file('src/title.ts', 'export const title = banner;');
    await project.capture(); await project.inspectNativeProgram();
    project.expectCaptureComplete(); project.expectNoReadOnlyPath('node_modules/@types/banner/index.d.ts');
    project.expectNativeProblemAt('typescript-2304', 'src/title.ts', 'banner');
  });

  it('uses native visible local types when configured types is omitted', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('@types/banner', { types: 'index.d.ts' }, { 'index.d.ts': 'declare const banner: string;' });
    await project.file('tsconfig.json', '{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}');
    await project.file('src/title.ts', 'export const title: string = banner;');
    await project.capture({ configFile: 'tsconfig.json' }); await project.inspectNativeProgram();
    project.expectReadOnlyPath('node_modules/@types/banner/index.d.ts'); project.expectNativeCoverageComplete();
  });

  it('honors an explicit empty types list without hiding the native missing-name error', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('@types/banner', { types: 'index.d.ts' }, { 'index.d.ts': 'declare const banner: string;' });
    await project.file('tsconfig.json', '{"compilerOptions":{"strict":true,"types":[]},"include":["src/**/*.ts"]}');
    await project.file('src/title.ts', 'export const title: string = banner;');
    await project.capture({ configFile: 'tsconfig.json' }); await project.inspectNativeProgram();
    project.expectCaptureComplete(); project.expectNoReadOnlyPath('node_modules/@types/banner/index.d.ts');
    project.expectNativeProblemAt('typescript-2304', 'src/title.ts', 'banner');
  });

  it('loads actual Node declarations and their requested native transitives', async () => {
    const project = await NativeContextExamples.connect();
    await project.installNativePackages({ '@types/node': '24.13.6' });
    await project.file('tsconfig.json', '{"compilerOptions":{"strict":true,"types":["node"]},"include":["src/**/*.ts"]}');
    await project.file('src/input.ts', 'import type { IncomingMessage } from "node:http"; export function method(request: IncomingMessage) { return request.method; }');
    await project.capture({ configFile: 'tsconfig.json' }); await project.inspectNativeProgram();
    project.expectReadOnlyPackage('@types/node'); project.expectNativeCoverageComplete();
    project.expectNoDependencyFilesInEditableCapture();
  });
});

describe('capture is fresh and remains a read boundary', { timeout: 30_000 }, () => {
  it('distinguishes a captured handwritten type error from missing native inputs', async () => {
    const project = await NativeContextExamples.connect();
    await project.file('src/game.ts', 'export const copies: number = "many"; export function save(): void { throw new Error("Not implemented: save"); }');
    await project.capture(); await project.inspectNativeProgram();
    project.expectCaptureComplete(); project.expectReadOnlyPaths([]);
    project.expectNativeProblemAt('typescript-2322', 'src/game.ts', 'copies');
    project.expectNoMissingNativeInputs();
  });

  it('reports declaration errors at their real read-only file locations', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book { title: MissingTitle }' });
    await project.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];');
    await project.capture(); await project.inspectNativeProgram();
    project.expectCaptureComplete();
    project.expectNativeProblemAt('typescript-2304', 'node_modules/catalog/index.d.ts', 'MissingTitle');
    project.expectNativeCoverageIncomplete();
  });

  it('sees changed dependency bytes while preserving the previous capture', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export declare function save(copies: number): void;' });
    await project.file('src/game.ts', 'import { save } from "catalog"; save(1);');
    await project.capture(); await project.rememberCapture();
    await project.file('node_modules/catalog/index.d.ts', 'export declare function save(copies: string): void;');
    await project.capture(); await project.inspectNativeProgram();
    project.expectNativeProblemAt('typescript-2345', 'src/game.ts', '1');
    project.expectRememberedText('node_modules/catalog/index.d.ts', 'export declare function save(copies: number): void;');
    project.expectChangedReadOnlyVersion('node_modules/catalog/index.d.ts');
  });

  it('refuses a demanded linked package without traversing an unrelated bin link', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book { title: string }' });
    await project.unrelatedBinLink('unused-tool');
    await project.capture({ imports: ['catalog'] }); project.expectCaptureComplete();
    await project.replacePackageWithExternalDirectoryLink('catalog');
    await project.capture({ imports: ['catalog'] });
    project.expectUnsupportedNativeLink('node_modules/catalog'); project.expectCaptureIncomplete();
    project.expectExternalTargetUnchanged();
  });

  it('does not borrow a package from a parent directory or execute its runtime', async () => {
    const project = await NativeContextExamples.connect();
    await project.packageInParent('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book { title: string }' });
    await project.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];');
    project.denyProcessesNetworkAndParentReads(); await project.capture();
    project.expectMissingNativeInput('catalog', 'src/book.ts'); project.expectNoForbiddenEffects();
  });

  it('does not read package runtime assets while resolving declaration metadata', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { types: 'index.d.ts', main: 'runtime.js', bin: 'bin/tool.js' }, {
      'index.d.ts': 'export interface Book { title: string }', 'runtime.js': 'throw new Error("Must not execute");',
      'bin/tool.js': 'throw new Error("Must not execute");', 'README.md': 'Not type evidence.',
    });
    project.denyRuntimeAssetReadsAndExecution(); await project.capture({ imports: ['catalog'] });
    project.expectReadOnlyPaths(['node_modules/catalog/package.json', 'node_modules/catalog/index.d.ts']);
    project.expectNoForbiddenEffects();
  });

  it('keeps native declaration references from becoming incoming project consumers', async () => {
    const project = await NativeContextExamples.connect();
    await project.file('src/shopping.ts', 'export class Shopping { quantity(): number { return 1; } }');
    await project.file('src/manual.ts', 'import { Shopping } from "./shopping.js"; new Shopping().quantity();');
    await project.package('shop-types', { types: 'index.d.ts' }, {
      'index.d.ts': 'import type { Shopping } from "../../src/shopping.js"; export interface Extension extends Shopping {}',
    });
    await project.file('src/extension.ts', 'import type { Extension } from "shop-types"; export type ExternalShopping = Extension;');
    project.selectClass('shopping', 'src/shopping.ts', 'Shopping');
    await project.capture({ imports: ['shop-types'] }); await project.search('shopping');
    project.expectIncomingToken('src/manual.ts', 'Shopping');
    project.expectNoIncomingFile('node_modules/shop-types/index.d.ts');
    project.expectReadOnlyScopeVersion('node_modules/shop-types/index.d.ts');
  });

  it('keeps a missing referenced declaration incomplete with accepted neighbors', async () => {
    const project = await NativeContextExamples.connect();
    await project.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export type { Book } from "./book.js";' });
    await project.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];');
    await project.capture();
    project.expectMissingNativeInput('./book.js', 'node_modules/catalog/index.d.ts');
    project.expectReadOnlyPath('node_modules/catalog/index.d.ts'); project.expectCaptureIncomplete();
  });

  it('retains the real read failure when an installed required declaration is unreadable', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.withUnreadableFile('node_modules/catalog/index.d.ts', async () => {
      await project.capture();
      project.expectNativeReadFailureAt('node_modules/catalog/index.d.ts');
      project.expectCapturedPath('src/use.ts'); project.expectCaptureIncomplete();
    });
    await project.capture(); project.expectCaptureComplete();
  });
});

describe('writers guard dependencies without acquiring ownership', { timeout: 30_000 }, () => {
  it('writes the first importing file when the required package was explicitly seeded', async () => {
    const project = await NativeContextExamples.catalogProjectWithoutImports();
    await project.capture({ imports: ['catalog'] });
    await project.prepareChanges([
      { write: 'src/use.ts', text: 'import type { Book } from "catalog"; export type Title = Book["title"];' },
      { write: 'notes.txt', text: 'Both project writes finished.' },
    ]);
    await project.applyWithCapturedContext();
    project.expectWriteStatus('applied'); project.expectAppliedPaths(['src/use.ts', 'notes.txt']);
    project.expectDependencyBytesUnchanged();
  });

  it('stops with an honest partial receipt when an unseeded write adds dependency evidence', async () => {
    const project = await NativeContextExamples.catalogProjectWithoutImports();
    await project.capture();
    await project.prepareChanges([
      { write: 'src/use.ts', text: 'import type { Book } from "catalog"; export type Title = Book["title"];' },
      { write: 'notes.txt', text: 'Must not appear.' },
    ]);
    await project.applyWithCapturedContext();
    project.expectStopped('stale-project'); project.expectAppliedPaths(['src/use.ts']);
    project.expectNotAppliedPaths(['notes.txt']); project.expectNoPath('notes.txt');
  });

  it('removes the last import while its seeded declaration evidence remains guarded', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] });
    await project.prepareChanges([{ remove: 'src/use.ts' }, { write: 'notes.txt', text: 'Import removed.' }]);
    await project.applyWithCapturedContext();
    project.expectWriteStatus('applied'); project.expectNoPath('src/use.ts');
    project.expectDependencyBytesUnchanged();
  });

  it('does not silently accept shrinking unseeded evidence after its first removal', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture();
    await project.prepareChanges([{ remove: 'src/use.ts' }, { write: 'notes.txt', text: 'Must not appear.' }]);
    await project.applyWithCapturedContext();
    project.expectStopped('stale-project'); project.expectAppliedPaths(['src/use.ts']);
    project.expectNotAppliedPaths(['notes.txt']);
  });

  it('refuses changes to consulted metadata before any project write', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] }); await project.prepareChanges([{ write: 'notes.txt', text: 'Must not appear.' }]);
    await project.changePackageTypesEntrypoint('catalog', 'replacement.d.ts', 'export interface Book { title: number }');
    await project.applyWithCapturedContext();
    project.expectStopped('stale-project'); project.expectAppliedPaths([]); project.expectNoPath('notes.txt');
  });

  it('retains the first write when a declaration changes before the second', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] });
    await project.prepareChanges([{ write: 'first.txt', text: 'Saved.' }, { write: 'second.txt', text: 'Must not appear.' }]);
    project.afterActualWrite('first.txt', { write: 'node_modules/catalog/index.d.ts', text: 'export interface Book { title: number }' });
    await project.applyWithCapturedContext();
    project.expectStopped('stale-project'); project.expectAppliedPaths(['first.txt']);
    project.expectNotAppliedPaths(['second.txt']); project.expectActualText('first.txt', 'Saved.');
  });

  it('reports a failed final dependency guard without denying the completed file effect', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] }); await project.prepareChanges([{ write: 'first.txt', text: 'Saved.' }]);
    project.afterActualWrite('first.txt', { write: 'node_modules/catalog/index.d.ts', text: 'export interface Book { title: number }' });
    await project.applyWithCapturedContext();
    project.expectStopped('stale-project'); project.expectAppliedPaths(['first.txt']);
    project.expectNoSuccessfulDeliveryClaim();
  });

  it('rejects package mutations without granting authority from captured bytes', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] });
    await project.attemptPackageWrite('node_modules/catalog/index.d.ts', 'export type Book = never;');
    project.expectWriteRejectedBeforeMutation(); project.expectDependencyBytesUnchanged();
  });

  it('refuses a writer that would drop the captured dependency proof', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] });
    await project.prepareChanges([{ write: 'notes.txt', text: 'Must not appear.' }]);
    await project.applyWithUndecoratedContext();
    project.expectStopped('stale-project'); project.expectNoPath('notes.txt');
  });

  it('does not stop for an unrelated runtime or README edit outside native evidence', async () => {
    const project = await NativeContextExamples.catalogProjectWithImport();
    await project.capture({ imports: ['catalog'] }); await project.prepareChanges([{ write: 'notes.txt', text: 'Saved.' }]);
    await project.file('node_modules/catalog/README.md', 'Updated package prose.');
    await project.file('node_modules/catalog/runtime.js', 'export const unrelated = 2;');
    await project.applyWithCapturedContext(); project.expectWriteStatus('applied');
  });
});

