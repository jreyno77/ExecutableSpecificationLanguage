import { it } from 'vitest';
import { MarkdownWikiExamples } from '../../../dsl/project/output/markdown-wiki.js';

it('shows architectural siblings in source order before all data kinds', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('design.expec', `type Payload { text: Text }
concept Screen {}
type Title = Text
class Session {}
error type SendFailure { code: "unavailable" }
interface Port {}
opaque type Token
function normalize(title: Title) returns Payload
component Relay {}`);
  await docs.generateFrom('design.expec');
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/design.md']);
  docs.expectPageSections('design.expec', ['Screen', 'Session', 'Port', 'normalize', 'Relay', 'Glossary']);
  docs.expectGlossary('design.expec', ['Payload', 'Title', 'SendFailure', 'Token']);
  docs.expectGlossaryNavigation('design.expec', 'Payload');
  docs.expectSignature('normalize', ['title: Title'], 'Payload');
  docs.expectDeclarationLink('normalize', 'Payload', { relativePath: '', anchorOf: 'Payload' });
  docs.expectHomeLinks(['pages/design.md']);
  docs.expectAllGeneratedLinksResolve();
  docs.expectNoRuntimeVerification();
});

it('moves deeply local data to the glossary without losing identity or visibility', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', `concept Library {
  local type State { copies: Number }
  local concept Cache {
    local opaque type Token
    capability load() returns Token
  }
  capability current() returns State
}
concept Queue {
  local type State { waiting: Number }
  capability depth(state: State) returns Number
}`);
  await docs.identifyFrom('library.expec');
  docs.rememberSourceIdentity('Library.State');
  await docs.previewIdentifiedRegistration();
  docs.rememberPreviewDocuments();
  await docs.generateIdentified();
  docs.expectPageSections('library.expec', ['Library', 'Queue', 'Glossary']);
  docs.expectGlossary('library.expec', ['Library.State', 'Library.Cache.Token', 'Queue.State']);
  docs.expectGlossaryNavigation('library.expec', 'Library.State');
  docs.expectInternalDeclarations('Library', ['State', 'Cache', 'current']);
  docs.expectSignature('Library.current', [], 'State');
  docs.expectOrigin('Library.State', 'library.expec', 2);
  docs.expectRetainedSourceIdentity('Library.State', 'library.expec');
  docs.expectDeclarationCount('Library.State', 1);
  docs.expectDeclarationCount('Library.Cache.Token', 1);
  docs.expectGeneratedRegionsEqualRememberedPreview();
  docs.expectAllGeneratedLinksResolve();
});

it('keeps a capability contract and its same-source examples together', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('relay.expec', `type Payload { text: Text }
error type DeliveryFailure { code: "unavailable" }
component Courier {
  public ship
  capability ship(payload: Payload) returns Nothing
}
component Relay {
  public send, retry
  capability send(payload: Payload) returns Nothing fails with DeliveryFailure {
    promises "Deliver the supplied payload."
    calls Courier.ship
  }
  capability retry() returns Nothing
}
examples for Relay.send {
  observation deliveredCount() returns Number
  example "one delivery": deliveredCount() => 1
}`);
  await docs.generateFrom('relay.expec');
  docs.expectSignature('Relay.send', ['payload: Payload'], 'Nothing');
  docs.expectPromise('Relay.send', 'Deliver the supplied payload.');
  docs.expectDeclaredCalls('Relay.send', ['Courier.ship']);
  docs.expectFailures('Relay.send', ['DeliveryFailure']);
  docs.expectExample('one delivery', { actual: 'deliveredCount()', expected: '1' });
  docs.expectExamplesGroupedWith('Relay.send', ['one delivery'], { before: 'Relay.retry' });
  docs.expectDeclarationCount('one delivery', 1);
  docs.expectDeclarationLink('Relay.send', 'Courier.ship', { relativePath: '', anchorOf: 'Courier.ship' });
  docs.expectDeclarationLink('Relay.send', 'DeliveryFailure', { relativePath: '', anchorOf: 'DeliveryFailure' });
  docs.expectAllGeneratedLinksResolve();
  docs.expectNoRuntimeVerification();
});

it('links an attached example without moving it from its source page', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('relay.expec', `component Relay {
  public send
  capability send() returns Nothing
}
examples for Relay.send from "./relay.examples.expec"`);
  docs.sourceFile('relay.examples.expec', 'examples { example "one delivery": 1 => 1 }');
  await docs.generateFrom('relay.expec');
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/relay.md', 'docs/specification/pages/relay.examples.md']);
  docs.expectLinkedExamples('Relay.send', 'relay.examples.expec', ['one delivery']);
  docs.expectSubjectInFile('one delivery', 'docs/specification/pages/relay.examples.md');
  docs.expectOrigin('one delivery', 'relay.examples.expec', 1);
  docs.expectDeclarationCount('one delivery', 1);
  docs.expectAllGeneratedLinksResolve();
});

it('retains the original owner of links inside a relocated local type', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', `type Payload { text: Text }
concept Library {
  local type State { value: Payload }
}`);
  await docs.generateFrom('library.expec');
  docs.expectGlossary('library.expec', ['Payload', 'Library.State']);
  await docs.search('Library');
  docs.expectOutgoingTo('Payload');
  await docs.search('Payload');
  docs.expectIncomingFrom('Library.State.value');
  docs.expectAllGeneratedLinksResolve();
});

it('retains whole-page deletion eligibility for one contract with local data', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'concept Library { local type State { copies: Number } }');
  await docs.generateFrom('library.expec');
  docs.expectGlossary('library.expec', ['Library.State']);
  await docs.deleteSubject('Library');
  docs.expectFiles(['docs/specification/Home.md']);
  docs.expectHomeLinks([]);
  docs.expectNoDeclaration('Library');
});

it('preserves exact source-page notes through a glossary update', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'concept Library { local type State { copies: Number } }');
  await docs.generateFrom('library.expec');
  docs.rememberSourceIdentity('Library.State');
  await docs.replacePageNotes('library.expec', '## Your notes\r\n\r\nKeep 📚 backups.\r\n');
  docs.rememberPageNotesBytes('library.expec');
  docs.sourceFile('library.expec', 'concept Library { local type State { copies: Number\n title: Text } }');
  await docs.updateFrom('library.expec');
  docs.expectGlossary('library.expec', ['Library.State']);
  docs.expectType('Library.State', 'type State', ['copies: Number', 'title: Text']);
  docs.expectRetainedSourceIdentity('Library.State', 'library.expec');
  docs.expectRememberedPageNotesBytes('library.expec');
  docs.expectAllGeneratedLinksResolve();
});

it('refuses to insert a changed local type without rewriting its source page', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'concept Library { local type State { copies: Number } }');
  await docs.generateFrom('library.expec');
  docs.sourceFile('library.expec', 'concept Library { local type State { copies: Text } }');
  await docs.insertFrom('library.expec');
  docs.expectProblem('not-addition-only');
  docs.expectNoWrites();
});

it('refuses to insert a changed local alias without rewriting its source page', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('library.expec', 'concept Library { local type Count = Number }');
  await docs.generateFrom('library.expec');
  docs.rememberSourceIdentity('Library.Count');
  docs.sourceFile('library.expec', 'concept Library { local type Count = Text }');
  docs.renameIdentity('Library.Count', 'Library.Count');
  await docs.insertFrom('library.expec');
  docs.expectRetainedSourceIdentity('Library.Count', 'library.expec');
  docs.expectProblem('not-addition-only');
  docs.expectNoWrites();
});
