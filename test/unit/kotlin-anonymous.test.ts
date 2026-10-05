import { expect, it } from 'vitest';
import { KotlinProject } from '../../src/index.js';

it('does not offer a private anonymous-owner token as an authored adoption selector', () => {
  expect(() => new KotlinProject({ outputId: 'kotlin' }, [{ specId: 'operation-1', locator: {
    outputId: 'kotlin', format: 'kotlin-symbol-1', value: { file: 'main.kt', declaration: [
      { kind: 'function', name: 'numbers', parameters: [] }, { kind: 'object', name: '<anonymous@84>' }, { kind: 'function', name: 'get', parameters: ['kotlin.Int'] },
    ] },
  } }])).toThrow(TypeError);
});
