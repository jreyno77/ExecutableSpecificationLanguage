import { describe, it } from 'vitest';
import { DependencyExamples } from '../dsl/library-loading.js';

describe('configured libraries join the shared compilation without becoming workspace output', () => {
  it('loads an explicit library and its private relative type', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.2.0', {
      'index.expec': 'use Title from "./types.expec"\ntype Book { title: Title }',
      'types.expec': 'type Title = Text'
    });
    project.requireLibrary('books', '^1.0.0', './libraries/books');
    await project.source('main.expec', 'use Book from "books"\nfunction save(book: Book) returns Nothing');
    await project.loadAndCompile();
    project.expectChecked();
    project.expectFieldType('Book.title', 'Text');
    project.expectOriginFile('Title', 'libraries/books/types.expec');
    project.expectWorkspaceModules(['main.expec']);
    project.expectSelectedLibrary('books', '1.2.0');
    project.expectCapturedJsonProperty('libraries/books/package.json', ['version'], '1.2.0');
    project.expectCaptureWithoutSourceModel('libraries/books/package.json');
    project.expectCapturedText('libraries/books/types.expec', 'type Title = Text');
  });

  it('keeps two private files with the same relative name distinct', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', {
      'index.expec': 'use Title from "./types.expec"\ntype Book { title: Title }',
      'types.expec': 'type Title = Text'
    });
    await project.library('stock', '1.0.0', {
      'index.expec': 'use Copies from "./types.expec"\ntype Stock { copies: Copies }',
      'types.expec': 'type Copies = Number'
    });
    project.requireLibrary('books', '^1', './libraries/books');
    project.requireLibrary('stock', '^1', './libraries/stock');
    await project.source('main.expec', 'use Book from "books"\nuse Stock from "stock"\nfunction save(book: Book, stock: Stock) returns Nothing');
    await project.loadAndCompile();
    project.expectFieldType('Book.title', 'Text');
    project.expectFieldType('Stock.copies', 'Number');
    project.expectDistinctOrigins('Title', 'Copies');
  });

  it('loads external declarations into the same public inspection', async () => {
    const project = await DependencyExamples.create();
    await project.externalLibrary('web', '2.0.0', [{ kind: 'opaque-type', name: 'URL' }]);
    project.requireLibrary('web', '^2', './libraries/web');
    await project.source('main.expec', 'use URL from "web"\nfunction open(address: URL) returns Nothing');
    await project.loadAndCompile();
    project.expectChecked();
    project.expectExternalType('URL', { module: 'web', path: [0] });
    project.expectOpaqueDeclarations(['URL']);
    project.expectParameterTypeDeclaration('open.address', 'web', 'URL');
    project.expectCaptureWithoutSourceModel('libraries/web/declarations.json');
    project.expectCapturedJson('libraries/web/declarations.json', [{ kind: 'opaque-type', name: 'URL' }]);
    await project.expectNoExecutedPackageCode();
  });

  it('composes an acquired library with a separately supplied external model', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', {
      'index.expec': 'use URL from "web"\ntype Book { address: URL }'
    });
    project.requireLibrary('books', '^1', './libraries/books');
    project.requireLibrary('web', '^2');
    project.supplyExternalLibrary('web', '2.0.0', [{ kind: 'opaque-type', name: 'URL' }]);
    await project.source('main.expec', 'use Book from "books"\nfunction save(book: Book) returns Nothing');
    await project.loadAndCompile();
    project.expectChecked();
    project.expectAcquiredInventory(['books']);
    project.expectFieldTypeDeclaration('Book.address', 'web', 'URL');
    project.expectWorkspaceModules(['main.expec']);
    project.expectNoAcquisitionSourceRead('web');
  });

  it('leaves a missing host-supplied bare dependency to selection', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', {
      'index.expec': 'use URL from "web"\ntype Book { address: URL }'
    });
    project.requireLibrary('books', '^1', './libraries/books');
    project.requireLibrary('web', '^2');
    await project.loadLibraries();
    project.expectSuccessfulLibraryLoad();
    project.expectAcquiredInventory(['books']);
    await project.selectDependencies();
    project.expectProblem('unavailable-library');
    project.expectNoSelectedDependencies();
    project.expectNoAcquisitionSourceRead('web');
  });

  it('resolves a metadata field reference relative to its declarations file', async () => {
    const project = await DependencyExamples.create();
    await project.externalLibrary('books', '1.0.0', [{
      kind: 'record-type', name: 'Book', fields: [{
        kind: 'field', name: 'title', type: { kind: 'named', path: ['Title'], module: './types.expec' }
      }]
    }]);
    await project.file('libraries/books/types.expec', 'type Title = Text');
    project.requireLibrary('books', '^1', './libraries/books');
    await project.source('main.expec', 'use Book from "books"\nfunction save(book: Book) returns Nothing');
    await project.loadAndCompile();
    project.expectChecked();
    project.expectFieldType('Book.title', 'Text');
    project.expectFieldOrigin('Book.title', { module: 'books', path: [0, 'fields', 0] });
    project.expectOriginFile('Title', 'libraries/books/types.expec');
    project.expectAcquiredInventory(['books']);
    project.expectWorkspaceModules(['main.expec']);
  });

  it('rejects a workspace import of the acquired library entry', async () => {
    const project = await DependencyExamples.withBookLibrary('1.0.0');
    await project.source('main.expec', 'use Book from "./libraries/books/index.expec"\nfunction save(book: Book) returns Nothing');
    await project.loadAndCompile();
    project.expectProblemAt('source-ownership-conflict', './libraries/books/index.expec', 'main.expec');
    project.expectNoSuccessfulSourceLoad();
    project.expectNoWorkspaceCapture('libraries/books/index.expec');
    project.expectNoSpecification();
  });

  it('does not turn an unused file inside an acquired root into workspace output', async () => {
    const project = await DependencyExamples.withBookLibrary('1.0.0');
    await project.file('libraries/books/unused.expec', 'type Internal = Text');
    await project.source('main.expec', 'use Internal from "./libraries/books/unused.expec"\nfunction save(value: Internal) returns Nothing');
    await project.loadAndCompile();
    project.expectProblemAt('source-ownership-conflict', './libraries/books/unused.expec', 'main.expec');
    project.expectNoSuccessfulSourceLoad();
    project.expectFileNotRead('libraries/books/unused.expec');
    project.expectNoWorkspaceCapture('libraries/books/unused.expec');
  });

  it('does not expose a library-private file as an undeclared bare module', async () => {
    const project = await DependencyExamples.withPrivateBookLibrary();
    await project.source('main.expec', 'use Title from "books/types.expec"\nfunction save(title: Title) returns Nothing');
    await project.loadAndCompile();
    project.expectUnavailableModule('books/types.expec');
    project.expectNoSpecification();
  });

  it('retains private declaration visibility after library loading', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', { 'index.expec': 'concept Catalog { local type Draft { title: Text } }' });
    project.requireLibrary('books', '^1', './libraries/books');
    await project.source('main.expec', 'use Catalog from "books"\nfunction steal(draft: Catalog.Draft) returns Nothing');
    await project.loadAndCompile();
    project.expectProblemAt('inaccessible-reference', 'Catalog.Draft', 'main.expec');
    project.expectNoSpecification();
  });

  it('lets the pure planner reject an actually loaded incompatible version', async () => {
    const project = await DependencyExamples.withBookLibrary('1.2.0');
    project.requireLibrary('books', '^2', './libraries/books');
    await project.loadLibraries();
    project.expectLoadedLibraryVersion('books', '1.2.0');
    await project.selectDependencies();
    project.expectProblem('incompatible-version');
    project.expectNoSelectedDependencies();
  });

  it('does not guess a root for a requirement without an acquisition source', async () => {
    const project = await DependencyExamples.withBookLibrary('1.0.0');
    project.requireLibrary('books', '^1');
    await project.loadAndCompile();
    project.expectProblem('unavailable-library');
    project.expectNoReadUnder('libraries/books');
    project.expectNoNativeInstall();
  });

  it('rejects a private import that escapes its explicit library root', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', { 'index.expec': 'use Secret from "../secret.expec"\ntype Book { value: Secret }' });
    await project.file('libraries/secret.expec', 'type Secret = Text');
    project.requireLibrary('books', '^1', './libraries/books');
    await project.loadLibraries();
    project.expectProblemAt('source-outside-roots', '../secret.expec', 'libraries/books/index.expec');
    project.expectNoSuccessfulLibraryLoad();
    project.expectFileNotRead('libraries/secret.expec');
  });

  it('keeps a missing private input located at its real importing source', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', { 'index.expec': 'use Title from "./missing.expec"\ntype Book { title: Title }' });
    project.requireLibrary('books', '^1', './libraries/books');
    await project.loadLibraries();
    project.expectProblemAt('source-unavailable', './missing.expec', 'libraries/books/index.expec');
    project.expectNoSuccessfulLibraryLoad();
  });

  it('does not repair a missing declaration with an unrelated library file', async () => {
    const project = await DependencyExamples.create();
    await project.library('books', '1.0.0', {
      'index.expec': 'type Book { title: Title }', 'unused.expec': 'type Title = Text'
    });
    project.requireLibrary('books', '^1', './libraries/books');
    await project.source('main.expec', 'use Book from "books"\nfunction save(book: Book) returns Nothing');
    await project.loadAndCompile();
    project.expectProblemAt('unresolved-reference', 'Title', 'libraries/books/index.expec');
    project.expectFileNotRead('libraries/books/unused.expec');
  });

  it('rejects conflicting source and external entries before creating models', async () => {
    const project = await DependencyExamples.withBookLibrary('1.0.0');
    await project.libraryMetadata('books', { entry: './index.expec', declarations: './declarations.json' });
    await project.loadLibraries();
    project.expectProblem('invalid-library-metadata');
    project.expectNoSuccessfulLibraryLoad();
  });

  it('rejects an invalid external declaration through the existing input contract', async () => {
    const project = await DependencyExamples.create();
    await project.externalLibrary('web', '1.0.0', [{ kind: 'record-type', name: 'Broken', fields: 'not fields' }]);
    project.requireLibrary('web', '^1', './libraries/web');
    await project.loadLibraries();
    project.expectExternalProblem('invalid-library-declarations', { module: 'web', path: [0, 'fields'] });
    project.expectRelatedFile('libraries/web/declarations.json');
    project.expectNoSuccessfulLibraryLoad();
  });

  it('rejects a library graph paired with different selected model identities', async () => {
    const project = await DependencyExamples.withPrivateBookLibrary();
    await project.loadLibraries();
    project.replaceSelectedEntryWithSeparateModel('books', 'type Book { title: Text }');
    await project.loadWorkspaceWithCapturedLibraries();
    project.expectProblem('invalid-library-input');
    project.expectNoSpecification();
  });

  it('keeps previous captures unchanged when library source changes', async () => {
    const project = await DependencyExamples.withBookLibrary('1.0.0');
    await project.loadLibraries();
    project.rememberLibraryLoad('before');
    await project.file('libraries/books/index.expec', 'type Book { title: Text\ncopies: Number }');
    await project.loadLibraries();
    project.expectLibraryFields('Book', ['title', 'copies']);
    project.expectRememberedLibraryFields('before', 'Book', ['title']);
    project.expectSourceVersionChanged('libraries/books/index.expec');
  });
});
