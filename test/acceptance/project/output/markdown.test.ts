import { describe, it } from 'vitest';
import { MarkdownExamples } from '../../../dsl/project/output/markdown.js';
import { MarkdownWikiExamples } from '../../../dsl/project/output/markdown-wiki.js';

describe('a reader can understand the promised software', () => {
  it('documents the same contract as the summary without waiting for code output', async () => {
    const docs = new MarkdownExamples();
    docs.source(`type Snapshot { title: Text }
concept StoreGame {
  depends on Snapshot
  public saveGame
  capability saveGame(snapshot: Snapshot) returns Nothing {
    promises "Save the snapshot to a Supabase database."
  }
}`);
    await docs.generateWith('markdown', 'contract-list');
    docs.expectSignatureIn('markdown', 'StoreGame.saveGame', ['snapshot: Snapshot'], 'Nothing');
    docs.expectSignatureIn('contract-list', 'StoreGame.saveGame', ['snapshot: Snapshot'], 'Nothing');
    docs.expectPromise('StoreGame.saveGame', 'Save the snapshot to a Supabase database.');
    docs.expectContractDeclaration('StoreGame.saveGame');
    docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/main.md']);
  });

  it('keeps omitted results different from an explicit no-value result', async () => {
    const docs = new MarkdownExamples();
    docs.source('function unspecified()\nfunction noValue() returns Nothing');
    await docs.generate();
    docs.expectResult('unspecified', 'Result unspecified');
    docs.expectResult('noValue', 'Nothing (no value)');
    docs.expectContractDeclaration('unspecified');
  });

  it('shows construction, packages and internal declarations without making them public', async () => {
    const docs = new MarkdownExamples();
    docs.source(`type Config { brightness: Number }
concept StoreGame {
  depends on Config
  requires package "vite" for build
  construction(config: Config)
  public start
  capability start() returns Nothing
  capability reset() returns Nothing
  local type Cache { size: Number }
}`);
    docs.package('vite', ['build']);
    await docs.generate();
    docs.expectConstruction('StoreGame', ['config: Config']);
    docs.expectPackageRequirement('StoreGame', 'vite', 'build');
    docs.expectPublicCapabilities('StoreGame', ['start']);
    docs.expectInternalDeclarations('StoreGame', ['reset', 'Cache']);
    docs.expectNoClaim('vite is installed');
  });

  it('preserves generics, aliases, optional fields and defaults as declarations', async () => {
    const docs = new MarkdownExamples();
    docs.source(`type Box<T> { value: T }
type Pair<T> = [T, T]
type Book {
  title: Text
  copies: Number = 1
  note: Text?
}
opaque type Secret`);
    await docs.generate();
    docs.expectType('Box', 'type Box<T>', ['value: T']);
    docs.expectAlias('Pair', 'Pair<T>', '[T, T]');
    docs.expectType('Book', 'type Book', ['title: Text', 'copies: Number = 1', 'note: Text?']);
    docs.expectOpaque('Secret', 'Structure unavailable');
  });

  it('shows conditions without turning them into implementation or test results', async () => {
    const docs = new MarkdownExamples();
    docs.source('function double(value: Number) returns Number {\nrequires value >= 0\nensures result == value * 2\n}');
    await docs.generate();
    docs.expectConditions('double', ['requires value >= 0', 'ensures result == value * 2']);
    docs.expectContractDeclaration('double');
    docs.expectNoRuntimeVerification();
  });

  it('keeps error codes and payload separate from normal completion', async () => {
    const docs = new MarkdownExamples();
    docs.source(`type Account { id: Text }
error type AccountError {
  code: "duplicate-account" | "invalid-account"
  email: Text
  explanation: Text?
}
function createAccount(email: Text) returns Account fails with AccountError`);
    await docs.generate();
    docs.expectError('AccountError', ['duplicate-account', 'invalid-account'], ['email: Text', 'explanation: Text?']);
    docs.expectSignature('createAccount', ['email: Text'], 'Account');
    docs.expectFailures('createAccount', ['AccountError']);
    docs.expectLinkTo('createAccount', 'May fail with', 'AccountError');
    docs.expectNoClaim('throws a Java exception');
  });

  it('retains instantiated failure spelling and does not promise exception freedom', async () => {
    const docs = new MarkdownExamples();
    docs.source(`error type Rejected<T> { code: "rejected"\npayload: T }
type TextRejection = Rejected<Text>
function save() returns Nothing fails with TextRejection
function start() returns Nothing`);
    await docs.generate();
    docs.expectType('Rejected', 'error type Rejected<T>', ['code: "rejected"', 'payload: T']);
    docs.expectAlias('TextRejection', 'TextRejection', 'Rejected<Text>');
    docs.expectFailures('save', ['TextRejection']);
    docs.expectFailureStatement('start', 'No domain failures declared');
  });
});

describe('examples retain observations, expectations and obligations', () => {
  it('documents the available book scenario with its real observation and expected quantity', async () => {
    const docs = new MarkdownExamples();
    docs.source(`concept Shopping {}
examples for Shopping {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation quantity(title: Text) returns Number
  scenario "add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then quantity("Dune") == 1
  }
  example "one copy": quantity("Dune") => 1
}`);
    await docs.generate();
    docs.expectSteps('add an available book', ['given bookIsAvailable("Dune")', 'given startWithEmptyBasket()', 'when addBook("Dune")', 'then quantity("Dune") == 1']);
    docs.expectExample('one copy', { actual: 'quantity("Dune")', expected: '1' });
    docs.expectAuthoredExample('add an available book');
    docs.expectImplementationRequired('quantity');
    docs.expectCallLink('quantity("Dune")', 'quantity');
    docs.expectSubjectInFile('add an available book', 'docs/specification/pages/main.md');
  });

  it('changes the authored expected quantity without replacing the observation', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Shopping {}\nexamples for Shopping { observation quantity(title: Text) returns Number\nexample "one copy": quantity("Dune") => 1 }');
    await docs.generate();
    docs.source('concept Shopping {}\nexamples for Shopping { observation quantity(title: Text) returns Number\nexample "one copy": quantity("Dune") => 2 }');
    await docs.update();
    docs.expectExample('one copy', { actual: 'quantity("Dune")', expected: '2' });
    docs.expectAuthoredExample('one copy');
  });

  it('does not evaluate an arithmetically false example', async () => {
    const docs = new MarkdownExamples();
    docs.source('examples { example "square": 8 * 8 => 65 }');
    await docs.generate();
    docs.expectExample('square', { actual: '8 * 8', expected: '65' });
    docs.expectAuthoredExample('square');
    docs.expectNoRuntimeVerification();
  });

  it('keeps prose unfinished even beside a purported passing report', async () => {
    const docs = new MarkdownExamples();
    docs.source('examples { example "durable basket": 1 => satisfies "Survives restart." }');
    await docs.write('test-results.json', '{"title":"durable basket","status":"passed"}');
    await docs.generate();
    docs.expectProse('durable basket', 'Survives restart.');
    docs.expectProseExpectation('durable basket');
    docs.expectNoRuntimeVerification();
    docs.expectNoFilesIn(['test/dsl', 'test/driver']);
  });

  it('documents an authored check body without inventing its runtime observation', async () => {
    const docs = new MarkdownExamples();
    docs.source(`examples {
  observation quantity(title: Text) returns Number
  check expectQuantity(title: Text, expected: Number) {
    let actual = quantity(title)
    assert actual == expected
  }
  action add(title: Text)
  scenario "Dune quantity" {
    when add("Dune")
    then expectQuantity("Dune", 1)
  }
}`);
    await docs.generate();
    docs.expectStatements('expectQuantity', ['let actual = quantity(title)', 'assert actual == expected']);
    docs.expectAuthoredOperationBody('expectQuantity');
    docs.expectImplementationRequired('quantity');
    docs.expectCallLink('quantity(title)', 'quantity');
    docs.expectNoRuntimeVerification();
  });

  it('preserves data expressions and ordered operations without expanding them', async () => {
    const docs = new MarkdownExamples();
    docs.source(`type Book { title: Text }
function normalize(title: Text) returns Text
function persist(title: Text) returns Nothing
examples {
  fixture book: Book = Book { title: "Dune" }
  action save(title: Text) returns Text {
    let clean = normalize(title)
    do persist(clean)
    return clean
  }
}`);
    await docs.generate();
    docs.expectFixture('book', 'Book', 'Book { title: "Dune" }');
    docs.expectStatus('book', 'Reusable data — not materialized');
    docs.expectStatements('save', ['let clean = normalize(title)', 'do persist(clean)', 'return clean']);
    docs.expectCallLink('persist(clean)', 'persist');
  });

  it('distinguishes an explicit empty action from a bodyless obligation', async () => {
    const docs = new MarkdownExamples();
    docs.source('examples { action noWork() returns Nothing {}\naction implementMe() returns Nothing }');
    await docs.generate();
    docs.expectStatements('noWork', []);
    docs.expectAuthoredOperationBody('noWork');
    docs.expectImplementationRequired('implementMe');
  });

  it('renders recursive operation calls as links without expanding an infinite document', async () => {
    const docs = new MarkdownExamples();
    docs.source('examples { action repeat() returns Nothing { do repeat() } }');
    await docs.generate();
    docs.expectDeclarationCount('repeat', 1);
    docs.expectStatements('repeat', ['do repeat()']);
    docs.expectCallLink('repeat()', 'repeat');
    docs.expectNoRuntimeVerification();
  });

  it('preserves captures and messages as authored communication', async () => {
    const docs = new MarkdownExamples();
    docs.source(`type Receipt { saved: Boolean }
concept Screen { public show\ncapability show(receipt: Receipt) returns Nothing }
concept Storage { public save\ncapability save() returns Receipt }
interaction "save game"() {
  participant screen: Screen
  participant storage: Storage
  message screen -> storage.save() as receipt
  message storage -> screen.show(receipt)
}
examples { action save() returns Receipt
  scenario "saved" { when receipt = save()\nthen receipt.saved == true }
}`);
    await docs.generate();
    docs.expectMessages('save game', ['screen -> storage.save() as receipt: Receipt', 'storage -> screen.show(receipt)']);
    docs.expectStatus('save game', 'Declared communication — not an observed execution.');
    docs.expectSteps('saved', ['when receipt = save()', 'then receipt.saved == true']);
    docs.expectCapture('saved', 'receipt', 'Receipt');
    docs.expectSubjectInFile('save game', 'docs/specification/pages/main.md');
  });
});

describe('composition remains one documented source view', () => {
  it('includes imported source declarations and attached examples once, retaining their origins', async () => {
    const docs = new MarkdownExamples();
    docs.sourceFile('entry.expec', 'include "./game.expec"\nuse Book from "./book.expec"\nexamples for Game from "./game.examples.expec"');
    docs.sourceFile('game.expec', 'concept Game {}');
    docs.sourceFile('book.expec', 'type Book { title: Text }');
    docs.sourceFile('game.examples.expec', 'examples { example "one": 1 => 1 }');
    await docs.generateFrom('entry.expec');
    docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/entry.md', 'docs/specification/pages/game.md', 'docs/specification/pages/book.md', 'docs/specification/pages/game.examples.md']);
    docs.expectDeclarationCount('Game', 1);
    docs.expectExample('one', { actual: '1', expected: '1' });
    docs.expectSubjectInFile('one', 'docs/specification/pages/game.examples.md');
    docs.expectOrigin('one', 'game.examples.expec', 1);
  });

  it('names external contracts without claiming their implementation or creating their files', async () => {
    const docs = new MarkdownExamples();
    docs.source('use send from "vendor"\nexamples { action notify() returns Nothing { do send("hello") } }');
    docs.externalFunction('vendor', 'send', ['message: Text'], 'Nothing', { body: 'unavailable' });
    await docs.generate();
    docs.expectExternalReference('send', 'vendor', 'External implementation not assessed');
    docs.expectNoFile('docs/specification/send.md');
    docs.expectNoFile('docs/specification/pages/vendor.md');
    docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/main.md']);
    docs.expectStatements('notify', ['do send("hello")']);
  });

  it('keeps anonymous example pages stable when another block is inserted', async () => {
    const docs = new MarkdownExamples();
    docs.source('examples { example "one": 1 => 1 }');
    await docs.generate();
    docs.rememberLocation('one');
    docs.source('examples { example "zero": 0 => 0 }\nexamples { example "one": 1 => 1 }');
    docs.preserveIdentityOfExamplesContaining('one');
    await docs.update();
    docs.expectLocationUnchanged('one');
    docs.expectSubjectInFile('zero', 'docs/specification/pages/main.md');
    docs.expectSubjectInFile('one', 'docs/specification/pages/main.md');
    docs.expectDistinctDeclarations('zero', 'one');
    docs.expectExample('zero', { actual: '0', expected: '0' });
  });
});

describe('generated documentation coexists with handwritten notes', () => {
  it('inserts another declaration while keeping its existing section and source-page notes unchanged', async () => {
    const docs = new MarkdownWikiExamples();
    docs.source('concept Game {}');
    await docs.generate();
    await docs.append('docs/specification/pages/main.md', '\nKeep this note.\n');
    docs.rememberSectionBytes('Game');
    docs.rememberPageNotesBytes('main.expec');
    docs.source('concept Game {}\nconcept Storage {}');
    await docs.insert();
    docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/main.md']);
    docs.expectRememberedSectionBytes('Game');
    docs.expectRememberedPageNotesBytes('main.expec');
    docs.expectApplied();
  });

  it('updates a public capability and preserves the exact handwritten bytes', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept StoreGame { public save\ncapability save() returns Nothing }');
    await docs.generate();
    await docs.replaceNotes('StoreGame', '## Your notes\r\n\r\nBackups are nightly.  \r\n');
    docs.source('concept StoreGame { public saveGame\ncapability saveGame() returns Nothing }');
    docs.renameIdentity('StoreGame.save', 'StoreGame.saveGame');
    await docs.update();
    docs.expectPublicCapabilities('StoreGame', ['saveGame']);
    docs.expectNotesBytes('StoreGame', '## Your notes\r\n\r\nBackups are nightly.  \r\n');
    await docs.update();
    docs.expectUnchanged();
  });

  it('reads the complete current file including notes and a manual generated edit', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept StoreGame {}');
    await docs.generate();
    await docs.append('docs/specification/pages/main.md', '\nOperator note: backups are nightly.\n');
    await docs.replaceFileText('docs/specification/pages/main.md', '## StoreGame', '## My current StoreGame');
    await docs.read('StoreGame');
    docs.expectReadBytesEqualFile('docs/specification/pages/main.md');
    docs.expectReadContains('## My current StoreGame');
    docs.expectReadContains('Operator note: backups are nightly.');
    await docs.update();
    docs.expectOwnershipConflict('docs/specification/pages/main.md');
    docs.expectNoWrites();
  });

  it('plans without effects and refuses to overwrite a newer handwritten edit', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    await docs.generate();
    docs.source('concept Game { capability save() returns Nothing }');
    await docs.planUpdate();
    docs.expectNoWrites();
    await docs.append('docs/specification/pages/main.md', '\nA note written after planning.\n');
    await docs.applyPlannedChangesWithRealWriter();
    docs.expectStaleWriteConflict();
    docs.expectFileContains('docs/specification/pages/main.md', 'A note written after planning.');
    docs.expectNoConfirmedAssociations();
  });

  it('retains invalid note bytes in read and refuses to splice through replacement decoding', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    await docs.generate();
    await docs.appendBytes('docs/specification/pages/main.md', [0xff, 0xfe]);
    await docs.read('Game');
    docs.expectReadBytesEqualFile('docs/specification/pages/main.md');
    docs.expectReadEndsWithBytes([0xff, 0xfe]);
    docs.expectProblem('invalid-output-document', 'docs/specification/pages/main.md');
    await docs.search('Game');
    docs.expectIncompleteCoverageAt('docs/specification/pages/main.md');
    await docs.update();
    docs.expectProblem('invalid-output-document', 'docs/specification/pages/main.md');
    docs.expectNoWrites();
  });

  it('moves an owned source page and notes while updating owned incoming links', async () => {
    const docs = new MarkdownExamples();
    docs.sourceFile('snapshot.expec', 'type Snapshot { title: Text }');
    docs.sourceFile('save.expec', 'use Snapshot from "./snapshot.expec"\nfunction save(snapshot: Snapshot) returns Nothing');
    await docs.generateFrom('save.expec');
    await docs.replaceNotes('Snapshot', '## Your notes\r\n\r\nKeep titles short.\r\n');
    docs.removeSourceFile('snapshot.expec');
    docs.sourceFile('player-state.expec', 'type PlayerState { title: Text }');
    docs.sourceFile('save.expec', 'use PlayerState from "./player-state.expec"\nfunction save(snapshot: PlayerState) returns Nothing');
    docs.renameIdentity('Snapshot', 'PlayerState');
    await docs.update();
    docs.expectNoFile('docs/specification/pages/snapshot.md');
    docs.expectNotesBytes('PlayerState', '## Your notes\r\n\r\nKeep titles short.\r\n');
    docs.expectLinkTo('save.snapshot', 'snapshot', 'PlayerState');
    docs.expectIdentityUnchanged('Snapshot', 'PlayerState');
  });

  it('protects a handwritten whole-page incoming link from a source-file rename', async () => {
    const docs = new MarkdownExamples();
    docs.sourceFile('snapshot.expec', 'type Snapshot { title: Text }');
    await docs.generateFrom('snapshot.expec');
    await docs.write('notes/usage.md', '[Snapshot](../docs/specification/pages/snapshot.md)');
    docs.removeSourceFile('snapshot.expec');
    docs.sourceFile('player-state.expec', 'type PlayerState { title: Text }');
    docs.renameIdentity('Snapshot', 'PlayerState');
    await docs.updateFrom('player-state.expec');
    docs.expectConflictAt('notes/usage.md');
    docs.expectNoWrites();
  });

  it('moves a nested declaration between source files without moving either page’s notes', async () => {
    const docs = new MarkdownExamples();
    docs.sourceFile('entry.expec', 'include "./draft.expec"\ninclude "./game.expec"');
    docs.sourceFile('draft.expec', 'concept Draft { capability save() returns Nothing }');
    docs.sourceFile('game.expec', 'concept Game {}');
    await docs.generateFrom('entry.expec');
    await docs.replaceNotes('Draft', '## Your notes\r\n\r\nDraft 📚 notes.\r\n');
    await docs.replaceNotes('Game', '## Your notes\n\nGame notes.\n');
    docs.sourceFile('draft.expec', 'concept Draft {}');
    docs.sourceFile('game.expec', 'concept Game { capability save() returns Nothing }');
    docs.moveIdentity('Draft.save', 'Game.save');
    await docs.update();
    docs.expectNoDeclaration('Draft.save');
    docs.expectSubjectInFile('Game.save', 'docs/specification/pages/game.md');
    docs.expectIdentityUnchanged('Draft.save', 'Game.save');
    docs.expectNotesBytes('Draft', '## Your notes\r\n\r\nDraft 📚 notes.\r\n');
    docs.expectNotesBytes('Game', '## Your notes\n\nGame notes.\n');
  });

  it('protects handwritten notes on explicit deletion and retains them when the source becomes empty', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    await docs.generate();
    await docs.append('docs/specification/pages/main.md', '\nKeep this design decision.\n');
    await docs.delete('Game');
    docs.expectProblem('handwritten-document-content', 'docs/specification/pages/main.md');
    docs.expectNoWrites();
    docs.source('');
    docs.retireIdentity('Game');
    await docs.update();
    docs.expectApplied();
    docs.expectNoDeclaration('Game');
    docs.expectFileContains('docs/specification/pages/main.md', 'Keep this design decision.');
    docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/main.md']);
  });

  it('deletes an unused page with untouched empty notes and repeats unchanged', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    await docs.generate();
    await docs.delete('Game');
    docs.expectNoFile('docs/specification/pages/main.md');
    docs.expectApplied();
    await docs.delete('Game');
    docs.expectUnchanged();
  });

  it('removes only a nested generated section and retains the containing notes', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game { public save, start\ncapability save() returns Nothing\ncapability start() returns Nothing }');
    await docs.generate();
    await docs.append('docs/specification/pages/main.md', '\nLaunch notes.\n');
    docs.source('concept Game { public start\ncapability start() returns Nothing }');
    docs.retireIdentity('Game.save');
    await docs.update();
    docs.expectPublicCapabilities('Game', ['start']);
    docs.expectNoDeclaration('Game.save');
    docs.expectFileContains('docs/specification/pages/main.md', 'Launch notes.');
  });

  it('does not adopt a copied document or repair missing ownership state', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    await docs.generate();
    await docs.copy('docs/specification/pages/main.md', 'notes/Game-copy.md');
    await docs.removeOutputState();
    await docs.read('Game');
    docs.expectReadFiles(['docs/specification/pages/main.md', 'notes/Game-copy.md']);
    docs.expectAmbiguousDefinition();
    await docs.update();
    docs.expectOwnershipConflict();
    docs.expectNoWrites();
  });

  it('reports actual partial effects when the ownership-state write fails', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    docs.failActualWriteOfOutputState();
    await docs.generate();
    docs.expectStoppedReceiptWithCreatedFile('docs/specification/pages/main.md');
    docs.expectNoConfirmedAssociations();
    docs.restoreFileWrites();
    await docs.generate();
    docs.expectOwnershipConflict('docs/specification/pages/main.md');
  });
});

describe('search asks what the documentation currently says', () => {
  it('keeps both Markdown output namespaces searchable in the same project', async () => {
    const docs = new MarkdownExamples();
    docs.source('type Snapshot { title: Text }\nfunction save(snapshot: Snapshot) returns Nothing');
    await docs.generateWith('markdown', 'contract-list');
    await docs.searchIn('markdown', 'save');
    docs.expectDefinitionInOutput('markdown', 'save');
    docs.expectOutgoingTo('Snapshot');
    docs.expectCompleteWithinMarkdownScope();
    await docs.searchIn('contract-list', 'save');
    docs.expectDefinitionInOutput('contract-list', 'save');
    docs.expectOutgoingTo('Snapshot');
    docs.expectCompleteWithinMarkdownScope();
    docs.expectNoDuplicateDefinitionAcrossOutputNamespaces();
  });

  it('finds new unmodeled consumers and real page-note links after opening', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}\nconcept Storage {}');
    await docs.generate();
    await docs.writeReferenceLink('notes/launcher.md', 'game', 'Game');
    await docs.appendLinkInNotes('Game', 'Storage', 'Storage');
    await docs.search('Game');
    docs.expectIncomingFromProjectFile('notes/launcher.md');
    docs.expectNoOutgoingTo('Storage');
    docs.expectCompleteWithinMarkdownScope();
    await docs.search('Storage');
    docs.expectIncomingFromProjectFile('docs/specification/pages/main.md');
    await docs.replaceNoteLinkWithText('Game', 'Storage', 'Storage');
    await docs.search('Storage');
    docs.expectNoIncomingFromProjectFile('docs/specification/pages/main.md');
  });

  it('does not turn fenced examples or authored prose into reference edges', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}\nfunction intent() { promises "[Game](Game.md)" }');
    await docs.generate();
    await docs.write('notes/sample.md', '```md\n[Game](../docs/specification/pages/main.md)\n```');
    await docs.search('Game');
    docs.expectNoIncomingFrom('intent');
    docs.expectNoIncomingFromProjectFile('notes/sample.md');
    docs.expectPromise('intent', '[Game](Game.md)');
  });

  it('keeps nested outgoing links separate from sibling links and root notes', async () => {
    const docs = new MarkdownExamples();
    docs.source('type Snapshot { title: Text }\ntype Config { value: Number }\nconcept Game { public save, start\ncapability save(snapshot: Snapshot) returns Nothing\ncapability start(config: Config) returns Nothing }');
    await docs.generate();
    await docs.appendLinkInNotes('Game', 'Config', 'Config');
    await docs.search('Game.save');
    docs.expectOutgoingTo('Snapshot');
    docs.expectNoOutgoingTo('Config');
    await docs.search('Game');
    docs.expectOutgoingTo('Snapshot');
    docs.expectOutgoingTo('Config');
  });

  it('protects a removed member anchor referenced from handwritten notes', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game { public save\ncapability save() returns Nothing }');
    await docs.generate();
    await docs.appendLinkInNotes('Game', 'Keep the save contract', 'Game.save');
    docs.source('concept Game {}');
    docs.retireIdentity('Game.save');
    await docs.update();
    docs.expectConflictAt('docs/specification/pages/main.md');
    docs.expectNoWrites();
  });

  it('does not authorize deletion from zero uses with incomplete Markdown coverage', async () => {
    const docs = new MarkdownExamples();
    docs.source('concept Game {}');
    await docs.generate();
    await docs.write('notes/html.md', '<a href="../docs/specification/pages/main.md">Game</a>');
    await docs.search('Game');
    docs.expectIncompleteCoverageAt('notes/html.md');
    await docs.delete('Game');
    docs.expectProblem('incomplete-output-search');
    docs.expectNoWrites();
  });
});


describe('compact readable leaf definitions', () => {
it('keeps an input independently readable and searchable without another heading', async () => {
  const docs = new MarkdownExamples();
  docs.source('type Snapshot { title: Text }\nfunction save(snapshot: Snapshot) returns Nothing');
  await docs.generate();
  docs.expectCompactLeaf('save.snapshot', 'snapshot: Snapshot');
  await docs.read('save.snapshot');
  docs.expectReadBytesEqualFile('docs/specification/pages/main.md');
  await docs.search('save.snapshot');
  docs.expectDefinitionInOutput('markdown', 'save.snapshot');
  docs.expectOutgoingTo('Snapshot');
  docs.expectCompleteWithinMarkdownScope();
});

it('attributes a leaf’s links only to that input and its containing declaration', async () => {
  const docs = new MarkdownExamples();
  docs.source('type Snapshot { title: Text }\ntype Config { value: Number }\nfunction save(snapshot: Snapshot, config: Config) returns Nothing');
  await docs.generate();
  await docs.search('save.snapshot');
  docs.expectOutgoingTo('Snapshot');
  docs.expectNoOutgoingTo('Config');
  await docs.search('save.config');
  docs.expectOutgoingTo('Config');
  docs.expectNoOutgoingTo('Snapshot');
  await docs.search('save');
  docs.expectOutgoingTo('Snapshot');
  docs.expectOutgoingTo('Config');
});

it('keeps section-only and foreign-fragment namespaces valid together', async () => {
  const docs = new MarkdownExamples();
  docs.source('type Snapshot { title: Text }\nfunction save(snapshot: Snapshot) returns Nothing');
  await docs.generateWith('markdown', 'contract-list');
  await docs.searchIn('contract-list', 'save.snapshot');
  docs.expectDefinitionInOutput('contract-list', 'save.snapshot');
  docs.expectOutgoingTo('Snapshot');
  docs.expectCompleteWithinMarkdownScope();
  await docs.searchIn('markdown', 'save.snapshot');
  docs.expectDefinitionInOutput('markdown', 'save.snapshot');
  docs.expectCompleteWithinMarkdownScope();
  docs.expectNoDuplicateDefinitionAcrossOutputNamespaces();
});

it('does not claim complete leaf coverage after its actual anchor is removed', async () => {
  const docs = new MarkdownExamples();
  docs.source('function save(count: Number) returns Nothing');
  await docs.generate();
  await docs.removeActualAnchor('save.count');
  await docs.search('save.count');
  docs.expectIncompleteCoverageAt('docs/specification/pages/main.md');
  docs.expectProblem('invalid-output-document', 'docs/specification/pages/main.md');
  await docs.update();
  docs.expectOwnershipConflict('docs/specification/pages/main.md');
  docs.expectNoWrites();
});

it('does not accept two actual anchors claiming one leaf definition', async () => {
  const docs = new MarkdownExamples();
  docs.source('function save(count: Number) returns Nothing');
  await docs.generate();
  await docs.duplicateActualAnchor('save.count');
  await docs.search('save.count');
  docs.expectIncompleteCoverageAt('docs/specification/pages/main.md');
  docs.expectProblem('invalid-output-document', 'docs/specification/pages/main.md');
  await docs.update();
  docs.expectOwnershipConflict('docs/specification/pages/main.md');
  docs.expectNoWrites();
});

});

