import { describe, it } from 'vitest';
import { ReadableInspection } from '../dsl/readable-inspection.js';

describe('a contract viewer reads declarations without reconstructing them', () => {
  it('reads capability names in authored order', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability startup(configurations: SystemConfig)
  capability saveGame(snapshot: PlayerStateSnapshot)
}`);

    inspection.expectCapabilityNames(['startup', 'saveGame']);
  });

  it('reads differently named inputs directly in their declared order', () => {
    const inspection = new ReadableInspection();
    inspection.sourceIs('store.expec', `concept StoreGame {
  capability merge(left: List<Pair<Number>>, right: List<Pair<Number>>)
}`);

    inspection.expectCapabilityInputs([['left', 'right']]);
  });
});
