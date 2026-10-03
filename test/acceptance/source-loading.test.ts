import { describe, it } from 'vitest';
import { SourceWorkspace } from '../dsl/source-loading.js';

describe('loading explicitly configured sources', () => {
  it('uses the manifest directory regardless of cwd or connected project', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'settings/specs/store.expec': 'opaque type Store',
      'other/specs/store.expec': 'opaque type Wrong',
      'game/specs/store.expec': 'opaque type AlsoWrong'
    });
    project.configureAt('settings/expec.json', {
      build: { entries: ['specs/store.expec'] }, project: { root: '../game' }
    });
    project.expectWorkingDirectoryOutsideManifest();

    await project.compile();

    project.expectCompiledEntries(['settings/specs/store.expec']);
    project.expectDeclarations('settings/specs/store.expec', ['Store']);
    project.expectCapturedFiles(['settings/specs/store.expec']);
  });

  it('resolves identical relative spellings from their owning files', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "./books/model.expec"\nuse Cart from "./carts/model.expec"',
      'books/model.expec': 'use Title from "./types.expec"\ntype Book { title: Title }',
      'books/types.expec': 'type Title = Text',
      'carts/model.expec': 'use Quantity from "./types.expec"\ntype Cart { quantity: Quantity }',
      'carts/types.expec': 'type Quantity = Number'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectCompiled();
    project.expectFieldType('books/model.expec', 'Book.title', 'Text');
    project.expectFieldType('carts/model.expec', 'Cart.quantity', 'Number');
    project.expectDeclarationOrigin('Title', 'books/types.expec', { line: 1, column: 1 });
    project.expectDeclarationOrigin('Quantity', 'carts/types.expec', { line: 1, column: 1 });
    project.expectAuthoredLocator('books/model.expec', './types.expec');
    project.expectAuthoredLocator('carts/model.expec', './types.expec');
  });

  it('shares captures across entries without sharing their lexical scopes', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'a.expec': 'use Book from "./book.expec"\nopaque type OnlyA',
      'b.expec': 'use Book from "./book.expec"\nfunction steal(value: OnlyA)',
      'book.expec': 'type Book { title: Text }'
    });
    project.configure({ build: { entries: ['a.expec', 'b.expec'] } });

    await project.compile();

    project.expectCapturedFiles(['a.expec', 'b.expec', 'book.expec']);
    project.expectSharedCapturedModel('book.expec', ['a.expec', 'b.expec']);
    project.expectEntryCompiled('a.expec');
    project.expectSemanticProblem('b.expec', 'unresolved-reference', 'OnlyA', { line: 2 });
    project.expectNoSpecification('b.expec');
  });

  it('does not scan neighboring files to repair a missing declaration', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'function save(book: Book) returns Nothing',
      'book.expec': 'type Book { title: Text }',
      'unrelated.expec': 'this is not valid syntax'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectCapturedFiles(['store.expec']);
    project.expectNoSyntaxProblems();
    project.expectSemanticProblem('store.expec', 'unresolved-reference', 'Book', { line: 1 });
    project.expectNoSpecification('store.expec');
  });

  it('uses real composition to check an explicitly included extension', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'include "./saving.expec"\nconcept Store { public save }',
      'saving.expec': 'use Store from "./store.expec"\nextend Store {\n  capability save(snapshot: Text) returns Nothing\n}'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectCompiled();
    project.expectCapabilities('Store', ['save']);
    project.expectDeclarationOrigin('save', 'saving.expec', { line: 3, column: 3 });
  });

  it('checks extracted examples in subject scope with their original locations', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'concept Store {\n  local type Snapshot { title: Text }\n  capability save(snapshot: Snapshot) returns Nothing\n}\nexamples for Store from "./saving.expec"',
      'saving.expec': 'examples {\n  fixture snapshot: Snapshot = { title: "Dune" }\n  example "saving": save(snapshot) => satisfies "The snapshot is persisted."\n}'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectCompiled();
    project.expectFixtureType('saving.expec', 'snapshot', 'Store.Snapshot');
    project.expectCallTarget('saving.expec', 'saving', 'Store.save');
    project.expectProseOrigin('The snapshot is persisted.', 'saving.expec', { line: 3 });
  });

  it('reports a typo in an extracted example at that file', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'concept Store { capability save() returns Nothing }\nexamples for Store from "./saving.expec"',
      'saving.expec': 'examples {\n  example "saving": savve() => satisfies "Saved"\n}'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectSemanticProblem('saving.expec', 'unresolved-reference', 'savve', { line: 2 });
    project.expectNoSpecification('store.expec');
  });

  it('terminates acquisition cycles and leaves include cycles to composition', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'a.expec': 'include "./b.expec"\nopaque type A',
      'b.expec': 'include "./a.expec"\nopaque type B'
    });
    project.configure({ build: { entries: ['a.expec'] } });

    await project.compile();

    project.expectCapturedFiles(['a.expec', 'b.expec']);
    project.expectLoadSucceeded();
    project.expectSemanticProblem('b.expec', 'include-cycle', 'include "./a.expec"', { line: 1 });
    project.expectRelatedSource('a.expec', { line: 1 });
    project.expectNoSpecification('a.expec');
  });
});

describe('libraries stay explicit supplied dependencies', () => {
  it('uses an external library without reading a similarly named local file', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "library"\nfunction save(book: Book)',
      'library.expec': 'this file must not be parsed'
    });
    project.externalLibrary('library', '1.2.0', [
      { kind: 'record-type', name: 'Book', fields: [
        { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } }
      ] }
    ]);
    project.configure({
      build: { entries: ['store.expec'] }, libraries: [{ module: 'library', version: '^1.0.0' }]
    });

    await project.compile();

    project.expectCompiled();
    project.expectCapturedFiles(['store.expec']);
    project.expectExternalOrigin('Book', { kind: 'external', module: 'library', path: [0] });
    project.expectSuppliedNodeIdentityPreserved('library', 'Book');
  });

  it('follows transitive bare imports through declared source libraries', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'store.expec': 'use Book from "books"' });
    project.sourceLibrary('books', '1.0.0', 'use Title from "words"\ntype Book { title: Title }', 'package:books/model.expec');
    project.sourceLibrary('words', '1.0.0', 'type Title = Text', 'package:words/types.expec');
    project.configure({
      build: { entries: ['store.expec'] },
      libraries: [{ module: 'books', version: '1.0.0' }, { module: 'words', version: '1.0.0' }]
    });

    await project.compile();

    project.expectCompiled();
    project.expectFieldType('books', 'Book.title', 'Text');
    project.expectSuppliedSourceOrigin('Title', 'words', 'package:words/types.expec');
    project.expectCapturedFiles(['store.expec']);
  });

  it('does not expose an extra inventory library absent from the manifest', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'store.expec': 'use Secret from "private"' });
    project.sourceLibrary('private', '1.0.0', 'opaque type Secret', 'package:private.expec');
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectLoadSucceeded();
    project.expectSemanticProblem('store.expec', 'unavailable-module', 'Secret', { line: 1 });
    project.expectNoSpecification('store.expec');
  });

  it('never uses a supplied library diagnostic sourceId as its local root', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "books"',
      'packages/types.expec': 'type Title = Text'
    });
    project.sourceLibrary('books', '1.0.0',
      'use Title from "./types.expec"\ntype Book { title: Title }',
      project.fileUrl('packages/books.expec'));
    project.configure({
      build: { entries: ['store.expec'] }, libraries: [{ module: 'books', version: '1.0.0' }]
    });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblemAtSuppliedSource('unsupported-library-source', 'books', './types.expec');
    project.expectCapturedFiles(['store.expec']);
  });

  it('does not inspect an unused library for local files', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'store.expec': 'opaque type Store' });
    project.sourceLibrary('unused', '1.0.0', 'use Lost from "./missing.expec"', 'package:unused.expec');
    project.configure({
      build: { entries: ['store.expec'] }, libraries: [{ module: 'unused', version: '1.0.0' }]
    });

    await project.compile();

    project.expectCompiled();
    project.expectCapturedFiles(['store.expec']);
    project.expectNoLoadProblems();
  });
});

describe('failed loading retains useful evidence', () => {
  it('reports a missing file at every importing occurrence', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'a.expec': 'use Book from "./missing.expec"',
      'b.expec': 'include "./missing.expec"'
    });
    project.configure({ build: { entries: ['a.expec', 'b.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('source-unavailable', 'a.expec', '"./missing.expec"', { line: 1, column: 15 });
    project.expectLoadProblem('source-unavailable', 'b.expec', '"./missing.expec"', { line: 1, column: 9 });
    project.expectRelatedAttemptedFile('missing.expec');
    project.expectAcceptedCaptures(['a.expec', 'b.expec']);
  });

  it('retains missing-file and syntax causes plus accepted siblings', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'include "./missing.expec"\ninclude "./broken.expec"\ninclude "./valid.expec"',
      'broken.expec': 'type Broken {',
      'valid.expec': 'opaque type Good'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('source-unavailable', 'store.expec', '"./missing.expec"', { line: 1 });
    project.expectSyntaxProblem('broken.expec', 'expected-token', { line: 1 });
    project.expectAcceptedCaptures(['store.expec', 'valid.expec']);
    project.expectRejectedCapture('broken.expec', 'type Broken {');
    project.expectNoCompilationClaim();
  });

  it('does not guess imports from rejected text', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'broken.expec': 'type Broken {\ninclude "./hidden.expec"',
      'hidden.expec': 'opaque type Hidden',
      'other.expec': 'opaque type Other'
    });
    project.configure({ build: { entries: ['broken.expec', 'other.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectCapturedFiles(['broken.expec', 'other.expec']);
    project.expectAcceptedCaptures(['other.expec']);
    project.expectSyntaxProblemAt('broken.expec', { line: 2 });
  });

  it('reports a missing entry in the manifest while capturing the other entry', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'good.expec': 'opaque type Good' });
    project.configure({ build: { entries: ['missing.expec', 'good.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectManifestProblem('source-unavailable', ['build', 'entries', 0]);
    project.expectAcceptedCaptures(['good.expec']);
  });

  it('requires the exact filename instead of trying extension or index alternatives', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'include "./models"',
      'models.expec': 'opaque type Flat',
      'models/index.expec': 'opaque type Indexed'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('invalid-source-path', 'store.expec', '"./models"', { line: 1 });
    project.expectCapturedFiles(['store.expec']);
  });

  it('rejects a directory even when its name has the source extension', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'directory.expec/index.expec': 'opaque type Hidden' });
    project.configure({ build: { entries: ['directory.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectManifestProblem('source-not-file', ['build', 'entries', 0]);
    project.expectCapturedFiles([]);
  });
});

describe('declared source scope and aliases', () => {
  it('accepts parent traversal that stays inside a source root', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'specs/store.expec': 'use Book from "../shared/book.expec"',
      'shared/book.expec': 'type Book { title: Text }'
    });
    project.configure({ build: { entries: ['specs/store.expec'] } });

    await project.compile();

    project.expectCompiled();
    project.expectCapturedFiles(['shared/book.expec', 'specs/store.expec']);
  });

  it('rejects a sibling escape even when its name shares the root prefix', async () => {
    const project = await SourceWorkspace.create({ directoryName: 'specs' });
    await project.files({ 'store.expec': 'use Secret from "../specs-other/secret.expec"' });
    await project.siblingFiles({ 'specs-other/secret.expec': 'opaque type Secret' });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('source-outside-roots', 'store.expec', '"../specs-other/secret.expec"', { line: 1 });
    project.expectCapturedFiles(['store.expec']);
  });

  it('reads an explicitly added root without discovering its unrelated neighbors', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'store.expec': 'use Book from "../shared/book.expec"' });
    await project.siblingFiles({
      'shared/book.expec': 'type Book { title: Text }',
      'private/secret.expec': 'opaque type Secret'
    });
    project.configure({ build: { entries: ['store.expec'], sourceRoots: ['../shared'] } });

    await project.compile();

    project.expectCompiled();
    project.expectCapturedFiles(['store.expec', '../shared/book.expec']);
    project.expectDeclarationOrigin('Book', '../shared/book.expec', { line: 1, column: 1 });
  });

  it('rejects a missing source root without creating a directory', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'store.expec': 'opaque type Store' });
    project.configure({ build: { entries: ['store.expec'], sourceRoots: ['../missing'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectManifestProblem('source-root-unavailable', ['build', 'sourceRoots', 0]);
    await project.expectSiblingAbsent('missing');
  });

  it('reuses one capture for dot-segment aliases and retains their authored text', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book as A from "./book.expec"\nuse Book as B from "./unused/../book.expec"\nfunction pair(a: A, b: B)',
      'book.expec': 'type Book { title: Text }'
    });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectCompiled();
    project.expectCapturedFiles(['book.expec', 'store.expec']);
    project.expectSameParameterType('pair', 'a', 'b');
    project.expectAuthoredLocator('store.expec', './unused/../book.expec');
  });

  it('rejects configured entries that normalize to the same file', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'store.expec': 'opaque type Store' });
    project.configure({ build: { entries: ['store.expec', './store.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectManifestProblem('duplicate-source-entry', ['build', 'entries', 1]);
    project.expectRelatedManifestLocation(['build', 'entries', 0]);
  });

  it('does not follow a directory link even to a target inside a root', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "./shortcut/book.expec"',
      'real/book.expec': 'opaque type Book'
    });
    await project.directoryLink('shortcut', 'real');
    project.configure({ build: { entries: ['store.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('source-link', 'store.expec', '"./shortcut/book.expec"', { line: 1 });
    project.expectCapturedFiles(['store.expec']);
  });

  it('rejects physical-file aliases rather than choosing an arbitrary import base', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "./book.expec"\nuse Book as Other from "./copy.expec"',
      'book.expec': 'opaque type Book'
    });
    await project.hardLink('copy.expec', 'book.expec');
    project.configure({ build: { entries: ['store.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('source-alias', 'store.expec', '"./copy.expec"', { line: 2 });
    project.expectNoSecondModelForPhysicalFile('book.expec');
  });
});

describe('captured text and fresh reads', () => {
  it('preserves BOM, Unicode and CRLF in text and reader coordinates', async () => {
    const project = await SourceWorkspace.create();
    const authored = '\uFEFF// 🛒\r\nopaque type Book\r\n';
    await project.files({ 'store.expec': authored });
    project.configure({ build: { entries: ['store.expec'] } });

    await project.compile();

    project.expectCompiled();
    project.expectCapturedText('store.expec', authored);
    project.expectDeclarationOrigin('Book', 'store.expec', { line: 2, column: 1 });
    project.expectVersionMatchesAuthoredBytes('store.expec', authored);
  });

  it('rejects malformed UTF-8 instead of replacing bytes', async () => {
    const project = await SourceWorkspace.create();
    await project.fileBytes('bad.expec', [0xC3, 0x28]);
    project.configure({ build: { entries: ['bad.expec'] } });

    await project.load();

    project.expectNoLoadValue();
    project.expectManifestProblem('source-encoding', ['build', 'entries', 0]);
    project.expectCapturedFiles([]);
    project.expectNoSyntaxProblems();
  });

  it('observes edits without modifying earlier captured models or mappings', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "./old.expec"',
      'old.expec': 'type Book { copies: Number }',
      'new.expec': 'type Book { title: Text }'
    });
    project.configure({ build: { entries: ['store.expec'] } });
    await project.compile();
    project.rememberLoad('before');

    await project.file('store.expec', 'use Book from "./new.expec"');
    await project.compile();

    project.expectCompiled();
    project.expectCapturedFiles(['new.expec', 'store.expec']);
    project.expectFieldType('new.expec', 'Book.title', 'Text');
    project.expectChangedVersion('store.expec', 'before');
    project.expectRememberedText('before', 'store.expec', 'use Book from "./old.expec"');
    project.expectRememberedMapping('before', 'store.expec', './old.expec', 'old.expec');
    project.expectRememberedFieldType('before', 'old.expec', 'Book.copies', 'Number');
  });

  it('detects deletion between calls instead of reusing a successful result', async () => {
    const project = await SourceWorkspace.create();
    await project.files({
      'store.expec': 'use Book from "./book.expec"', 'book.expec': 'opaque type Book'
    });
    project.configure({ build: { entries: ['store.expec'] } });
    await project.load();
    project.rememberLoad('before');

    await project.removeFile('book.expec');
    await project.load();

    project.expectNoLoadValue();
    project.expectLoadProblem('source-unavailable', 'store.expec', '"./book.expec"', { line: 1 });
    project.expectRememberedAcceptedCapture('before', 'book.expec');
  });

  it('reads unchanged content afresh while retaining its byte fingerprint', async () => {
    const project = await SourceWorkspace.create();
    await project.files({ 'empty.expec': '', 'store.expec': 'opaque type Store' });
    project.configure({ build: { entries: ['empty.expec', 'store.expec'] } });
    await project.load();
    project.rememberLoad('before');

    await project.load();

    project.expectLoadSucceeded();
    project.expectSameVersions('before');
    project.expectFreshModelIdentity('store.expec', 'before');
    await project.expectFilesUnchanged();
  });
});
