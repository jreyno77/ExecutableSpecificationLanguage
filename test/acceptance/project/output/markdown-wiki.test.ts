import { it } from 'vitest';
import { MarkdownWikiExamples } from '../../../dsl/project/output/markdown-wiki.js';

it('keeps authored declarations together with readable contracts and a source table of contents', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('ResultsRelay.expec', `type Payload { text: Text }
error type DownloadError { code: "unavailable" }
concept ResultsRelay {
 public download
 capability download(result: Payload) returns Nothing fails with DownloadError {
  promises "Persist the supplied result."
  promises "Allow cancellation."
 }
}`);
  await docs.generateFrom('ResultsRelay.expec');
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/ResultsRelay.md']);
  docs.expectPageSections('ResultsRelay.expec', ['Payload', 'DownloadError', 'ResultsRelay']);
  docs.expectTableOfContents('ResultsRelay.expec', ['Payload', 'DownloadError', 'ResultsRelay', 'download']);
  docs.expectPromiseBullets('ResultsRelay.download', ['Persist the supplied result.', 'Allow cancellation.']);
  docs.expectInputEntries('ResultsRelay.download', [{ name: 'result', type: 'Payload' }]);
  docs.expectReturn('ResultsRelay.download', 'Nothing');
  docs.expectFailures('ResultsRelay.download', ['DownloadError']);
  docs.expectNoRepeatedWarningsOrInputs('ResultsRelay.download');
  docs.expectHomeLinks(['pages/ResultsRelay.md']);
  docs.expectBackToHome('ResultsRelay.expec');
});

it('links source pages and actual declaration anchors directly', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('relay.expec', 'use Payload from "./models/payload.expec"\nfunction deliver(value: Payload) returns Nothing');
  docs.sourceFile('models/payload.expec', 'type Payload { text: Text }');
  await docs.generateFrom('relay.expec');
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/models/payload.md', 'docs/specification/pages/relay.md']);
  docs.expectHomeLinks(['pages/models/payload.md', 'pages/relay.md']);
  docs.expectDeclarationLink('deliver', 'Payload', { relativePath: 'models/payload.md', anchorOf: 'Payload' });
  await docs.search('Payload');
  docs.expectIncomingFrom('deliver.value');
  await docs.search('deliver');
  docs.expectOutgoingTo('Payload');
  docs.expectNavigationIsNotSemanticUse('Home.md');
  docs.expectAllGeneratedLinksResolve();
});

it('keeps attached examples on their actual source page without duplicating them', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('shopping.expec', 'concept Shopping {}\nexamples for Shopping from "./shopping.examples.expec"');
  docs.sourceFile('shopping.examples.expec', 'examples { example "one copy": 1 => 1 }');
  await docs.generateFrom('shopping.expec');
  docs.expectSubjectInFile('one copy', 'docs/specification/pages/shopping.examples.md');
  docs.expectDeclarationCount('one copy', 1);
  docs.expectExample('one copy', { actual: '1', expected: '1' });
  docs.expectHomeLinks(['pages/shopping.examples.md', 'pages/shopping.md']);
  docs.expectAllGeneratedLinksResolve();
});

it('always creates Home and an empty entry page without inventing semantic subjects', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('empty.expec', '');
  await docs.generateFrom('empty.expec');
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/empty.md']);
  docs.expectHomeLinks(['pages/empty.md']);
  docs.expectNoInventedSemanticSubjects();
});

it('includes an empty supplied dependency and an include-only entry', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('entry.expec', 'include "./empty.expec"');
  docs.sourceFile('empty.expec', '');
  await docs.generateFrom('entry.expec');
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/empty.md', 'docs/specification/pages/entry.md']);
  docs.expectHomeLinks(['pages/empty.md', 'pages/entry.md']);
  docs.expectNoInventedSemanticSubjects();
  docs.expectAllGeneratedLinksResolve();
});

it('keeps a source named Home distinct from its always-generated index', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('Home.expec', 'concept Dashboard {}');
  await docs.generateFrom('Home.expec');
  docs.expectSubjectInFile('Dashboard', 'docs/specification/pages/Home.md');
  docs.expectHomeLinks(['pages/Home.md']);
  docs.expectAllGeneratedLinksResolve();
});

it('retains optional inputs, authored defaults and visibility in compact leaf entries', async () => {
  const docs = new MarkdownWikiExamples();
  docs.source(`type Note { text: Text }
concept Library {
 public open
 capability open(note: Note?, title: Text = "Dune") returns Nothing
 capability reset() returns Nothing
}`);
  await docs.generate();
  docs.expectInputEntries('Library.open', [{ name: 'note', type: 'Note?' }, { name: 'title', type: 'Text', default: '"Dune"' }]);
  docs.expectPublicCapabilities('Library', ['open']);
  docs.expectInternalDeclarations('Library', ['reset']);
  docs.expectNoRepeatedWarningsOrInputs('Library.open');
  docs.expectInputFragmentOwnsTypeLink('Library.open.note', 'Note');
});

it('adds only new sections and generated navigation during an eligible insertion', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'concept Library {}');
  await docs.generateFrom('library.expec');
  docs.rememberSectionBytes('Library');
  await docs.replacePageNotes('library.expec', '## Your notes\r\n\r\nKeep 📚 backups.\r\n');
  docs.rememberPageNotesBytes('library.expec');
  docs.sourceFile('library.expec', 'concept Library {}\ntype Book { title: Text }');
  await docs.insertFrom('library.expec');
  docs.expectRememberedSectionBytes('Library');
  docs.expectPageSections('library.expec', ['Library', 'Book']);
  docs.expectTableOfContents('library.expec', ['Library', 'Book']);
  docs.expectRememberedPageNotesBytes('library.expec');
  docs.expectAllGeneratedLinksResolve();
});

it('removes one declaration without losing its sibling, source-page notes or Home', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'type Book { title: Text }\nconcept Library {}');
  await docs.generateFrom('library.expec');
  await docs.replacePageNotes('library.expec', '## Your notes\n\nKeep this source page.\n');
  docs.rememberPageNotesBytes('library.expec');
  docs.sourceFile('library.expec', 'concept Library {}');
  await docs.updateFrom('library.expec', { retire: ['Book'] });
  docs.expectPageSections('library.expec', ['Library']);
  docs.expectTableOfContents('library.expec', ['Library']);
  docs.expectRememberedPageNotesBytes('library.expec');
  docs.expectHomeLinks(['pages/library.md']);
});

it('does not authorize deleting a shared source page from one semantic subject', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'type Book { title: Text }\nconcept Library {}');
  await docs.generateFrom('library.expec');
  docs.rememberAllProjectBytes();
  await docs.deleteSubject('Library');
  docs.expectProblem('nested-delete');
  docs.expectAllProjectBytesUnchanged();
  docs.expectHomeLinks(['pages/library.md']);
});

it('retains Home when the last clean source-page representation is deliberately deleted', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'concept Library {}');
  await docs.generateFrom('library.expec');
  await docs.deleteSubject('Library');
  docs.expectFiles(['docs/specification/Home.md']);
  docs.expectHomeLinks([]);
  docs.expectNoDeclaration('Library');
});

it('keeps equal basenames distinct using their stable relative source folders', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('entry.expec', 'include "./first/book.expec"\ninclude "./second/book.expec"');
  docs.sourceFile('first/book.expec', 'type FirstBook { title: Text }');
  docs.sourceFile('second/book.expec', 'type SecondBook { title: Text }');
  await docs.generateFrom('entry.expec');
  docs.expectSubjectInFile('FirstBook', 'docs/specification/pages/first/book.md');
  docs.expectSubjectInFile('SecondBook', 'docs/specification/pages/second/book.md');
  docs.expectAllGeneratedLinksResolve();
});

it('refuses supplied source identities that collide at one native destination', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('book.expec', 'include "book"\ntype FirstBook { title: Text }');
  docs.sourceFile('book', 'type SecondBook { title: Text }');
  await docs.planFrom('book.expec');
  docs.expectProblemAt('output-conflict', 'docs/specification/pages/book.md');
  docs.expectNoPlanAndNoWrites();
});

it('does not invent a local page path for a remote source identity', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('https://example.com/library.expec', 'concept Library {}');
  await docs.planFrom('https://example.com/library.expec');
  docs.expectProblem('invalid-source-layout');
  docs.expectNoPlanAndNoWrites();
});

it('does not hide a handwritten same-page anchor link as generated navigation', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'type Book { title: Text }\nconcept Library {}');
  await docs.generateFrom('library.expec');
  await docs.writePageNotesLink('library.expec', 'Book');
  docs.rememberAllProjectBytes();
  docs.sourceFile('library.expec', 'concept Library {}');
  await docs.planUpdateFrom('library.expec', { retire: ['Book'] });
  docs.expectProblemAt('output-conflict', 'docs/specification/pages/library.md');
  docs.expectNoPlanAndNoWrites();
  docs.expectAllProjectBytesUnchanged();
});

it('previews exactly the generated regions when using the same identified specification', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'type Book { title: Text }\nconcept Library {}');
  await docs.identifyFrom('library.expec');
  await docs.previewIdentifiedRegistration();
  docs.rememberPreviewDocuments();
  await docs.generateIdentified();
  docs.expectGeneratedRegionsEqualRememberedPreview();
  docs.expectAllGeneratedLinksResolve();
});

it('public preview exposes the same readable source pages with its own valid identities', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'type Book { title: Text }\nconcept Library {}');
  await docs.previewFrom('library.expec');
  docs.expectPreviewPages(['docs/specification/Home.md', 'docs/specification/pages/library.md']);
  docs.expectPreviewSections('library.expec', ['Book', 'Library']);
  docs.expectAllPreviewLinksResolve();
});
