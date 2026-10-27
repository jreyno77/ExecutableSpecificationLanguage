import { describe, it } from 'vitest';
import { DiagramExamples } from '../../../dsl/project/output/diagrams.js';

describe('readable declared diagrams', { timeout: 30_000 }, () => {
  it('shows inputs, outputs and dependencies as distinct declared roles', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('opaque type Config\nopaque type Snapshot\nopaque type Storage\nconcept StoreGame {\ndepends on Storage\npublic startup, save\ncapability startup(config: Config) returns Snapshot\ncapability save(snapshot: Snapshot) returns Nothing\n}');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectDeclaration('StoreGame', 'concept');
    diagrams.expectRole({ from: 'Config', to: 'StoreGame', role: 'input', label: 'startup.config: Config' });
    diagrams.expectRole({ from: 'StoreGame', to: 'Snapshot', role: 'output', label: 'startup result: Snapshot' });
    diagrams.expectRole({ from: 'Snapshot', to: 'StoreGame', role: 'input', label: 'save.snapshot: Snapshot' });
    diagrams.expectRole({ from: 'StoreGame', to: 'Storage', role: 'dependency' });
    diagrams.expectNoOwnershipDiamonds(); diagrams.expectNoSequenceFiles();
  });
  it('retains a second role when one of two reciprocal inputs is removed', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept X { public accept\ncapability accept(y: Y) returns Nothing }\nconcept Y { public accept\ncapability accept(x: X) returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'Y', to: 'X', role: 'input' }); diagrams.expectRole({ from: 'X', to: 'Y', role: 'input' });
    diagrams.revise('concept X { public accept\ncapability accept() returns Nothing }\nconcept Y { public accept\ncapability accept(x: X) returns Nothing }', ['X.accept.y']);
    await diagrams.update();
    diagrams.expectNoRole({ from: 'Y', to: 'X', role: 'input' }); diagrams.expectRole({ from: 'X', to: 'Y', role: 'input' });
  });
  it('does not make unspecified result information into Nothing', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store { public save, stop\ncapability save()\ncapability stop() returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectSignature('Store.save', 'save() → unspecified'); diagrams.expectSignature('Store.stop', 'stop() → Nothing');
  });
  it('shows error data and possible failures without changing the successful result', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Account { id: Text }\nerror type Rejected { code: "duplicate-account"\nemail: Text }\nfunction create(email: Text) returns Account fails with Rejected');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectDeclaration('Rejected', 'error type'); diagrams.expectField('Rejected', 'code', '"duplicate-account"'); diagrams.expectField('Rejected', 'email', 'Text');
    diagrams.expectRole({ from: 'create', to: 'Rejected', role: 'failure' }); diagrams.expectRole({ from: 'create', to: 'Account', role: 'output' });
    diagrams.expectNoRuntimeFailureClaim();
  });
  it('refuses to invent a sequence from dependencies', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('opaque type Storage\nconcept StoreGame { depends on Storage }');
    await diagrams.create({ views: ['interactions'] });
    diagrams.expectProblem('missing-interaction'); diagrams.expectNoProjectChanges();
  });
});
describe('the structure view keeps readable type meaning', { timeout: 30_000 }, () => {
  it('retains generic wrappers and distinct roles between the same declarations', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Book { title: Text }\nconcept Library { public add, find\ncapability add(books: List<Book>) returns Nothing\ncapability find(title: Text) returns Book? }');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectSignature('Library.add', 'add(books: List<Book>) → Nothing');
    diagrams.expectSignature('Library.find', 'find(title: Text) → Book?');
    diagrams.expectRole({ from: 'Book', to: 'Library', role: 'input', label: 'input type: add.books: List<Book>' });
    diagrams.expectRole({ from: 'Library', to: 'Book', role: 'output', label: 'output type: find result: Book?' });
    diagrams.expectNoDeclaration('List');
    diagrams.expectNativeEdgeCountBetween('Book', 'Library', 2);
  });

  it('distinguishes construction, field and alias references without claiming ownership', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Config { name: Text }\ntype Settings = Config\ntype Snapshot { config: Config }\nconcept Store { depends on Config\nconstruction(settings: Settings) }');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'Settings', to: 'Store', role: 'construction', label: 'construction input: settings: Settings' });
    diagrams.expectRole({ from: 'Snapshot', to: 'Config', role: 'field', label: 'field: config: Config' });
    diagrams.expectRole({ from: 'Settings', to: 'Config', role: 'alias', label: 'alias of Config' });
    diagrams.expectRole({ from: 'Store', to: 'Config', role: 'dependency' });
    diagrams.expectNoOwnershipDiamonds();
  });

  it('shows source kinds and public selection without turning every concept into a class', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('interface Storage { public save\ncapability save() returns Nothing\ncapability reset() returns Nothing }\ncomponent Screen {}\nopaque type Secret\ntype Pair<T> = [T, T]');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectDeclaration('Storage', 'interface');
    diagrams.expectDeclaration('Screen', 'component');
    diagrams.expectDeclaration('Secret', 'opaque type');
    diagrams.expectDeclaration('Pair', 'alias type');
    diagrams.expectSignature('Storage.save', 'save() → Nothing');
    diagrams.expectNoRenderedMember('Storage.reset');
    diagrams.expectTypeLabel('Pair', 'Pair<T> = [T, T]');
  });

  it('references a generic error payload without calling that payload an error', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Book { title: Text }\nerror type Rejected<T> { code: "rejected"\npayload: T }\nfunction save(book: Book) returns Nothing fails with Rejected<Book>');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'save', to: 'Rejected', role: 'failure', label: 'may fail with Rejected<Book>' });
    diagrams.expectRole({ from: 'save', to: 'Book', role: 'failure-type-argument', label: 'failure type argument: Book in Rejected<Book>' });
    diagrams.expectNoRole({ from: 'save', to: 'Book', role: 'failure' });
    diagrams.expectSignature('save', 'save(book: Book) → Nothing');
  });

  it('keeps display text from injecting native declarations or edges', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept `Game -> Storage` { public save\ncapability save() { promises "x -> y: surprise" } }');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectDeclaration('Game -> Storage', 'concept');
    diagrams.expectNoNativeObject('x');
    diagrams.expectNoNativeObject('y');
    diagrams.expectNativeExplicitEdgeCount(0);
    diagrams.expectUnverifiedPromise('Game -> Storage.save', 'x -> y: surprise');
    diagrams.expectNativeSvgLabel('Game -> Storage');
  });

  it('documents composed source once and labels referenced external types', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.sourceFile('entry.expec', 'include "./game.expec"\nuse Receipt from "vendor"\nfunction save() returns Receipt');
    diagrams.sourceFile('game.expec', 'concept Game {}');
    diagrams.externalRecord('vendor', 'Receipt', ['saved: Boolean']);
    await diagrams.createFrom('entry.expec', { views: ['structure'] });
    diagrams.expectDeclarationCount('Game', 1);
    diagrams.expectExternalProxy('Receipt', 'vendor');
    diagrams.expectRole({ from: 'save', to: 'Receipt', role: 'output' });
    diagrams.expectNoProjectImplementationClaim('Receipt');
  });
});

describe('sequences preserve the interaction actually authored', { timeout: 30_000 }, () => {
  it('keeps two participants of the same type as separate ordered lifelines', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Worker { public ping\ncapability ping() returns Nothing }\ninteraction "handoff"() {\nparticipant first: Worker\nparticipant second: Worker\nmessage first -> second.ping()\n}');
    await diagrams.create({ views: ['interactions'] });
    diagrams.expectParticipants('handoff', ['first: Worker', 'second: Worker']);
    diagrams.expectDistinctParticipantKeys('first', 'second');
    diagrams.expectMessages('handoff', ['first -> second: ping()']);
    diagrams.expectAuthoredMessageCount('handoff', 1);
    diagrams.expectNoOwnershipDiamonds();
  });

  it('shows a captured reply as part of the original message and preserves valid message order', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Receipt { saved: Boolean }\nconcept Screen { public show\ncapability show(receipt: Receipt) returns Nothing }\nconcept Storage { public save\ncapability save() returns Receipt }\ninteraction "save"() {\nparticipant screen: Screen\nparticipant storage: Storage\nmessage screen -> storage.save() as receipt\nmessage storage -> screen.show(receipt)\n}');
    await diagrams.create({ views: ['structure', 'interactions'] });
    diagrams.expectMessages('save', ['screen -> storage: receipt: Receipt = save()', 'storage -> screen: show(receipt)']);
    diagrams.expectAuthoredMessageCount('save', 2);
    diagrams.expectMessageOperation('save', 1, 'Storage.save');
    diagrams.expectMessageOperation('save', 2, 'Screen.show');
    diagrams.expectNoExtraReplyMessage('save');
    diagrams.expectSequenceStatement('save', 'Declared communication — not observed execution');
  });

  it('changes native sequence order when independent authored messages are reversed', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Service { public first, second\ncapability first() returns Nothing\ncapability second() returns Nothing }\ninteraction "order"() { participant caller: Service\nparticipant server: Service\nmessage caller -> server.first()\nmessage caller -> server.second() }');
    await diagrams.create({ views: ['interactions'] });
    diagrams.expectMessages('order', ['caller -> server: first()', 'caller -> server: second()']);
    diagrams.revise('concept Service { public first, second\ncapability first() returns Nothing\ncapability second() returns Nothing }\ninteraction "order"() { participant caller: Service\nparticipant server: Service\nmessage caller -> server.second()\nmessage caller -> server.first() }');
    await diagrams.update();
    diagrams.expectMessages('order', ['caller -> server: second()', 'caller -> server: first()']);
    diagrams.expectAuthoredMessageCount('order', 2);
  });

  it('keeps an interaction filename stable while updating its displayed title', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Service { public ping\ncapability ping() returns Nothing }\ninteraction "before"() { participant a: Service\nparticipant b: Service\nmessage a -> b.ping() }');
    await diagrams.create({ views: ['interactions'] });
    diagrams.rememberArtifactPaths('before');
    diagrams.revise('concept Service { public ping\ncapability ping() returns Nothing }\ninteraction "after"() { participant a: Service\nparticipant b: Service\nmessage a -> b.ping() }');
    diagrams.renameIdentity('before', 'after');
    await diagrams.update();
    diagrams.expectArtifactPathsUnchanged('after');
    diagrams.expectNativeSvgLabel('after');
  });
});


describe('native search observes current diagrams rather than saved expectations', { timeout: 30_000 }, () => {
  it('finds a real unmodeled root consumer with exact original Unicode and whitespace ranges', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.writeIndependentNative('notes/launcher.d2', {
      reference: { key: 'store', subject: 'Store' },
      source: '# 📚 original input\nstore: Store\nlauncher: Launcher\nlauncher   ->   store: "starts"\n',
    });
    await diagrams.search('Store');
    diagrams.expectProjectConsumer('notes/launcher.d2', 'launcher');
    diagrams.expectNativeEdgeSlice('notes/launcher.d2', 'launcher   ->   store');
    diagrams.expectNativeEndpointSlice('notes/launcher.d2', 'store');
    diagrams.expectOriginalRawFileRetained('notes/launcher.d2');
    diagrams.expectCompleteWithinNativeProfile();
  });

  it('sees a changed native endpoint without reconstructing the old spec dependency', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept A {}\nconcept B {}\nconcept C {}\nconcept Store { depends on A, B, C }');
    await diagrams.create({ views: ['structure'] });
    await diagrams.changeNativeDependencyEndpoint('Store', 'C', { key: 'other', label: 'Unmodeled D' });
    await diagrams.search('Store');
    diagrams.expectOutgoingTo('A');
    diagrams.expectOutgoingTo('B');
    diagrams.expectNoOutgoingTo('C');
    diagrams.expectOutgoingProjectElement('design/structure.d2', 'other');
    await diagrams.compareObservedDependencies('Store', ['A', 'B', 'C']);
    diagrams.expectDependencyComparison({ matched: ['A', 'B'], unobserved: ['C'], projectOnly: ['other'] });
  });

  it('locates an independently edited immediate class member at its actual native statement', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store { public save\ncapability save(title: Text) returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    await diagrams.replaceNativeMemberText('Store.save', '"save(title: Text)": Nothing', '"save(title: Text, mode: Text)": Nothing');
    await diagrams.search('Store.save');
    diagrams.expectDefinitionStatement('Store.save', '"save(title: Text, mode: Text)": Nothing');
    diagrams.expectDefinitionKey('Store.save', '"save(title: Text, mode: Text)"');
    diagrams.expectOriginalRangeMatchesCurrentStatement('Store.save');
    diagrams.expectNoWholeClassSubstituteForMember('Store.save');
    await diagrams.update();
    diagrams.expectOwnershipConflict('design/structure.d2');
  });

  it('does not assign every class relationship to each of its methods', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Snapshot { title: Text }\ntype Config { value: Number }\nconcept Store { public save, start\ncapability save(snapshot: Snapshot) returns Nothing\ncapability start(config: Config) returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    await diagrams.search('Store.save');
    diagrams.expectDeclaredOccurrenceReference('Store.save', 'Snapshot');
    diagrams.expectNoDeclaredOccurrenceReference('Store.save', 'Config');
    diagrams.expectDefinitionStatement('Store.save', '"save(snapshot: Snapshot)": Nothing');
  });

  it('does not resolve display labels or class field strings as native references', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Snapshot { title: Text }');
    await diagrams.create({ views: ['structure'] });
    await diagrams.write('notes/display.d2', 'other: "Snapshot" {shape: class; value: Snapshot}\n');
    await diagrams.search('Snapshot');
    diagrams.expectNoProjectConsumer('notes/display.d2', 'other');
    diagrams.expectNoDuplicateDefinition('Snapshot');
  });

  it('reports imported-member provenance as incomplete while retaining actual raw files', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.write('notes/index.d2', 'store: @parts\n');
    await diagrams.write('notes/parts.d2', 'shape: class\nname: Text\n');
    await diagrams.search('Store');
    diagrams.expectCoverageGap('notes/index.d2', 'imports');
    diagrams.expectNoInventedImportedMemberRange();
    await diagrams.delete('Store');
    diagrams.expectProblem('incomplete-output-search');
    diagrams.expectNoProjectChanges();
  });

  it('does not call an unresolved nested member endpoint a complete root-key search', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store { public save\ncapability save() returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    await diagrams.writeIndependentNative('notes/nested.d2', {
      reference: { key: 'store', subject: 'Store' },
      source: 'store: Store { save: Save }\nlauncher -> store.save: "calls"\n',
    });
    await diagrams.search('Store.save');
    diagrams.expectCoverageGap('notes/nested.d2', 'nested-endpoint');
    diagrams.expectNoGuessedMemberReferenceFromName('Store.save');
  });

  it('keeps malformed diagrams visible and refuses to infer absence of uses', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.write('notes/broken.d2', 'store: {\n shape: class\n');
    await diagrams.search('Store');
    diagrams.expectNativeProblemAt('notes/broken.d2', 1, 8);
    diagrams.expectIncompleteCoverage();
    await diagrams.delete('Store');
    diagrams.expectProblem('incomplete-output-search');
    diagrams.expectNoProjectChanges();
  });

  it('compares declared input uses without reversing the actual drawn data flow', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Snapshot { title: Text }\nconcept Store { public save\ncapability save(snapshot: Snapshot) returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'Snapshot', to: 'Store', role: 'input' });
    await diagrams.search('Store');
    diagrams.expectOutgoingTo('Snapshot');
    await diagrams.compareObservedDependencies('Store', ['Snapshot']);
    diagrams.expectDependencyComparison({ matched: ['Snapshot'], unobserved: [], projectOnly: [] });
    await diagrams.search('Snapshot');
    diagrams.expectIncomingDeclaredOccurrence('Store.save');
  });
});


describe('source and rendered artifacts evolve without losing notes', { timeout: 30_000 }, () => {
  it('returns complete actual source and SVG bytes and identifies a stale rendering', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.d2', '\n# Operator note: backups nightly.\n');
    await diagrams.read('Store');
    diagrams.expectReadFiles(['design/structure.d2', 'design/structure.svg']);
    diagrams.expectReadBytesEqualFiles();
    diagrams.expectReadContains('# Operator note: backups nightly.');
    diagrams.expectProblem('stale-diagram-render');
    diagrams.expectNoProjectChanges();
  });

  it('refreshes SVG from a note-only edit while preserving the entire D2 source bytes', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.appendNativePageNote('Store', 'Backups are nightly.', { lineEnding: '\r\n' });
    diagrams.rememberFileBytes('design/structure.d2');
    await diagrams.update();
    diagrams.expectFileBytesUnchanged('design/structure.d2');
    diagrams.expectNativeSvgLabel('Backups are nightly.');
    diagrams.expectSvgDigestMatchesActualSource('design/structure.svg', 'design/structure.d2');
    await diagrams.read('Store');
    diagrams.expectNoProblem('stale-diagram-render');
  });

  it('renames an identified capability in class and messages while keeping handwritten bytes', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store { public save\ncapability save() returns Nothing }\ninteraction "saving"() { participant caller: Store\nparticipant store: Store\nmessage caller -> store.save() }');
    await diagrams.create({ views: ['structure', 'interactions'] });
    await diagrams.append('design/structure.d2', '\n# Preserve this exact note.\r\n');
    diagrams.rememberNativeKey('Store');
    diagrams.revise('concept Store { public saveGame\ncapability saveGame() returns Nothing }\ninteraction "saving"() { participant caller: Store\nparticipant store: Store\nmessage caller -> store.saveGame() }');
    diagrams.renameIdentity('Store.save', 'Store.saveGame');
    await diagrams.update();
    diagrams.expectSignature('Store.saveGame', 'saveGame() → Nothing');
    diagrams.expectMessages('saving', ['caller -> store: saveGame()']);
    diagrams.expectNativeKeyUnchanged('Store');
    diagrams.expectFileEndsWithBytes('design/structure.d2', '\n# Preserve this exact note.\r\n');
  });

  it('inserts a new structural subject into the shared file without losing existing notes', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.d2', '\n# Keep this note.\n');
    diagrams.revise('concept Store {}\nconcept Storage {}');
    await diagrams.insert();
    diagrams.expectDeclarationCount('Store', 1);
    diagrams.expectDeclarationCount('Storage', 1);
    diagrams.expectFileEndsWithBytes('design/structure.d2', '\n# Keep this note.\n');
    diagrams.expectPlanPathsUnique();
  });

  it('removes one unused subject without deleting the shared diagram or notes', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}\nconcept Storage {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.d2', '\n# Shared design notes.\n');
    await diagrams.delete('Storage');
    diagrams.expectNoDeclaration('Storage');
    diagrams.expectDeclarationCount('Store', 1);
    diagrams.expectFileEndsWithBytes('design/structure.d2', '\n# Shared design notes.\n');
    diagrams.expectSvgDigestMatchesActualSource('design/structure.svg', 'design/structure.d2');
    await diagrams.delete('Storage');
    diagrams.expectUnchanged();
  });

  it('protects a handwritten edge even when native D2 could implicitly recreate its removed target', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.appendNativeIncoming('Store', 'launcher', 'starts');
    await diagrams.delete('Store');
    diagrams.expectConflictAt('design/structure.d2');
    diagrams.expectNoProjectChanges();
  });

  it('preserves sequence notes and refuses to delete their whole document', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store { public ping\ncapability ping() returns Nothing }\ninteraction "ping"() { participant a: Store\nparticipant b: Store\nmessage a -> b.ping() }');
    await diagrams.create({ views: ['interactions'] });
    await diagrams.appendActorNote('ping', 'b', 'Retries are undecided.');
    await diagrams.update();
    diagrams.expectNativeSvgLabel('Retries are undecided.');
    diagrams.expectAuthoredMessageCount('ping', 1);
    await diagrams.delete('ping');
    diagrams.expectProblem('handwritten-document-content');
    diagrams.expectNoProjectChanges();
  });

  it('refuses a generated-content override disguised as an outside handwritten assignment', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.appendNativeLabelOverride('Store', 'Different contract');
    await diagrams.update();
    diagrams.expectProblem('handwritten-diagram-conflict');
    diagrams.expectNoProjectChanges();
  });

  it('does not overwrite a newer note after planning', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    diagrams.revise('concept Store { public save\ncapability save() returns Nothing }');
    await diagrams.planUpdate();
    diagrams.expectNoProjectChanges();
    await diagrams.append('design/structure.d2', '\n# Newer note.\n');
    await diagrams.applyPlannedChangesWithRealWriter();
    diagrams.expectStaleWriteConflict();
    diagrams.expectFileEndsWithBytes('design/structure.d2', '\n# Newer note.\n');
    diagrams.expectNoConfirmedAssociations();
  });

  it('does not overwrite hand-edited SVG or silently pair it with regenerated source', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.svg', '\n<!-- Manual artwork -->\n');
    diagrams.revise('concept Store { public save\ncapability save() returns Nothing }');
    await diagrams.update();
    diagrams.expectOwnershipConflict('design/structure.svg');
    diagrams.expectNoProjectChanges();
  });

  it('keeps an honest stopped receipt when source succeeds but SVG writing fails', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    diagrams.failActualWrite('design/structure.svg');
    await diagrams.create({ views: ['structure'] });
    diagrams.expectStoppedReceiptWithCreatedFile('design/structure.d2');
    diagrams.expectNoFile('design/structure.svg');
    diagrams.expectNoConfirmedAssociations();
    diagrams.restoreFileWrites();
    await diagrams.create({ views: ['structure'] });
    diagrams.expectOwnershipConflict('design/structure.d2');
  });

  it('keeps invalid UTF-8 readable without using replacement characters as splice positions', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.appendBytes('design/structure.d2', [0xff]);
    await diagrams.read('Store');
    diagrams.expectReadBytesEqualFiles();
    diagrams.expectProblem('invalid-output-document');
    await diagrams.search('Store');
    diagrams.expectIncompleteCoverage();
    await diagrams.update();
    diagrams.expectProblem('invalid-output-document');
    diagrams.expectNoProjectChanges();
  });
});


describe('native rendering and the installed adapter establish actual delivery', { timeout: 30_000 }, () => {
  it('refuses native external assets without fetching them or emitting an SVG that loads them', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('concept Store {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.d2', '\nlogo: { shape: image; icon: https://example.invalid/logo.svg }\n');
    await diagrams.recordAndDenyAmbientResourceAccess();
    await diagrams.update();
    diagrams.expectProblem('unsupported-diagram-syntax');
    diagrams.expectNoAssetOrNetworkReadAttempts();
    diagrams.expectNoProjectChanges();
    await diagrams.search('Store');
    diagrams.expectCoverageGap('design/structure.d2', 'external-asset');
  });

  it('renders a readable class and sequence SVG from the actual generated native files', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Snapshot { title: Text }\nconcept Store { public save\ncapability save(snapshot: Snapshot) returns Nothing }\ninteraction "save"(snapshot: Snapshot) { participant caller: Store\nparticipant store: Store\nmessage caller -> store.save(snapshot) }');
    await diagrams.create({ views: ['structure', 'interactions'] });
    diagrams.expectNativeSvgDocuments(2);
    diagrams.expectNativeSvgLabel('Snapshot');
    diagrams.expectNativeSvgLabel('save(snapshot: Snapshot)');
    diagrams.expectNativeSvgLabel('save(snapshot)');
    diagrams.expectAllSvgDigestsMatchActualSources();
    diagrams.expectSvgContainsNoExternalAssetReferences();
  });

  it('produces identical fresh SVG bytes for identical source, identities and settings', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('type Snapshot { title: Text }\nfunction save(snapshot: Snapshot) returns Nothing');
    await diagrams.create({ views: ['structure'] });
    await diagrams.renderSameIdentifiedSpecificationInFreshProject();
    diagrams.expectNativeSvgBytesIdenticalAcrossProjects();
    await diagrams.update();
    diagrams.expectUnchanged();
  });

});



describe('literal diagram methods and guarded native patterns', { timeout: 30_000 }, () => {
  it('regenerates an optional method while preserving handwritten diagram bytes', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('component Screen { public select\ncapability select(label: Text) returns Nothing }');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.d2', '\n# Keep this handwritten note.\r\n');
    diagrams.revise('component Screen { public select\ncapability select(label: Text?) returns Nothing }');
    await diagrams.update();
    diagrams.expectSignature('Screen.select', 'select(label: Text?) → Nothing');
    diagrams.expectVisibleSvgLabel('select(label: Text?)');
    diagrams.expectFileEndsWithBytes('design/structure.d2', '\n# Keep this handwritten note.\r\n');
    diagrams.expectNoProblem('unsupported-diagram-syntax');
  });
  it('keeps true unquoted native globs outside guarded regeneration', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify('component Screen {}');
    await diagrams.create({ views: ['structure'] });
    await diagrams.append('design/structure.d2', '\n*: {style.fill: red}\n');
    await diagrams.update();
    diagrams.expectProblem('unsupported-diagram-syntax');
    diagrams.expectNoProjectChanges();
  });
});
