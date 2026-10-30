import { describe, it } from 'vitest';
import { DiagramExamples } from '../../../dsl/project/output/diagrams.js';

describe('complete declared structural contracts', { timeout: 30_000 }, () => {
  it('shows public and internal signatures with their actual relationships', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`opaque type URL
opaque type Receipt
opaque type Storage
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
    diagrams.expectSignature('Relay.send', 'send(payload: Payload) → Receipt');
    diagrams.expectSignature('Relay.cache', 'cache(address: Address) → Receipt');
    diagrams.expectCapabilityVisibility('Relay.send', 'public');
    diagrams.expectCapabilityVisibility('Relay.cache', 'internal');
    diagrams.expectAuthoredPublicCapabilities('Relay', ['send']);
    diagrams.expectRole({ from: 'Payload', to: 'Relay', role: 'input', label: 'send.payload: Payload' });
    diagrams.expectRole({ from: 'Address', to: 'Relay', role: 'input', label: 'cache.address: Address' });
    diagrams.expectRole({ from: 'Relay', to: 'Receipt', role: 'output', label: 'send result: Receipt' });
    diagrams.expectRole({ from: 'Relay', to: 'Receipt', role: 'output', label: 'cache result: Receipt' });
    diagrams.expectRole({ from: 'Relay', to: 'Rejected', role: 'failure', label: 'may fail with Rejected' });
    diagrams.expectCapabilityRole('Relay.send', 'failure', 'Rejected');
    diagrams.expectCapabilityRole('Relay.cache', 'failure', 'Rejected');
    diagrams.expectRole({ from: 'Relay', to: 'Storage', role: 'dependency' });
    diagrams.expectRole({ from: 'Payload', to: 'Address', role: 'field', label: 'field: destination: Address' });
    diagrams.expectRole({ from: 'Address', to: 'URL', role: 'alias', label: 'alias of URL' });
    diagrams.expectNativeExplicitEdgeCount(9); // two independent failure edges, one per capability
    diagrams.expectNoOwnershipDiamonds();
    diagrams.expectNoSequenceFiles();
    await diagrams.search('Relay.cache');
    diagrams.expectNoDuplicateDefinition('Relay.cache');
    diagrams.expectDefinitionStatement('Relay.cache', '"-cache(address: Address)": Receipt');
    diagrams.expectOutgoingTo('Address');
    diagrams.expectOutgoingTo('Receipt');
    diagrams.expectOutgoingTo('Rejected');
    diagrams.expectCompleteWithinNativeProfile();
    await diagrams.read('Relay.cache.address');
    diagrams.expectReadFiles(['design/structure.d2', 'design/structure.svg']);
    diagrams.expectReadBytesEqualFiles();
  });

  it('renders the same complete structural facts in a compact downward layout', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`opaque type URL
opaque type Storage
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
    diagrams.expectSignature('Relay.send', 'send(payload: Payload) → Address');
    diagrams.expectRole({ from: 'Payload', to: 'Relay', role: 'input' });
    diagrams.expectRole({ from: 'Relay', to: 'Address', role: 'output' });
    diagrams.expectRole({ from: 'Relay', to: 'Rejected', role: 'failure' });
    diagrams.expectRole({ from: 'Relay', to: 'Storage', role: 'dependency' });
    diagrams.expectRole({ from: 'Payload', to: 'Address', role: 'field' });
    diagrams.expectRole({ from: 'Address', to: 'URL', role: 'alias' });
    diagrams.expectNativeExplicitEdgeCount(6);
    diagrams.expectNativeSvgDocuments(1);
    diagrams.expectNativeSvgLabel('Relay');
    diagrams.expectNativeSvgLabel('send(payload: Payload)');
    diagrams.expectSvgDigestMatchesActualSource('design/structure.svg', 'design/structure.d2');
    diagrams.expectSvgContainsNoExternalAssetReferences();
  });
});


describe('wrapped native type displays', { timeout: 30_000 }, () => {
it('wraps union displays without changing literal values or callable keys', async () => {
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
  diagrams.expectSignature('Relay.send', 'send() → "complete" | "working" | "failed"');
  diagrams.expectDisplayedReturn('Relay.send', '"complete" |\n"working" |\n"failed"');
  diagrams.expectDisplayedField('Rejected', 'code', '"invalid-destination" |\n"invalid-payload" |\n"shipping-issue"');
  diagrams.expectDisplayedField('Rejected', 'note', '"keep | this  spacing"');
  diagrams.expectDisplayedField('Destination', 'alias', 'Destination = "remote" |\n"database" |\n"filesystem"');
  diagrams.expectStructureDirection('down');
  diagrams.expectUnverifiedPromise('Relay.send', 'Keep  two spaces | and punctuation.');
  await diagrams.search('Relay.send');
  diagrams.expectDefinitionKey('Relay.send', '"send()"');
  diagrams.expectNativeSvgDocuments(1);
});
});
