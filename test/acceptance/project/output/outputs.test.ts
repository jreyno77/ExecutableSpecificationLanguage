import { describe, it } from 'vitest';
import { OutputsExample } from '../../../dsl/project/output/outputs.js';

it('documents declared domain failures separately from the successful result', async () => {
  const project = await OutputsExample.connect();
  await project.specify(`type Account { id: Text }
error type AccountError {
  code: "duplicate-account" | "invalid-account"
  email: Text
}
function createAccount(email: Text) returns Account fails with AccountError`);
  await project.createWith('contract-list', { directory: 'contracts' });
  await project.expectFileContains('contracts/AccountError.md', '# error type AccountError');
  await project.expectFileContains('contracts/AccountError.md', 'code: "duplicate-account" | "invalid-account"');
  await project.expectFileContains('contracts/AccountError.md', 'email: Text');
  await project.expectFileContains('contracts/createAccount.md', 'createAccount(email: Text) returns Account');
  await project.expectFileContains('contracts/createAccount.md', 'May fail with: [AccountError](');
  await project.search('createAccount');
  project.expectSpecifiedOutgoing(['Account', 'AccountError']);
  project.expectCompleteWithinScope('Markdown');
});

it('preserves error data and failure roles in structural output', async () => {
  const project = await OutputsExample.connect();
  await project.specify(`type Account { id: Text }
error type AccountError {
  code: "duplicate-account" | "invalid-account"
  email: Text
}
function createAccount(email: Text) returns Account fails with AccountError`);
  await project.createWith('structure-list', { directory: 'structure' });
  await project.expectStructuredError('AccountError', ['code: "duplicate-account" | "invalid-account"', 'email: Text']);
  await project.expectStructuredCallable('createAccount', {
    signature: 'createAccount(email: Text) returns Account', result: 'Account', failures: ['AccountError'],
  });
  await project.search('createAccount');
  project.expectSpecifiedOutgoing(['Account', 'AccountError']);
  project.expectCompleteWithinScope('expec-structure-1');
});

it('observes foreign Markdown links as project consumers and protects their targets', async () => {
  const project = await OutputsExample.withContracts('concept StoreGame {}');
  await project.writeForeignContract('guide/StoreGame.md', 'markdown', 'StoreGame', '../docs/contracts/StoreGame.md');
  await project.search('StoreGame');
  project.expectProjectConsumer('guide/StoreGame.md');
  project.expectCompleteWithinScope('Markdown');
  await project.rememberFiles();
  await project.delete('StoreGame');
  project.expectConflictAt('guide/StoreGame.md');
  await project.expectFilesUnchanged();
});

it('keeps the same opaque identity in another Markdown output separate', async () => {
  const project = await OutputsExample.withContracts('concept StoreGame {}');
  await project.writeForeignContract('guide/StoreGame.md', 'markdown', 'StoreGame');
  await project.read('StoreGame');
  project.expectReadFiles(['docs/contracts/StoreGame.md']);
  project.expectReadWithoutProblems();
  await project.search('StoreGame');
  project.expectCompleteWithinScope('Markdown');
  project.expectNoObservedIncomingUses();
});

it('documents source declarations in the checked view while external declarations remain references', async () => {
  const project = await OutputsExample.connect();
  await project.specifyModules('entry', {
    entry: 'include "included"\nuse Library from "library"\nuse Vendor from "vendor"\nconcept Entry { depends on Included, Library, Vendor }',
    included: 'concept Included {}',
    library: 'concept Library {}',
  }, { vendor: ['Vendor'] });
  await project.createWith('contract-list', { directory: 'contracts' });
  await project.expectGeneratedDocuments(['contracts/Entry.md', 'contracts/Included.md', 'contracts/Library.md']);
  await project.expectFileContains('contracts/Entry.md', 'Vendor');
  await project.expectNoFile('contracts/Vendor.md');
});

it('refuses documentation filename collisions between distinct source modules', async () => {
  const project = await OutputsExample.connect();
  await project.specifyModules('entry', {
    entry: 'use Common as Imported from "library"\nconcept Common { depends on Imported }',
    library: 'concept Common {}',
  });
  await project.createWith('contract-list', { directory: 'contracts' });
  project.expectConflictAt('contracts/Common.md');
  await project.expectNoGeneratedArtifacts();
});

const store = `
type Snapshot { title: Text }
concept Storage {}
concept StoreGame {
  depends on Storage
  public save
  capability save(snapshot: Snapshot) returns Nothing {
    promises "Save the player's snapshot"
  }
}`;

it('writes a useful contract into the connected project', async () => {
  const project = await OutputsExample.connect('project-a');
  await project.specify(store);
  await project.open('contract-list', { directory: 'docs/contracts' });
  await project.create();
  await project.expectContract('docs/contracts/StoreGame.md', {
    name: 'StoreGame', dependencies: ['Storage'],
    capabilities: ['save(snapshot: Snapshot) returns Nothing'],
    promises: ["Save the player's snapshot"],
  });
  await project.expectPromiseUnverified("Save the player's snapshot");
  await project.expectOtherProjectUnchanged('project-b');
});

it('answers a second question from the same checked object', async () => {
  const project = await OutputsExample.connect();
  await project.specify(store);
  await project.createWith('contract-list', { directory: 'docs/contracts' });
  await project.createWith('structure-list', { directory: 'design/structure' });
  await project.expectStructuralDependency('StoreGame', 'Storage');
  await project.expectNoDeclaredMessage('StoreGame', 'Storage');
  project.expectSameSpecificationObjectUsedByBothOutputs();
  project.expectSpecificationUnchanged();
});

it('selects a registered target through configuration', async () => {
  const project = await OutputsExample.connect();
  await project.readSettings({ outputs: [{ id: 'contract-list', options: { directory: 'contracts' } }] });
  await project.specify(store);
  await project.createConfiguredOutput();
  await project.expectFile('contracts/StoreGame.md');
  await project.expectNoFile('docs/contracts/StoreGame.md');
});

it('rejects unknown targets and invalid options before writing', async () => {
  const project = await OutputsExample.connect();
  await project.rememberFiles();
  await project.open('not-installed', {});
  project.expectOpenProblem('unknown-output');
  await project.open('contract-list', { directory: '../outside' });
  project.expectOpenProblem('invalid-output-options');
  await project.expectFilesUnchanged();
});


it('can reopen and repeat creation without rewriting matching files', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.rememberFilesAndMetadata();
  await project.reopenOutput();
  await project.create();
  project.expectReceipt('unchanged');
  await project.expectFilesAndMetadataUnchanged();
});

it('reads current complete content after an editor changes it', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.append('docs/contracts/StoreGame.md', '\nMy implementation notes.\n');
  await project.read('StoreGame.save');
  project.expectReadContains("Save the player's snapshot");
  project.expectReadContains('My implementation notes.');
  project.expectReadIncludesWholeFile('docs/contracts/StoreGame.md');
});

it('finds an incoming document that is not in the specification', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.write('notes/Launcher.md', '[Start the game](../docs/contracts/StoreGame.md)');
  await project.search('StoreGame');
  project.expectDefinition('docs/contracts/StoreGame.md');
  project.expectProjectConsumer('notes/Launcher.md');
  project.expectCoverageLimitedTo('Markdown definitions and links');
});

it('compares actual links with explicit expected dependencies', async () => {
  const project = await OutputsExample.withContracts(`
    concept a {}
    concept b {}
    concept c {}
    concept StoreGame { depends on a, b, c }
  `);
  await project.write('notes/d.md', '# d');
  await project.replaceDependencyLinks('StoreGame', ['a', 'b', '../../notes/d.md']);
  await project.search('StoreGame');
  project.compareOutgoingWith(['a', 'b', 'c']);
  project.expectComparison({ matched: ['a', 'b'], unobserved: ['c'], projectOnly: ['notes/d.md'] });
});

it('respects Markdown syntax when finding uses', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.write('notes/Real.md', '[game][target]\n\n[target]: ../docs/contracts/StoreGame.md');
  await project.write('notes/Sample.md', '```md\n[game](../docs/contracts/StoreGame.md)\n```');
  await project.search('StoreGame');
  project.expectProjectConsumer('notes/Real.md');
  project.expectNoProjectConsumer('notes/Sample.md');
});

it('keeps unresolved observations and incomplete scope visible', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.append('docs/contracts/StoreGame.md', '\n[missing](Missing.md)\n');
  await project.search('StoreGame');
  project.expectUnresolvedLink('Missing.md');
  project.expectIncompleteOutgoingCoverage();
  project.expectSpecifiedOutgoing(['Storage', 'Snapshot']);
  project.expectNoProjectOutgoing();
});

it('read and search have no project effects', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.rememberFilesAndMetadata();
  await project.read('StoreGame');
  await project.search('StoreGame');
  await project.expectFilesAndMetadataUnchanged();
});

it('returns a useful plan without applying it', async () => {
  const project = await OutputsExample.connect();
  await project.specify(store);
  await project.open('contract-list', { directory: 'docs/contracts' });
  await project.rememberFiles();
  await project.planCreate();
  project.expectPlannedFile('docs/contracts/StoreGame.md');
  await project.expectFilesUnchanged();
  await project.applyPreparedPlan();
  await project.expectFile('docs/contracts/StoreGame.md');
});

it('preserves an edit made after planning', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.revisePromise('StoreGame.save', 'Save to a database');
  await project.planUpdate();
  await project.append('docs/contracts/StoreGame.md', '\nEdited after planning.\n');
  await project.applyPreparedPlan();
  project.expectStoppedFor('stale-project');
  await project.expectFileContains('docs/contracts/StoreGame.md', 'Edited after planning.');
  project.expectNoConfirmedAssociationProposal();
});

it('can plan independent outputs from one snapshot without replacing global identity', async () => {
  const project = await OutputsExample.connect();
  await project.specify(store);
  await project.saveGlobalIdentityWithUnrelatedArtifact('external-output');
  await project.rememberGlobalIdentityFile();
  await project.planBothFromOneSnapshot('contract-list', 'structure-list');
  project.expectDisjointFileChangesIncludingState();
  await project.applyCombinedPreparedChanges();
  project.acceptSuccessfulNamespacesRetaining('external-output');
  project.expectAssociationNamespaces(['external-output', 'contract-list', 'structure-list']);
  await project.expectGlobalIdentityFileUnchangedByOutputs();
});

it('lets a host reject intersecting plans before applying either', async () => {
  const project = await OutputsExample.connect();
  await project.specify(store);
  await project.planTwoRegisteredOutputsForSameFile('docs/StoreGame.md');
  project.expectIntersectingPath('docs/StoreGame.md');
  await project.declineConflictingPlans();
  await project.expectNoFile('docs/StoreGame.md');
});

it('does not adopt an existing unowned file even when its text matches', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.removeOutputStateKeepingArtifacts();
  await project.reopenOutput();
  await project.rememberFiles();
  await project.create();
  project.expectConflictAt('docs/contracts/StoreGame.md');
  await project.expectFilesUnchanged();
});

it('preserves handwritten edits during update and deletion', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.append('docs/contracts/StoreGame.md', '\nKeep my notes.\n');
  await project.revisePromise('StoreGame.save', 'Save to a database');
  await project.rememberFiles();
  await project.update();
  project.expectConflictAt('docs/contracts/StoreGame.md');
  await project.delete('StoreGame');
  project.expectConflictAt('docs/contracts/StoreGame.md');
  await project.expectFilesUnchanged();
});

it('reports duplicate definitions without granting ownership to copied markers', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.copy('docs/contracts/StoreGame.md', 'notes/StoreGame-copy.md');
  await project.read('StoreGame');
  project.expectReadFiles(['docs/contracts/StoreGame.md', 'notes/StoreGame-copy.md']);
  project.expectAmbiguousDefinition();
  await project.rememberFiles();
  await project.delete('StoreGame');
  project.expectConflictAt('notes/StoreGame-copy.md');
  await project.expectFilesUnchanged();
});

it('inserts a new top-level declaration and updates an existing contract separately', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.revise(store + '\nconcept Launcher {}');
  await project.insert();
  await project.expectFile('docs/contracts/Launcher.md');
  await project.addPublicCapability('StoreGame', 'reset() returns Nothing');
  await project.insert();
  project.expectProblem('not-addition-only');
  await project.update();
  await project.expectCapability('StoreGame', 'reset() returns Nothing');
});

it('uses established identity for a rename without leaving an old definition', async () => {
  const project = await OutputsExample.withContracts(store);
  project.rememberIdentifier('StoreGame');
  await project.renameWithIdentity('StoreGame', 'GameStore');
  await project.update();
  project.expectSameIdentifier('GameStore');
  await project.expectFile('docs/contracts/GameStore.md');
  await project.expectNoFile('docs/contracts/StoreGame.md');
  await project.read('GameStore');
  project.expectReadContains('GameStore');
});

it('removes a nested capability through an owner update', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.delete('StoreGame.save');
  project.expectUnsupported('nested-delete');
  await project.removeCapabilityAndPublicSelection('StoreGame', 'save');
  await project.update();
  await project.expectFile('docs/contracts/StoreGame.md');
  await project.expectNoCapability('StoreGame', 'save');
});

it('refuses a diff that does not describe the supplied current specification', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.revisePromise('StoreGame.save', 'Save to database A');
  project.rememberDiff();
  await project.revisePromise('StoreGame.save', 'Save to database B');
  await project.rememberFiles();
  await project.updateUsingRememberedDiff();
  project.expectProblem('inconsistent-diff');
  await project.expectFilesUnchanged();
});

it('protects a handwritten incoming link when a document would be renamed or removed', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.write('notes/Launcher.md', '[game](../docs/contracts/StoreGame.md)');
  await project.rememberFiles();
  await project.renameWithIdentity('StoreGame', 'GameStore');
  await project.update();
  project.expectConflictAt('notes/Launcher.md');
  await project.deleteOriginalIdentifier('StoreGame');
  project.expectConflictAt('notes/Launcher.md');
  await project.expectFilesUnchanged();
});

it('deletes an unused owned document and can repeat that request after restart', async () => {
  const project = await OutputsExample.withContracts(store);
  project.rememberIdentifier('StoreGame');
  await project.delete('StoreGame');
  project.expectReceipt('applied');
  await project.expectNoFile('docs/contracts/StoreGame.md');
  await project.expectFile('docs/contracts/Storage.md');
  await project.reopenOutput();
  await project.deleteRememberedIdentifier();
  project.expectReceipt('unchanged');
});

it('retains actual partial effects when updating output state fails', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.revisePromise('StoreGame.save', 'Save to a database');
  await project.denyNextStateFileWrite();
  await project.update();
  project.expectReceipt('stopped');
  project.expectAppliedArtifactAndUnappliedState();
  project.expectPreviousArtifactBytesAvailable();
  project.expectNoConfirmedAssociationProposal();
  await project.releaseWriteFailure();
  await project.reopenOutput();
  await project.update();
  project.expectConflictAt('docs/contracts/StoreGame.md');
});

it('keeps corrupt state distinct from an empty output', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.corruptOutputState();
  await project.rememberFiles();
  await project.reopenOutput();
  await project.create();
  project.expectProblem('invalid-output-state');
  await project.expectFilesUnchanged();
  await project.read('StoreGame');
  project.expectReadContains("Save the player's snapshot");
});

it('reports mapping conflicts rather than inventing file names', async () => {
  const project = await OutputsExample.connect();
  await project.specify('concept `Store/Game` {}');
  await project.open('contract-list', { directory: 'contracts' });
  await project.create();
  project.expectProblem('unsupported-artifact-name');
  await project.expectNoGeneratedArtifacts();
});

it('replays a completed output transition when the host baseline was not saved', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.revisePromise('StoreGame.save', 'Save to a database');
  project.rememberCurrentAndDiff();
  await project.update();
  project.expectReceipt('applied');
  await project.rememberFilesAndMetadata();
  await project.reopenOutputWithoutSavingHostBaseline();
  await project.repeatRememberedUpdate();
  project.expectReceipt('unchanged');
  project.expectConfirmedAssociation('StoreGame', 'docs/contracts/StoreGame.md');
  await project.expectFilesAndMetadataUnchanged();
});

it('catches up an output even when the host latest diff is empty', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.revisePromise('StoreGame.save', 'Save to a database');
  await project.saveHostBaselineWithoutRunningOutput();
  await project.compareUnchangedCurrentWithSavedHostBaseline();
  project.expectHostDiffHasNoSourceChanges();
  await project.reopenOutput();
  await project.update();
  project.expectReceipt('applied');
  await project.expectFileContains('docs/contracts/StoreGame.md', 'Save to a database');
});

it('does not silently retarget an existing output directory', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.open('contract-list', { directory: 'other-contracts' });
  await project.rememberFiles();
  await project.create();
  project.expectProblem('output-options-changed');
  await project.expectFilesUnchanged();
  await project.expectNoFile('other-contracts/StoreGame.md');
  await project.read('StoreGame');
  project.expectReadIncludesWholeFile('docs/contracts/StoreGame.md');
});

it('rejects an adapter plan whose only refusal is an unreportable deferred requirement', async () => {
  const project = await OutputsExample.connect();
  await project.registerAdapterReturningDeferredOnlyPlan();
  await project.specify(store);
  await project.rememberFiles();
  await project.tryCreate();
  project.expectContractError(TypeError);
  project.expectWriterWasNotInvoked();
  await project.expectFilesUnchanged();
});

it('does not attribute one capability input to its sibling', async () => {
  const project = await OutputsExample.withContracts(`
type Snapshot { title: Text }
type Receipt { number: Number }
concept StoreGame {
  public save, receipt
  capability save(snapshot: Snapshot) returns Nothing
  capability receipt() returns Receipt
}`);
  await project.search('StoreGame.save');
  project.expectSpecifiedOutgoing(['Snapshot']);
  project.expectNoSpecifiedOutgoing('Receipt');
  await project.search('StoreGame.receipt');
  project.expectSpecifiedOutgoing(['Receipt']);
  project.expectNoSpecifiedOutgoing('Snapshot');
  await project.search('StoreGame');
  project.expectSpecifiedOutgoing(['Snapshot', 'Receipt']);
});

it('does not associate a private capability with a document that omits it', async () => {
  const project = await OutputsExample.withContracts(`concept StoreGame {
  public start
  capability start() returns Nothing
  capability hidden() returns Nothing
}`);
  project.expectConfirmedAssociation('StoreGame.start', 'docs/contracts/StoreGame.md');
  project.expectNoConfirmedAssociation('StoreGame.hidden');
  await project.read('StoreGame.hidden');
  project.expectReadNotFound();
  await project.expectNoCapability('StoreGame', 'hidden');
});

it('does not equate zero observed uses with complete incoming coverage', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.writeMalformedSectionMetadata('notes/draft.md');
  await project.search('StoreGame');
  project.expectNoObservedIncomingUses();
  project.expectIncompleteIncomingCoverageAt('notes/draft.md');
  await project.rememberFiles();
  await project.delete('StoreGame');
  project.expectProblem('incomplete-output-search');
  await project.expectFilesUnchanged();
});

it('does not silently replace output identities after the host loses its baseline', async () => {
  const project = await OutputsExample.withContracts(store);
  await project.reidentifyWithUnrelatedNewIdentifiers(store);
  await project.rememberFiles();
  await project.update();
  project.expectProblem('unknown-output-identity');
  await project.expectFilesUnchanged();
});

describe('the structural JSON output has its own real lifecycle', () => {
  it('writes a readable structure and reopens without rewriting it', async () => {
    const project = await OutputsExample.withStructure(store);
    await project.expectStructuredDeclaration('design/structure/StoreGame.structure.json', {
      name: 'StoreGame', kind: 'concept', dependencies: ['Storage'],
      capabilities: ['save(snapshot: Snapshot) returns Nothing'],
    });
    await project.rememberFilesAndMetadata();
    await project.reopenOutput();
    await project.create();
    project.expectReceipt('unchanged');
    await project.expectFilesAndMetadataUnchanged();
  });

  it('reads actual edited JSON from the connected project', async () => {
    const project = await OutputsExample.withStructure(store);
    await project.changeJsonDeclarationName('design/structure/StoreGame.structure.json', 'Handwritten Store');
    await project.read('StoreGame');
    project.expectReadContains('Handwritten Store');
    project.expectReadIncludesWholeFile('design/structure/StoreGame.structure.json');
  });

  it('inserts a new structure without rewriting unrelated structures', async () => {
    const project = await OutputsExample.withStructure(store);
    await project.rememberFileAndMetadata('design/structure/StoreGame.structure.json');
    await project.revise(store + '\nconcept Launcher {}');
    await project.insert();
    await project.expectStructuredDeclaration('design/structure/Launcher.structure.json', { name: 'Launcher', kind: 'concept' });
    await project.expectRememberedFileAndMetadataUnchanged();
  });

  it('updates a capability identity and the containing JSON document', async () => {
    const project = await OutputsExample.withStructure(store);
    project.rememberIdentifier('StoreGame.save');
    await project.renameWithIdentity('StoreGame.save', 'StoreGame.saveGame');
    await project.update();
    project.expectSameIdentifier('StoreGame.saveGame');
    await project.expectStructuredCapability('StoreGame', 'saveGame(snapshot: Snapshot) returns Nothing');
    await project.expectNoStructuredCapability('StoreGame', 'save');
    await project.read('StoreGame.saveGame');
    project.expectReadIncludesWholeFile('design/structure/StoreGame.structure.json');
  });

  it('finds a project-only consumer through documented JSON reference fields', async () => {
    const project = await OutputsExample.withStructure(store);
    await project.writeJson('notes/Launcher.structure.json', {
      format: 'expec-structure-1', outputId: 'structure-list',
      declaration: { kind: 'component', name: 'Launcher', members: [],
        references: [{ role: 'use', specId: project.identifier('StoreGame') }] },
    });
    await project.writeJson('notes/ordinary.json', { text: project.identifier('StoreGame') });
    await project.search('StoreGame');
    project.expectProjectConsumer('notes/Launcher.structure.json');
    project.expectNoProjectConsumer('notes/ordinary.json');
    project.expectSpecifiedOutgoing(['Storage', 'Snapshot']);
    project.expectCompleteWithinScope('expec-structure-1 documents for structure-list');
  });

  it('preserves edited JSON instead of adopting it as generated state', async () => {
    const project = await OutputsExample.withStructure(store);
    await project.changeJsonDeclarationName('design/structure/StoreGame.structure.json', 'Handwritten Store');
    await project.renameWithIdentity('StoreGame.save', 'StoreGame.saveGame');
    await project.rememberFiles();
    await project.update();
    project.expectConflictAt('design/structure/StoreGame.structure.json');
    await project.expectFilesUnchanged();
  });

  it('refuses deletion when a malformed structure document makes uses uncertain', async () => {
    const project = await OutputsExample.withStructure(store);
    await project.write('notes/Launcher.structure.json', '{ "format": "expec-structure-1",');
    await project.search('StoreGame');
    project.expectNoObservedIncomingUses();
    project.expectIncompleteIncomingCoverageAt('notes/Launcher.structure.json');
    await project.rememberFiles();
    await project.delete('StoreGame');
    project.expectProblem('incomplete-output-search');
    await project.expectFilesUnchanged();
  });

  it('deletes an unused structure and can deliberately recreate its active subject', async () => {
    const project = await OutputsExample.withStructure(store);
    project.rememberIdentifier('StoreGame');
    await project.delete('StoreGame');
    project.expectReceipt('applied');
    await project.expectNoFile('design/structure/StoreGame.structure.json');
    await project.expectFile('design/structure/Storage.structure.json');
    await project.reopenOutput();
    await project.deleteRememberedIdentifier();
    project.expectReceipt('unchanged');
    await project.create();
    project.expectReceipt('applied');
    project.expectSameIdentifier('StoreGame');
    await project.expectStructuredDeclaration('design/structure/StoreGame.structure.json', { name: 'StoreGame', kind: 'concept' });
  });
});
