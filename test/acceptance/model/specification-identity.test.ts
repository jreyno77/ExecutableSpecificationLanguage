import { describe, it } from 'vitest';
import { IdentityExamples } from '../../dsl/model/specification-identity.js';

describe('keeping specification identities across project updates', () => {
  it('exposes complete source and external containment through the same inspection queries', () => {
    const project = new IdentityExamples();
    project.externalModule('library', [{ kind: 'record-type', name: 'Book', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } }
    ] }]);
    project.source('game', `use Book from "library"
    function save(book: Book) returns Nothing`);

    project.identify();

    project.expectInspectionRoot('game:save');
    project.expectInspectionRoot('library:Book');
    project.expectInspectionChild('game:save', 'book', { kind: 'parameter' });
    project.expectInspectionChild('library:Book', 'title', { kind: 'field' });
    project.expectTraversalPreservesQueryIdentitiesAndParents();
  });

  it('automatically identifies a concept and its contract without identifying primitive tokens', () => {
    const project = new IdentityExamples({ ids: ['store-17', 'save-17', 'snapshot-17'] });
    project.source('game', `concept StoreGame {
      capability save(snapshot: Text) returns Nothing
    }`);

    project.identify();

    project.expectIdentities({ StoreGame: 'store-17', 'StoreGame.save': 'save-17',
      'StoreGame.save.snapshot': 'snapshot-17' });
    project.expectNoIdentityForBuiltin('Text');
    project.expectOnlyEligibleElements(3);
    project.expectAccepted();
  });

  it('keeps identities after saving, restarting and recompiling with new source handles', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.remember();

    project.restartFromSavedBaseline();
    project.identify();
    project.compare();

    project.expectSameIdentity('Token');
    project.expectFreshNodeHandle('Token');
    project.expectNoChanges();
    project.expectNoNewIdsRequested();
  });

  it('ignores comments, locations and name quoting while updating provenance', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.remember();

    project.source('game', '// explanatory comment\n\nopaque type `Token`');
    project.identify();
    project.compare();

    project.expectSameIdentity('Token');
    project.expectNoChanges();
    project.expectCurrentOrigin('Token', { module: 'game', line: 3 });
    project.expectRememberedOrigin('Token', { module: 'game', line: 1 });
  });

  it('preserves an explicitly renamed capability and reports its owning contract change', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      capability save(snapshot: Text) returns Nothing
    }`);
    project.identify();
    project.remember();

    project.source('game', `concept Store {
      capability saveGame(snapshot: Text) returns Nothing
    }`);
    project.keep('Store.save', 'Store.saveGame');
    project.identify();
    project.compare();

    project.expectSameIdentity('Store.save', 'Store.saveGame');
    project.expectSameIdentity('Store.save.snapshot', 'Store.saveGame.snapshot');
    project.expectChanges({ Store: ['update'], 'Store.saveGame': ['rename'] });
  });

  it('does not turn a similar name into correspondence or an automatic removal', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type SavedGame');
    project.identify();
    project.remember();

    project.source('game', 'opaque type SavedGames');
    project.identify();

    project.expectNoIdentifiedSpecification();
    project.expectProblem('identity-correspondence', { mentions: ['SavedGame'] });
    project.expectRememberedBaselineUnchanged();
  });

  it('adds a new declaration and removes only the explicitly retired old one', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type DiskSave');
    project.identify();
    project.remember();

    project.source('game', 'opaque type CloudSave');
    project.retire('DiskSave');
    project.identify();
    project.compare();

    project.expectChanges({ DiskSave: ['remove'], CloudSave: ['add'] });
    project.expectDifferentIdentity('DiskSave', 'CloudSave');
    project.expectRetired('DiskSave');
  });

  it('distinguishes replacement at the same address from ordinary continuation', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.remember();

    project.retire('Token');
    project.identify();
    project.compare();

    project.expectDifferentIdentity('Token', 'Token');
    project.expectReplacement('Token', { old: ['remove'], current: ['add'] });
    project.expectRetiredIdCannotBeReused();
  });

  it('renames a parent without remapping each of its members', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      capability save(snapshot: Text) returns Nothing
    }`);
    project.identify();
    project.remember();

    project.source('game', `concept Shop {
      capability save(snapshot: Text) returns Nothing
    }`);
    project.keep('Store', 'Shop');
    project.identify();
    project.compare();

    project.expectSameIdentity('Store.save', 'Shop.save');
    project.expectSameIdentity('Store.save.snapshot', 'Shop.save.snapshot');
    project.expectChanges({ Shop: ['rename'] });
  });

  it('moves a parent and its authored members to another module', () => {
    const project = new IdentityExamples();
    project.source('old/game', `concept Store {
      capability save() returns Nothing
    }`);
    project.identify();
    project.remember();

    project.replaceEntry('new/game', `concept Store {
      capability save() returns Nothing
    }`);
    project.keep('old/game:Store', 'new/game:Store');
    project.identify();
    project.compare();

    project.expectSameIdentity('old/game:Store.save', 'new/game:Store.save');
    project.expectChanges({ 'new/game:Store': ['move'], 'new/game:Store.save': ['move'] });
    project.expectContextChanged();
  });

  it('moves a capability between established owners by explicit correspondence', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      capability save() returns Nothing
    }
    concept Storage {}`);
    project.identify();
    project.remember();

    project.source('game', `concept Store {}
    concept Storage {
      capability save() returns Nothing
    }`);
    project.keep('Store.save', 'Storage.save');
    project.identify();
    project.compare();

    project.expectSameIdentity('Store.save', 'Storage.save');
    project.expectChanges({ Store: ['update'], Storage: ['update'], 'Storage.save': ['move'] });
  });

  it('automatically resumes two anonymous blocks after a saved-baseline restart', () => {
    const project = new IdentityExamples();
    project.source('game', `examples { fixture quantity: Number = 1 }
    examples { fixture quantity: Number = 2 }`);
    project.identify();
    project.remember();

    project.restartFromSavedBaseline();
    project.identify();
    project.compare();

    project.expectSameIdentity('examples[0]');
    project.expectSameIdentity('examples[1]');
    project.expectSameIdentity('examples[0].quantity');
    project.expectSameIdentity('examples[1].quantity');
    project.expectDistinctIdentities('examples[0].quantity', 'examples[1].quantity');
    project.expectNoChanges();
    project.expectNoNewIdsRequested();
  });

  it('moves a capability under a newly introduced owner without allocating a new capability identity', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      capability save() returns Nothing
    }`);
    project.identify();
    project.remember();

    project.source('game', `concept Store {}
    concept Storage {
      capability save() returns Nothing
    }`);
    project.keep('Store.save', 'Storage.save');
    project.identify();
    project.compare();

    project.expectSameIdentity('Store.save', 'Storage.save');
    project.expectChanges({ Store: ['update'], Storage: ['add'], 'Storage.save': ['move'] });
  });

  it('retains a deliberately changed declaration kind as the same specified thing', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      capability save() returns Nothing
    }`);
    project.identify();
    project.remember();

    project.source('game', `interface Store {
      capability save() returns Nothing
    }`);
    project.keep('Store', 'Store');
    project.identify();
    project.compare();

    project.expectSameIdentity('Store');
    project.expectSameIdentity('Store.save');
    project.expectCurrentKind('Store', 'interface');
    project.expectChanges({ Store: ['update'] });
  });

  it('retires an owner and its obsolete members while retaining an explicitly moved member', () => {
    const project = new IdentityExamples();
    project.source('game', `concept OldStore {
      capability save() returns Nothing
      capability discard() returns Nothing
    }`);
    project.identify();
    project.remember();

    project.source('game', `concept NewStore {
      capability save() returns Nothing
    }`);
    project.retire('OldStore');
    project.keep('OldStore.save', 'NewStore.save');
    project.identify();
    project.compare();

    project.expectSameIdentity('OldStore.save', 'NewStore.save');
    project.expectRetired('OldStore');
    project.expectRetired('OldStore.discard');
    project.expectChanges({ OldStore: ['remove'], 'OldStore.discard': ['remove'],
      NewStore: ['add'], 'NewStore.save': ['move'] });
  });

  it('does not require remapping repeated blocks after an unrelated declaration is inserted', () => {
    const project = new IdentityExamples();
    project.source('game', `examples { fixture quantity: Number = 1 }
    examples { fixture quantity: Number = 2 }`);
    project.identify();
    project.remember();

    project.source('game', `opaque type Token
    examples { fixture quantity: Number = 1 }
    examples { fixture quantity: Number = 2 }`);
    project.identify();
    project.compare();

    project.expectSameIdentity('examples[0]');
    project.expectSameIdentity('examples[1]');
    project.expectSameIdentity('examples[1].quantity');
    project.expectChanges({ Token: ['add'] });
  });

  it('requires explicit correspondence when repeated blocks are reordered', () => {
    const project = new IdentityExamples();
    project.source('game', `examples { fixture quantity: Number = 1 }
    examples { fixture quantity: Number = 2 }`);
    project.identify();
    project.remember();

    project.source('game', `examples { fixture quantity: Number = 2 }
    examples { fixture quantity: Number = 1 }`);
    project.identify();
    project.expectNoIdentifiedSpecification();
    project.expectProblem('identity-correspondence', { mentions: ['examples'] });

    project.keep('examples[0]', 'examples[1]');
    project.keep('examples[1]', 'examples[0]');
    project.identify();
    project.compare();

    project.expectSameIdentity('examples[0].quantity', 'examples[1].quantity');
    project.expectSameIdentity('examples[1].quantity', 'examples[0].quantity');
    project.expectNoChanges();
  });

  it('keeps repeated example titles distinct and automatic while their group is unchanged', () => {
    const project = new IdentityExamples();
    project.source('game', `examples {
      example "quantity": 1 => 1
      example "quantity": 2 => 2
    }`);
    project.identify();
    project.remember();

    project.restartFromSavedBaseline();
    project.identify();
    project.compare();

    project.expectSameIdentity('examples[0].example[0]');
    project.expectSameIdentity('examples[0].example[1]');
    project.expectDistinctIdentities('examples[0].example[0]', 'examples[0].example[1]');
    project.expectNoChanges();
  });

  it('reports a changed promise while retaining the contract identity', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      capability save() returns Nothing { promises "Saved to disk" }
    }`);
    project.identify();
    project.remember();

    project.source('game', `concept Store {
      capability save() returns Nothing { promises "Saved to a database" }
    }`);
    project.identify();
    project.compare();

    project.expectSameIdentity('Store.save');
    project.expectChanges({ Store: ['update'], 'Store.save': ['update'] });
    project.expectCurrentPromise('Store.save', 'Saved to a database');
    project.expectOldFingerprintAvailable('Store.save');
  });

  it('keeps distinct numeric literal tokens beyond JavaScript integer precision', () => {
    const project = new IdentityExamples();
    project.source('game', 'type Counter { value: Number = 9007199254740992 }');
    project.identify();
    project.remember();

    project.source('game', 'type Counter { value: Number = 9007199254740993 }');
    project.identify();
    project.compare();

    project.expectSameIdentity('Counter.value');
    project.expectChanges({ Counter: ['update'], 'Counter.value': ['update'] });
    project.expectCurrentNumberToken('Counter.value', '9007199254740993');
  });

  it('observes a changed bound target behind an unchanged local alias', () => {
    const project = new IdentityExamples();
    project.module('library', 'opaque type A\nopaque type B');
    project.source('game', `use A as Value from "library"
    function save(value: Value) returns Nothing`);
    project.identify();
    project.remember();

    project.source('game', `use B as Value from "library"
    function save(value: Value) returns Nothing`);
    project.identify();
    project.compare();

    project.expectSameIdentity('save.value');
    project.expectBoundReference('save.value', 'library:B');
    project.expectChanges({ save: ['update'], 'save.value': ['update'] });
    project.expectContextChanged();
  });

  it('reports a changed external definition and its unchanged dependent', () => {
    const project = new IdentityExamples();
    project.externalModule('library', [{ kind: 'record-type', name: 'Book', fields: [
      { kind: 'field', name: 'value', type: { kind: 'builtin', name: 'Number' } }
    ] }]);
    project.source('game', `use Book from "library"
    function save(book: Book) returns Nothing`);
    project.identify();
    project.remember();

    project.externalModule('library', [{ kind: 'record-type', name: 'Book', fields: [
      { kind: 'field', name: 'value', type: { kind: 'builtin', name: 'Text' } }
    ] }]);
    project.identify();
    project.compare();

    project.expectSameIdentity('library:Book');
    project.expectSameStructure('save');
    project.expectChanges({ 'library:Book': ['update'], 'library:Book.value': ['update'] });
    project.expectAffected(['save', 'save.book']);
    project.expectCurrentFieldType('library:Book.value', 'Text');
  });

  it('terminates impact traversal through recursive declared references', () => {
    const project = new IdentityExamples();
    project.source('game', `type Left { right: Right? }
    type Right { left: Left? }
    function inspect(value: Left) returns Nothing`);
    project.identify();
    project.remember();

    project.source('game', `type Left { right: Right? }
    type Right {
      left: Left?
      label: Text?
    }
    function inspect(value: Left) returns Nothing`);
    project.identify();
    project.compare();

    project.expectChanges({ Right: ['update'], 'Right.label': ['add'] });
    project.expectAffected(['Left', 'Left.right', 'Right.left', 'inspect', 'inspect.value']);
    project.expectNoRepeatedAffectedIds();
  });

  it('keeps contextually checked capture and member expressions in scenario structure', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Basket {
      public add
      capability add(count: Number) returns Nothing
    }
    examples {
      setup emptyBasket() returns Basket
      scenario "add through a basket" {
        given basket = emptyBasket()
        when basket.add(1)
        then true
      }
    }`);
    project.identify();
    project.remember();

    project.replaceText('when basket.add(1)', 'when basket.add(2)');
    project.identify();
    project.compare();

    project.expectAccepted();
    project.expectContextuallyCheckedReference('basket.add');
    project.expectChanges({ 'examples[0]': ['update'],
      'examples[0].add through a basket': ['update'] });
    project.expectCurrentScenarioStep('add through a basket', 'when basket.add(2)');
  });
});

describe('recording associations and comparing supplied project uses', () => {
  it('keeps all fragments of a concept without absorbing a similar handwritten name', () => {
    const project = new IdentityExamples();
    project.source('game', 'concept StoreGame {}\nconcept LegacyStoreGame {}');
    project.identify();
    project.associateArtifacts('StoreGame', [
      { outputId: 'ts', format: 'ts-symbol-v1', value: { file: 'src/game.ts', symbol: 'StoreGame' } },
      { outputId: 'ts', format: 'ts-symbol-v1', value: { file: 'src/storage.ts', symbol: 'saveGame' } },
      { outputId: 'tests', format: 'test-case-v1', value: { file: 'test/game.test.ts', title: 'saves a game' } }
    ]);

    project.restartFromSavedBaseline();

    project.expectArtifactFiles('StoreGame', ['src/game.ts', 'src/storage.ts', 'test/game.test.ts']);
    project.expectNoArtifacts('LegacyStoreGame');
    project.expectSourceAndBaselineInputsUnchanged();
  });

  it('rejects one exact artifact locator assigned to two different identities', () => {
    const project = new IdentityExamples();
    project.source('game', 'concept Store {}\nconcept Storage {}');
    project.identify();
    const locator = { outputId: 'ts', format: 'ts-symbol-v1',
      value: { file: 'src/game.ts', symbol: 'Store' } };

    project.proposeArtifactAssociations([{ subject: 'Store', locator }, { subject: 'Storage', locator }]);

    project.expectNoRecordedArtifactProposal();
    project.expectProblem('identity-association', { mentions: ['src/game.ts', 'Store'] });
    project.expectCurrentAssociations([]);
  });

  it('retains old artifact links on explicit retirement until their removal is also proposed', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.associateArtifacts('Token', [
      { outputId: 'ts', format: 'ts-symbol-v1', value: { file: 'src/token.ts', symbol: 'Token' } }
    ]);
    project.remember();

    project.retire('Token');
    project.identify();
    project.compare();

    project.expectReplacement('Token', { old: ['remove'], current: ['add'] });
    project.expectRetiredArtifactFiles('Token', ['src/token.ts']);
    project.expectNoArtifacts('Token');
    project.expectRememberedBaselineUnchanged();
  });

  it('reports explicit artifact unlinking without changing or retiring the specified declaration', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.associateArtifacts('Token', [
      { outputId: 'ts', format: 'ts-symbol-v1', value: { file: 'src/token.ts', symbol: 'Token' } }
    ]);
    project.remember();

    project.proposeArtifactAssociations([]);
    project.compare();

    project.expectSameIdentity('Token');
    project.expectSameStructure('Token');
    project.expectChanges({ Token: ['artifacts'] });
    project.expectNoArtifacts('Token');
    project.expectRememberedArtifactFiles('Token', ['src/token.ts']);
  });

  it('reports a and b matched, c unobserved, and unmodeled d observed in the declared scope', () => {
    const project = new IdentityExamples();
    project.source('game', `opaque type A
    opaque type B
    opaque type C
    concept Store { depends on A, B, C }`);
    project.identify();
    project.observeRelationships('Store', {
      direction: 'outgoing', complete: true, scope: ['src/store.ts'],
      uses: [
        { specified: 'A', at: 'src/store.ts:Store.a' },
        { specified: 'B', at: 'src/store.ts:Store.b' },
        { project: 'D', at: 'src/store.ts:Store.d' }
      ]
    });

    project.reconcileExpected(['A', 'B', 'C']);

    project.expectMatches(['A', 'B']);
    project.expectUnobserved(['C']);
    project.expectObservedOnly([{ project: 'D', at: 'src/store.ts:Store.d' }]);
    project.expectCoverage({ complete: true, scope: ['src/store.ts'] });
    project.expectNoSpecificationDeclaration('D');
  });

  it('preserves incomplete coverage and an unresolved use instead of asserting global absence', () => {
    const project = new IdentityExamples();
    project.source('game', `opaque type A
    opaque type C
    concept Store { depends on A, C }`);
    project.identify();
    project.observeRelationships('Store', {
      direction: 'outgoing', complete: false, scope: ['src/store.ts'],
      limitations: ['src/plugins.ts was not inspected'],
      uses: [{ specified: 'A', at: 'src/store.ts:Store.a' }],
      unresolved: [{ at: 'src/store.ts:loadPlugin', reason: 'dynamic target is unknown' }]
    });

    project.reconcileExpected(['A', 'C']);

    project.expectMatches(['A']);
    project.expectUnobserved(['C']);
    project.expectCoverage({ complete: false, scope: ['src/store.ts'],
      limitations: ['src/plugins.ts was not inspected'] });
    project.expectUnresolvedUse('src/store.ts:loadPlugin', 'dynamic target is unknown');
  });

  it('retains a caller that has no declaration in the specification', () => {
    const project = new IdentityExamples();
    project.source('game', 'concept Store {}');
    project.identify();
    project.observeRelationships('Store', {
      direction: 'incoming', complete: true, scope: ['src/launcher.ts'],
      uses: [{ project: 'Launcher', at: 'src/launcher.ts:start' }]
    });

    project.reconcileExpected([]);

    project.expectObservedOnly([{ project: 'Launcher', at: 'src/launcher.ts:start' }]);
    project.expectDirection('incoming');
    project.expectNoSpecificationDeclaration('Launcher');
    project.expectNoNewIdsRequestedSinceObservation();
  });
});

describe('rejecting unsafe identity proposals', () => {
  it('rejects unsupported baseline versions instead of resetting the project history', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.remember();
    project.saveBaseline();

    project.changeSavedJson({ format: 99 });
    project.readSavedBaseline();

    project.expectNoReadBaseline();
    project.expectProblem('identity-format', { mentions: ['99'] });
    project.expectRememberedBaselineUnchanged();
  });

  it('rejects a repeated JSON property instead of accepting its final value', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type Token');
    project.identify();
    project.saveBaseline();

    project.insertRepeatedSavedProperty('format', 1);
    project.readSavedBaseline();

    project.expectNoReadBaseline();
    project.expectProblem('identity-baseline', { mentions: ['format'] });
  });

  it('rejects two old identities claiming the same current declaration', () => {
    const project = new IdentityExamples();
    project.source('game', 'opaque type A\nopaque type B');
    project.identify();
    project.remember();

    project.source('game', 'opaque type C');
    project.keep('A', 'C');
    project.keep('B', 'C');
    project.identify();

    project.expectNoIdentifiedSpecification();
    project.expectProblem('identity-correspondence', { mentions: ['C'] });
    project.expectRememberedBaselineUnchanged();
  });

  it('does not create an identified proposal from a rejected public contract', () => {
    const project = new IdentityExamples();
    project.source('game', `concept Store {
      public saveGame
      capability save() returns Nothing
    }`);

    project.identify();

    project.expectCompilationProblem('unresolved-reference', 'saveGame');
    project.expectNoIdentifiedSpecification();
    project.expectNoIdsRequested();
  });
});

describe('identifying actually composed examples', () => {
  it('sees a changed example attached to an external record without changing its fields', () => {
    const project = new IdentityExamples();
    project.externalModule('library', [{ kind: 'record-type', name: 'Book', fields: [
      { kind: 'field', name: 'copies', type: { kind: 'builtin', name: 'Number' } }
    ] }]);
    project.source('game', `use Book from "library"
    examples for Book from "saving"`);
    project.module('saving', 'examples { example "copies": 1 => 1 }');
    project.identify();
    project.remember();

    project.module('saving', 'examples { example "copies": 2 => 2 }');
    project.identify();
    project.compare();

    project.expectSameIdentity('saving:examples[0].copies');
    project.expectEffectiveOwner('saving:examples[0]', 'library:Book');
    project.expectCurrentFieldNames('library:Book', ['copies']);
    project.expectChanges({ 'library:Book': ['update'],
      'saving:examples[0]': ['update'], 'saving:examples[0].copies': ['update'] });
  });

  it('sees changed callable examples without treating them as parameters or a contract body', () => {
    const project = new IdentityExamples();
    project.source('game', `function double(amount: Number) returns Number
    examples for double from "doubling"`);
    project.module('doubling', 'use double from "game"\nexamples { example "double one": double(1) => 2 }');
    project.identify();
    project.remember();

    project.module('doubling', 'use double from "game"\nexamples { example "double one": double(1) => 3 }');
    project.identify();
    project.compare();

    project.expectSameIdentity('doubling:examples[0].double one');
    project.expectEffectiveOwner('doubling:examples[0]', 'game:double');
    project.expectCurrentParameterNames('game:double', ['amount']);
    project.expectCurrentBody('game:double', 'absent');
    project.expectChanges({ 'game:double': ['update'],
      'doubling:examples[0]': ['update'], 'doubling:examples[0].double one': ['update'] });
  });

  it('observes a changed effective builtin subject even when an ownerless block is unchanged', () => {
    const project = new IdentityExamples();
    project.source('game', 'examples for Text from "comparisons"');
    project.module('comparisons', 'examples { example "equality": 1 == 1 => true }');
    project.identify();
    project.remember();

    project.source('game', 'examples for Number from "comparisons"');
    project.identify();
    project.compare();

    project.expectSameIdentity('comparisons:examples[0]');
    project.expectSameIdentity('comparisons:examples[0].equality');
    project.expectNoAuthoredSubject('comparisons:examples[0]');
    project.expectEffectiveBuiltinOwner('comparisons:examples[0]', 'Number');
    project.expectChanges({ 'comparisons:examples[0]': ['update'] });
    project.expectNoIdentityForBuiltin('Text');
    project.expectNoIdentityForBuiltin('Number');
  });
});
