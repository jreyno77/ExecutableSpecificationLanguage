import { describe, it } from 'vitest';
import { DiagramExamples } from '../../../dsl/project/output/diagrams.js';

describe('diagrams of declared capability calls', { timeout: 30_000 }, () => {
  it('shows export calling ship and reads the actual operation endpoints', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`component Courier {
  public ship
  capability ship() returns Nothing
}
component ResultsRelay {
  public export
  capability export() returns Nothing {
    calls Courier.ship
    promises "Delivers the result to the selected destination"
  }
}`);
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'ResultsRelay', to: 'Courier', role: 'call', label: 'export calls ship' });
    await diagrams.search('ResultsRelay.export');
    diagrams.expectOutgoingTo('Courier.ship');
    diagrams.expectCompleteWithinNativeProfile();
    await diagrams.search('Courier.ship');
    diagrams.expectIncomingDeclaredOccurrence('ResultsRelay.export');
    diagrams.expectCompleteWithinNativeProfile();
  });

  it('does not make a dependency-only relationship a call', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`component Courier {}
component Relay {
  depends on Courier
  capability export() returns Nothing
}`);
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'Relay', to: 'Courier', role: 'dependency' });
    diagrams.expectNoRole({ from: 'Relay', to: 'Courier', role: 'call' });
    diagrams.expectNoSequenceFiles();
  });

  it('draws one finite self relationship for a repeated declared target', async () => {
    const diagrams = await DiagramExamples.connect();
    diagrams.specify(`component Worker {
  public first, second
  capability first() returns Nothing { calls second, second }
  capability second() returns Nothing
}`);
    await diagrams.create({ views: ['structure'] });
    diagrams.expectRole({ from: 'Worker', to: 'Worker', role: 'call', label: 'first calls second' });
    diagrams.expectNativeExplicitEdgeCount(1);
    await diagrams.search('Worker.first');
    diagrams.expectOutgoingTo('Worker.second');
  });
});
