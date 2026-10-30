import { describe, it } from 'vitest';
import { DiagramExamples } from '../../../dsl/project/output/diagrams.js';

describe('complete declared structural contracts', { timeout: 30_000 }, () => {
  it('shows public and internal signatures with their actual relationships', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`opaque type URL
component Receipt {}
component Storage {}
type Address = URL
type Payload { destination: Address }
error type Rejected { code: "invalid-destination" }
concept Relay {
  depends on Storage
  public send
  capability send(payload: Payload) returns Receipt fails with Rejected
  capability cache(address: Address) returns Receipt fails with Rejected
}`);
    await diagrams.create({ views: ['structure'] });
    diagrams.expectOperationLabel('Relay.send', 'send(payload)');
    diagrams.expectOperationLabel('Relay.cache', 'cache(address)');
    diagrams.expectCapabilityVisibility('Relay.send', 'public');
    diagrams.expectCapabilityVisibility('Relay.cache', 'internal');
    diagrams.expectAuthoredPublicCapabilities('Relay', ['send']);
    diagrams.expectRole({ from: 'Relay', to: 'Receipt', role: 'output', label: 'result: send' });
    diagrams.expectRole({ from: 'Relay', to: 'Receipt', role: 'output', label: 'result: cache' });
    diagrams.expectCapabilityRole('Relay.send', 'output', 'Receipt');
    diagrams.expectCapabilityRole('Relay.cache', 'output', 'Receipt');
    diagrams.expectDeclaredFailure('Relay.send', 'Rejected');
    diagrams.expectDeclaredFailure('Relay.cache', 'Rejected');
    diagrams.expectDeclaredParameterReferences('Relay.send', 'payload', ['Payload']);
    diagrams.expectDeclaredParameterReferences('Relay.cache', 'address', ['Address']);
    diagrams.expectRole({ from: 'Relay', to: 'Storage', role: 'dependency' });
    diagrams.expectDeclaredFieldReference('Payload', 'destination', 'Address');
    diagrams.expectDeclaredAliasReference('Address', 'URL');
    diagrams.expectNoDiagramDefinitions(['URL', 'Address', 'Payload', 'Rejected']);
    diagrams.expectNativeExplicitEdgeCount(3); // two distinct capability outputs and one component dependency
    diagrams.expectNoOwnershipDiamonds();
    diagrams.expectNoSequenceFiles();
    await diagrams.search('Relay.cache');
    diagrams.expectNoDuplicateDefinition('Relay.cache');
    diagrams.expectDefinitionStatement('Relay.cache', '"-cache(address)": ""');
    diagrams.expectNoOutgoingTo('Address');
    diagrams.expectOutgoingTo('Receipt');
    diagrams.expectNoOutgoingTo('Rejected');
    diagrams.expectCompleteWithinNativeProfile();
    await diagrams.read('Relay.cache.address');
    diagrams.expectReadFiles(['design/structure.d2', 'design/structure.svg']);
    diagrams.expectReadBytesEqualFiles();
  });

  it('renders the same complete structural facts in a compact downward layout', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`opaque type URL
component Storage {}
type Address = URL
type Payload { destination: Address }
error type Rejected { code: "invalid-destination" }
concept Relay {
  depends on Storage
  capability send(payload: Payload) returns Address fails with Rejected
}`);
    await diagrams.create({ views: ['structure'] });
    diagrams.expectStructureDirection('down');
    diagrams.expectCapabilityVisibility('Relay.send', 'internal');
    diagrams.expectOperationLabel('Relay.send', 'send(payload)');
    diagrams.expectDeclaredParameterReferences('Relay.send', 'payload', ['Payload']);
    diagrams.expectDeclaredReturnShape('Relay.send', 'named-type');
    diagrams.expectDeclaredFailure('Relay.send', 'Rejected');
    diagrams.expectRole({ from: 'Relay', to: 'Storage', role: 'dependency' });
    diagrams.expectDeclaredFieldReference('Payload', 'destination', 'Address');
    diagrams.expectDeclaredAliasReference('Address', 'URL');
    diagrams.expectNoDiagramDefinitions(['URL', 'Address', 'Payload', 'Rejected']);
    diagrams.expectNativeExplicitEdgeCount(1);
    diagrams.expectNativeSvgDocuments(1);
    diagrams.expectNativeSvgLabel('Relay');
    diagrams.expectNativeSvgLabel('send(payload)');
    diagrams.expectSvgDigestMatchesActualSource('design/structure.svg', 'design/structure.d2');
    diagrams.expectSvgContainsNoExternalAssetReferences();
  });
});


describe('literal specification meaning survives architectural presentation', { timeout: 30_000 }, () => {
it('omits union clutter without changing literal values, promise spacing or callable keys', async () => {
  const diagrams = await DiagramExamples.connect();
  diagrams.specify(`type Destination = "remote" | "database" | "filesystem"
error type Rejected {
  code: "invalid-destination" | "invalid-payload" | "shipping-issue"
  note: "keep | this  spacing"
}
concept Relay {
  public send
  capability send() returns "complete" | "working" | "failed" {
    promises "Keep  two spaces | and punctuation."
  }
}`);
  await diagrams.create({ views: ['structure'] });
  diagrams.expectOperationLabel('Relay.send', 'send()');
  diagrams.expectDeclaredReturnLiterals('Relay.send', ['complete', 'working', 'failed']);
  diagrams.expectDeclaredFieldUnionLiterals('Rejected', 'code', ['invalid-destination', 'invalid-payload', 'shipping-issue']);
  diagrams.expectDeclaredFieldLiteral('Rejected', 'note', 'keep | this  spacing');
  diagrams.expectDeclaredAliasUnionLiterals('Destination', ['remote', 'database', 'filesystem']);
  diagrams.expectNoDiagramDefinitions(['Rejected', 'Destination']);
  diagrams.expectStructureDirection('down');
  diagrams.expectPromiseSection('Relay', 'send', ['Keep  two spaces | and punctuation.']);
  diagrams.expectAuthoredPromises('Relay.send', ['Keep  two spaces | and punctuation.']);
  await diagrams.search('Relay.send');
  diagrams.expectDefinitionKey('Relay.send', '"send()"');
  diagrams.expectNativeSvgDocuments(1);
});
});
