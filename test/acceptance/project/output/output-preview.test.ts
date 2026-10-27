import { describe, it } from 'vitest';
import { PreviewExample } from '../../../dsl/project/output/preview.js';

describe('authored output previews', () => {
  it('previews the current typed declaration without connecting a project', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('typescript', { directory: 'draft/types' });
    preview.expectDocument('typescript', 'draft/types/Book.ts', 'text/typescript', 'title: string;');
    preview.expectNoFindings('typescript');
  });
  it('previews the real diagram source and rendered image', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDocument('uml', 'draft/uml/structure.d2', 'text/vnd.d2', 'Book');
    preview.expectSvgLabel('draft/uml/structure.svg', 'Book');
    preview.expectNoFindings('uml');
  });
  it('previews documentation while retaining its declared-status wording', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('markdown', { directory: 'draft/docs' });
    preview.expectDocument('markdown', 'draft/docs/Book.md', 'text/markdown', 'type Book');
    preview.expectDocument('markdown', 'draft/docs/Book.md', 'text/markdown',
      'Statically checked specification. Runtime behavior is not verified by this document.');
  });
  it('reflects a changed field type in the same document', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('typescript', { directory: 'draft/types' });
    preview.revise('type Book { title: Number }');
    await preview.show('typescript', { directory: 'draft/types' });
    preview.expectDocument('typescript', 'draft/types/Book.ts', 'text/typescript', 'title: number;');
    preview.expectDocumentExcludes('typescript', 'draft/types/Book.ts', 'title: string;');
  });
  it('projects three outputs from the same accepted specification', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('typescript', { directory: 'draft/types' });
    await preview.show('markdown', { directory: 'draft/docs' });
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDocument('typescript', 'draft/types/Book.ts', 'text/typescript', 'title: string;');
    preview.expectDocument('markdown', 'draft/docs/Book.md', 'text/markdown', 'type Book');
    preview.expectSvgLabel('draft/uml/structure.svg', 'Book');
    preview.expectSpecificationUnchanged();
  });
  it('follows renamed declarations without identity decisions', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('typescript', { directory: 'draft/types' });
    preview.remember('typescript');
    preview.revise('type Novel { title: Text\n pages: Number }');
    await preview.show('typescript', { directory: 'draft/types' });
    preview.expectDocument('typescript', 'draft/types/Novel.ts', 'text/typescript', 'pages: number;');
    preview.expectNoDocument('typescript', 'draft/types/Book.ts');
    preview.expectRememberedDocument('draft/types/Book.ts', 'title: string;');
  });
  it('keeps a valid output when another configured projection is refused', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('typescript', { directory: 'draft/types', names: [{ declaration: ['Missing'], name: 'Renamed' }] });
    preview.expectProblem('typescript', 'invalid-native-mapping', 'Name selector must select one eligible declaration: Missing');
    await preview.show('markdown', { directory: 'draft/docs' });
    preview.expectDocument('markdown', 'draft/docs/Book.md', 'text/markdown', 'type Book');
  });
  it('retains distinct output IDs sharing Markdown presentation', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('markdown', { directory: 'draft/docs' });
    await preview.show('contract-list', { directory: 'draft/contracts' });
    preview.expectDocument('markdown', 'draft/docs/Book.md', 'text/markdown', 'type Book');
    preview.expectDocument('contract-list', 'draft/contracts/Book.md', 'text/markdown', 'Book');
  });
  it('does not alter existing source or target bytes while producing drafts', async () => {
    const preview = await PreviewExample.withExistingFiles({
      'src/book.expec': 'type Book { title: Text }',
      'draft/types/Book.ts': '// handwritten book implementation\n',
      'draft/docs/Book.md': 'My handwritten notes\n',
    });
    await preview.show('typescript', { directory: 'draft/types' });
    await preview.show('markdown', { directory: 'draft/docs' });
    preview.expectDocument('typescript', 'draft/types/Book.ts', 'text/typescript', 'title: string;');
    preview.expectDocument('markdown', 'draft/docs/Book.md', 'text/markdown', 'type Book');
    await preview.expectExistingFilesUnchanged();
    preview.expectNoTargetAccess();
  });
  it('keeps source-folder output prerequisites explicit', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }', 'untitled:book');
    preview.useManifestAtWorkspaceRoot();
    await preview.show('typescript', { directory: '.', sourceRoot: 'generation/expec' });
    preview.expectRefused('typescript');
    preview.expectProblemCode('typescript', 'invalid-source-layout');
  });
  it('previews the configured source-folder layout from supplied module locations', async () => {
    const preview = PreviewExample.specifyAtSourcePath('generation/expec/src/core/book.expec', 'type Book { title: Text }');
    await preview.show('typescript', { directory: '.', sourceRoot: 'generation/expec' });
    preview.expectDocument('typescript', 'src/core/Book.ts', 'text/typescript', 'title: string;');
  });
  it('previews structural JSON using its declared media type', async () => {
    const preview = PreviewExample.specify('type Book { title: Text }');
    await preview.show('structure-list', { directory: 'draft/structure' });
    preview.expectStructuredDeclaration('draft/structure/Book.structure.json', 'Book', 'title');
  });
});


describe('literal diagram method previews', () => {
  it('previews an optional capability parameter as a literal native method', async () => {
    const preview = PreviewExample.specify('component Screen { public select\ncapability select(label: Text?) returns Nothing }');
    await preview.show('uml', { directory: 'draft/uml', views: ['structure'] });
    preview.expectDocument('uml', 'draft/uml/structure.d2', 'text/vnd.d2', '"select(label: Text?)"');
    preview.expectSvgLabel('draft/uml/structure.svg', 'select(label: Text?)');
    preview.expectNoFindings('uml');
  });
});
