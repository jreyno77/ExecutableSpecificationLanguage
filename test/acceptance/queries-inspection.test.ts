import { describe, it } from 'vitest';
import { SourceAnalyses } from '../support/source-inspection.js';

describe('Typed query source inspection', () => {
  it('lets a consumer list capability declarations in authored order', () => {
    const analysis = new SourceAnalyses('queries');
    analysis.sourceIs(`concept StoreGame {
  capability startup() returns Nothing
  capability saveGame(snapshot: PlayerStateSnapshot) returns Nothing
}`);
    analysis.expectCapabilities([
      { name: 'startup', line: 2, column: 3 },
      { name: 'saveGame', line: 3, column: 3 },
    ]);
  });

  it('lets another consumer collect every nested type-use occurrence', () => {
    const analysis = new SourceAnalyses('queries');
    analysis.sourceIs('type Positions = List<Pair<Number>>');
    analysis.expectTypeUses([
      { segments: ['List'], line: 1, column: 18 },
      { segments: ['Pair'], line: 1, column: 23 },
      { segments: ['Number'], line: 1, column: 28 },
    ]);
  });

  it('retains repeated uses instead of collapsing them into one declaration', () => {
    const analysis = new SourceAnalyses('queries');
    analysis.sourceIs(`type Saves {
  first: PlayerStateSnapshot
  second: PlayerStateSnapshot
}`);
    analysis.expectTypeUses([
      { segments: ['PlayerStateSnapshot'], line: 2, column: 10 },
      { segments: ['PlayerStateSnapshot'], line: 3, column: 11 },
    ]);
  });

  it('finds a capability inside a local concept', () => {
    const analysis = new SourceAnalyses('queries');
    analysis.sourceIs(`concept StoreGame {
  local concept Storage {
    capability save() returns Nothing
  }
}`);
    analysis.expectCapabilities([{ name: 'save', line: 3, column: 5 }]);
  });

  it('preserves a quoted name containing a dot as one reference segment', () => {
    const analysis = new SourceAnalyses('queries');
    analysis.sourceIs('type Alias = `State.Snapshot`');
    analysis.expectTypeUses([{ segments: ['State.Snapshot'], line: 1, column: 14 }]);
  });

  it('keeps independent analyses repeatable and leaves the source unchanged', () => {
    const analysis = new SourceAnalyses('queries');
    analysis.sourceIs('concept StoreGame { capability save(snapshot: Text) returns Nothing }');
    analysis.expectAnalysesIndependent();
    analysis.sourceIs('type NewSource = Number');
    analysis.expectCapabilities([]);
    analysis.expectTypeUses([{ segments: ['Number'], line: 1, column: 18 }]);
  });
});
