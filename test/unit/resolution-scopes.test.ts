import { describe, expect, it } from 'vitest';
import { createSyntaxReader, DescriptionInspection, Resolver } from '../../src/index.js';
import { DeclarationResolution } from '../support/declaration-resolution.js';

describe('a caller discovers supplied declarations in a stable order', () => {
  it('uses locator and supplied declaration order even when imports select them in reverse', () => {
    const read = createSyntaxReader().read({ sourceId: 'imports.expec', text: `use Zebra from "zebra"
use First, Second from "apple"` });
    if (read.status !== 'accepted') throw new Error('The ordering example must be grammatical.');

    const report = new Resolver().resolve(new DescriptionInspection(read.description), {
      packages: [],
      modules: [
        {
          locator: 'zebra',
          declarations: [{ id: 'zebra', name: 'Zebra', kind: 'record-type', links: [] }],
          exports: [{ path: ['Zebra'], declaration: 'zebra' }],
        },
        {
          locator: 'apple',
          declarations: [
            { id: 'second', name: 'Second', kind: 'record-type', links: [] },
            { id: 'first', name: 'First', kind: 'record-type', links: [] },
          ],
          exports: [{ path: ['First'], declaration: 'first' }, { path: ['Second'], declaration: 'second' }],
        },
      ],
    });

    expect(report.problems).toEqual([]);
    const supplied = [...report.declarations()].filter(declaration => declaration.origin.kind === 'external');
    expect(supplied.map(declaration => declaration.name)).toEqual(['Second', 'First', 'Zebra']);
  });
});

describe('an author keeps composition requirements within their possible scope', () => {
  it('defers an extended owners missing capability but still reports an unrelated missing type', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame { public save }
extend StoreGame { capability save() }
function unrelated(value: Typo)`);

    resolution.resolveDeclarations();

    resolution.expectDeferred(['save'], 'composition');
    resolution.expectInvalid(['Typo'], 'unresolved-reference');
    resolution.expectProblem('unresolved-reference', { line: 3, column: 27 });
  });
});

describe('an author attaches examples to a declared subject', () => {
  it('can use a later source subjects capabilities and local types from its own examples block', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`examples for StoreGame {
  action exercise(snapshot: SessionState) returns Nothing { do save(snapshot) }
}
concept StoreGame {
  local type SessionState {}
  capability save(snapshot: SessionState) returns Nothing
}`);

    resolution.resolveDeclarations();

    resolution.expectNoProblems();
    resolution.expectBound(['save'], { name: 'save', kind: 'capability' });
    resolution.expectSameTargets(['SessionState'], ['SessionState'], 0, 1);
    resolution.expectDeclaration('exercise', 'action', 'StoreGame');
  });

  it('does not expose one attached blocks helpers to another block for the same subject', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame {}
examples for StoreGame { action prepare() returns Nothing }
examples for StoreGame { action exercise() returns Nothing { do prepare() } }`);

    resolution.resolveDeclarations();

    resolution.expectInvalid(['prepare'], 'unresolved-reference');
  });

  it('retains an unavailable subject cause instead of selecting an unrelated outer operation', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`function save() returns Nothing
examples for Missing { action exercise() returns Nothing { do save() } }`);

    resolution.resolveDeclarations();

    resolution.expectInvalid(['Missing'], 'unresolved-reference');
    resolution.expectInvalid(['save'], 'unresolved-reference');
    resolution.expectProblemCodes(['unresolved-reference']);
    resolution.expectBound(['Nothing'], { name: 'Nothing', kind: 'builtin-type' }, 1);
  });

  it('does not bypass a local subjects accessibility when attaching an examples block', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`concept StoreGame { local concept Hidden { capability save() } }
examples for StoreGame.Hidden { action exercise() returns Nothing { do save() } }`);

    resolution.resolveDeclarations();

    resolution.expectInvalid(['StoreGame', 'Hidden'], 'inaccessible-reference');
    resolution.expectInvalid(['save'], 'inaccessible-reference');
  });

  it('defers subject-dependent names when supplied metadata provides no authored examples scope', () => {
    const resolution = new DeclarationResolution();
    resolution.sourceIs(`use StoreGame from "store"
function save() returns Nothing
examples for StoreGame { action exercise() returns Nothing { do save() } }`);
    resolution.dependenciesAre({ packages: [], modules: [{
      locator: 'store',
      declarations: [{ id: 'store', name: 'StoreGame', kind: 'concept', links: [] }],
      exports: [{ path: ['StoreGame'], declaration: 'store' }],
    }] });

    resolution.resolveDeclarations();

    resolution.expectBound(['StoreGame'], { name: 'StoreGame', kind: 'concept', origin: { kind: 'external' } }, 1);
    resolution.expectDeferred(['save'], 'composition');
    resolution.expectBound(['Nothing'], { name: 'Nothing', kind: 'builtin-type' }, 1);
  });
});
