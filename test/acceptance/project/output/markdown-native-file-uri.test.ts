import { it } from 'vitest';
import { MarkdownWikiExamples } from '../../../dsl/project/output/markdown-wiki.js';
import { PreviewExample } from '../../../dsl/project/output/preview.js';

it('previews and writes an encoded-drive source URI without rewriting its identity', async () => {
  const docs = new MarkdownWikiExamples();
  const uri = 'file:///c%3A/workspace/src/library.expec';
  docs.useNativeFileManifest();
  docs.sourceFile(uri, 'concept Library { capability open() returns Nothing }');
  await docs.identifyFrom(uri);
  docs.rememberSourceIdentity('Library');

  await docs.previewFrom(uri);
  docs.expectPreviewPages(['docs/specification/Home.md', 'docs/specification/pages/src/library.md']);
  docs.expectAllPreviewLinksResolve();
  docs.expectRetainedSourceIdentity('Library', uri);

  await docs.generateFrom(uri);
  docs.expectSubjectInFile('Library', 'docs/specification/pages/src/library.md');
  docs.expectHomeLinks(['pages/src/library.md']);
  docs.expectAllGeneratedLinksResolve();
  docs.expectRetainedSourceIdentity('Library', uri);
  docs.expectSourcePageIdentity(uri, 'docs/specification/pages/src/library.md');
});

it('keeps canonical Node file sources working through public preview', async () => {
  const preview = PreviewExample.specifyAtSourcePath('src/library.expec', 'concept Library {}');
  await preview.show('markdown', { directory: 'docs' });
  preview.expectDocument('markdown', 'docs/pages/src/library.md', 'text/markdown', 'concept Library');
  preview.expectDocument('markdown', 'docs/Home.md', 'text/markdown', '[src/library](pages/src/library.md)');
  preview.expectNoFindings('markdown');
  preview.expectNoTargetAccess();
});

it('refuses distinct source identities that decode to the same native page', async () => {
  const docs = new MarkdownWikiExamples();
  const first = 'file:///c%3A/workspace/src/library.expec';
  const second = 'file:///c%3A/workspace/src/%6Cibrary.expec';
  docs.useNativeFileManifest();
  docs.sourceFile(first, 'include "file:///c%3A/workspace/src/%6Cibrary.expec"\nconcept FirstLibrary {}');
  docs.sourceFile(second, 'concept SecondLibrary {}');
  await docs.planFrom(first);
  docs.expectProblemAt('output-conflict', 'docs/specification/pages/src/library.md');
  docs.expectNoPlanAndNoWrites();
});

it.each([
  ['query', 'file:///c%3A/workspace/src/library.expec?draft=1'],
  ['fragment', 'file:///c%3A/workspace/src/library.expec#Library'],
  ['empty query', 'file:///c%3A/workspace/src/library.expec?'],
  ['empty fragment', 'file:///c%3A/workspace/src/library.expec#'],
])('refuses a %s component before planning a file-source page', async (_kind, uri) => {
  const docs = new MarkdownWikiExamples();
  docs.useNativeFileManifest(); docs.sourceFile(uri, 'concept Library {}');
  await docs.planFrom(uri);
  docs.expectProblemAt('invalid-source-layout', uri);
  docs.expectNoPlanAndNoWrites();
});

it.each([
  ['forward separator', 'file:///c%3A/workspace/src%2Flibrary.expec'],
  ['backward separator', 'file:///c%3A/workspace/src%5Clibrary.expec'],
])('refuses an encoded %s in a source URI', async (_kind, uri) => {
  const docs = new MarkdownWikiExamples();
  docs.useNativeFileManifest(); docs.sourceFile(uri, 'concept Library {}');
  await docs.planFrom(uri);
  docs.expectProblemAt('invalid-source-layout', uri);
  docs.expectNoPlanAndNoWrites();
});

it('retains the native root guard after decoding an outside source URI', async () => {
  const docs = new MarkdownWikiExamples();
  const uri = 'file:///c%3A/workspace/%2e%2e/outside/library.expec';
  docs.useNativeFileManifest(); docs.sourceFile(uri, 'concept Library {}');
  await docs.planFrom(uri);
  docs.expectProblemAt('invalid-source-layout', uri);
  docs.expectNoPlanAndNoWrites();
});

it('requires a native manifest context for an absolute file source', async () => {
  const docs = new MarkdownWikiExamples();
  const uri = 'file:///c%3A/workspace/src/library.expec';
  docs.sourceFile(uri, 'concept Library {}');
  await docs.planFrom(uri);
  docs.expectProblemAt('invalid-source-layout', uri);
  docs.expectNoPlanAndNoWrites();
});
