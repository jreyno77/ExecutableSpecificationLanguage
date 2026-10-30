import { describe, it } from 'vitest';
import { CallableRelationships } from '../../dsl/compiler/callable-relationships.js';

const calculator = `opaque type Json
component DataToNumbers {
  public transform
  capability transform(value: Json) returns Number
}
component Calculator {
  public add
  capability add(jsonleft: Json, jsonright: Json) returns Number {
    calls DataToNumbers.transform
    promises "Returns the sum of the transformed inputs"
  }
}`;

describe('declaring which operations a capability calls', () => {
  it('attaches the transformer relationship specifically to add without implementing it', () => {
    const design = new CallableRelationships();
    design.source(calculator);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Calculator.add', ['DataToNumbers.transform']);
    design.expectCalls('DataToNumbers.transform', []);
    design.expectComponentDependency('Calculator', 'DataToNumbers', false);
    design.expectPromise('Calculator.add', 'Returns the sum of the transformed inputs');
  });

  it('does not invent a call from an explicitly declared dependency', () => {
    const design = new CallableRelationships();
    design.source(`component Courier {}
component Relay {
  depends on Courier
  capability export() returns Nothing
}`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Relay.export', []);
    design.expectComponentDependency('Relay', 'Courier');
  });

  it('keeps every authored occurrence but exposes one direct relationship', () => {
    const design = new CallableRelationships();
    design.source(`component Numbers {
  capability normalize() returns Number
  capability add() returns Number {
    calls normalize, normalize
    calls normalize
  }
}`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Numbers.add', ['Numbers.normalize']);
    design.expectCallOccurrences('Numbers.normalize', 3);
    design.expectImmutableAnswers('Numbers.add', ['Numbers.normalize']);
  });

  it('rejects a misspelled operation at the authored reference', () => {
    const design = new CallableRelationships();
    design.source(`component Courier {
  public ship
  capability ship() returns Nothing
}
component Relay {
  capability export() returns Nothing { calls Courier.shpi }
}`);
    design.compile();
    design.expectProblem('unresolved-reference', 'Courier.shpi');
  });

  it('rejects another component\'s internal operation', () => {
    const design = new CallableRelationships();
    design.source(`component Courier { capability ship() returns Nothing }
component Relay { capability export() returns Nothing { calls Courier.ship } }`);
    design.compile();
    design.expectProblem('inaccessible-reference', 'Courier.ship');
  });

  it('rejects a component where a callable is required', () => {
    const design = new CallableRelationships();
    design.source(`component Courier {}
component Relay { capability export() returns Nothing { calls Courier } }`);
    design.compile();
    design.expectProblem('wrong-reference-kind', 'Courier');
  });

  it('keeps mutually recursive and self relationships finite in either query order', () => {
    const design = new CallableRelationships();
    design.source(`component Worker {
  capability first() returns Nothing { calls second }
  capability second() returns Nothing { calls first, second }
}`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Worker.second', ['Worker.first', 'Worker.second']);
    design.expectCalls('Worker.first', ['Worker.second']);
    design.expectImmutableAnswers('Worker.second', ['Worker.first', 'Worker.second']);
  });

  it('allows a function caller and two distinct callable targets', () => {
    const design = new CallableRelationships();
    design.source(`function normalize() returns Number
component Numbers {
  public transform
  capability transform() returns Number
}
function add() returns Number { calls normalize, Numbers.transform }`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('add', ['normalize', 'Numbers.transform']);
    design.expectCalls('normalize', []);
    design.expectQueryError('Numbers', 'unexpected-kind');
    design.expectForeignQueryError();
  });

  it('binds the imported alias separately from the operation it selects', () => {
    const design = new CallableRelationships();
    design.module('courier', `component Courier {
  public ship
  capability ship() returns Nothing
}`);
    design.source(`use Courier as Delivery from "courier"
component Relay {
  capability export() returns Nothing { calls Delivery.ship }
}`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Relay.export', ['Courier.ship']);
    design.expectReferenceTarget('Delivery.ship', 'Courier.ship');
    design.expectAliasOccurrences('Delivery', [
      { text: 'Delivery', within: 'use Courier as Delivery' },
      { text: 'Delivery', within: 'calls Delivery.ship' },
    ]);
    design.expectDeclarationOccurrences('Courier', [
      { text: 'Courier', within: 'component Courier', sourceId: 'courier.expec' },
      { text: 'Courier', within: 'use Courier as Delivery' },
    ]);
    design.expectDeclarationOccurrences('Courier.ship', [
      { text: 'ship', within: 'public ship', sourceId: 'courier.expec' },
      { text: 'ship', within: 'capability ship()', sourceId: 'courier.expec' },
      { text: 'ship', within: 'calls Delivery.ship' },
    ]);
  });

  it('uses a public external signature without claiming to know its calls', () => {
    const design = new CallableRelationships();
    design.external('vendor:courier', [{ kind: 'component', name: 'Courier', public: ['ship'],
      members: [{ kind: 'capability', name: 'ship', parameters: [], result: { kind: 'builtin', name: 'Nothing' } }] }]);
    design.source(`use Courier from "vendor:courier"
component Relay { capability export() returns Nothing { calls Courier.ship } }`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Relay.export', ['Courier.ship']);
    design.expectQueryError('Courier.ship', 'not-analyzed');
  });

  it('retains a composition prerequisite and an independently invalid target', () => {
    const design = new CallableRelationships();
    design.source(`include "extensions"
component Relay { capability export() returns Nothing { calls Courier.ship, Relay } }`);
    design.compile();
    design.expectDeferredReference('Courier.ship');
    design.expectProblem('wrong-reference-kind', 'Relay');
  });

  it('rejects a parameter that shadows an otherwise callable name', () => {
    const design = new CallableRelationships();
    design.source(`function normalize() returns Number
function add(normalize: Number) returns Number { calls normalize }`);
    design.compile();
    design.expectProblem('wrong-reference-kind', 'normalize');
  });

  it('rejects executable arguments in a relationship declaration', () => {
    const design = new CallableRelationships();
    design.source(`component Numbers {
  capability transform(value: Number) returns Number
  capability add(value: Number) returns Number { calls transform(value) }
}`);
    design.compile();
    design.expectSyntaxProblemAt('(', 'calls transform(value)');
  });

  it('keeps relationship clauses out of executable example helper bodies', () => {
    const design = new CallableRelationships();
    design.source(`component Numbers {
  capability transform(value: Number) returns Number
  examples { observation value() returns Number { calls transform } }
}`);
    design.compile();
    design.expectSyntaxProblemAt('calls', 'observation value() returns Number { calls transform }');
  });

  it('preserves existing declarations whose authored name is calls', () => {
    const design = new CallableRelationships();
    design.source(`component Counter {
  capability calls() returns Number
  capability count() returns Number { calls calls }
}`);
    design.compile();
    design.expectAccepted();
    design.expectCalls('Counter.count', ['Counter.calls']);
  });
});
