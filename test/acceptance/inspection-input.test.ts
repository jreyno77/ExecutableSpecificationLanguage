import { describe, it } from 'vitest';
import { expectNoInspectableSource } from '../support/source-inspection.js';

describe('Source inspection prerequisites', () => {
  it('does not offer an inspectable description when the author has omitted a concept name', () => {
    expectNoInspectableSource('concept { }');
  });
});
