import { describe, expect, it } from 'vitest';
import { callbackPromises, queryPromises } from '../resources/inspection/promise-analyses.js';
import { readSpecification } from '../support/source-inspection.js';

describe('A new consumer inspects authored promises', () => {
  it('collects promise text through visitor callbacks', () => {
    const source = readSpecification(`concept StoreGame {
  capability startup() returns Nothing {
    promises "The main page is visible"
  }
  capability saveGame() returns Nothing {
    promises "A snapshot of the game is saved"
  }
}`);

    expect(callbackPromises(source)).toEqual([
      'The main page is visible',
      'A snapshot of the game is saved',
    ]);
  });

  it('collects promise text through iterable queries', () => {
    const source = readSpecification(`concept StoreGame {
  capability startup() returns Nothing {
    promises "The main page is visible"
  }
  capability saveGame() returns Nothing {
    promises "A snapshot of the game is saved"
  }
}`);

    expect(queryPromises(source)).toEqual([
      'The main page is visible',
      'A snapshot of the game is saved',
    ]);
  });
});

