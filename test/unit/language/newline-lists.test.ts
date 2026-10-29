import { expect, it } from 'vitest';
import { readAcceptedSource, expectNavigableSourceForest } from '../../dsl/language/syntax-reading.js';

it('retains blank-separated helper, check and interaction members in authored order', () => {
  const { model } = readAcceptedSource(`concept Store {
  public save
  capability save() returns Nothing
}

examples {
  observation title() returns Text {
    let first = "book"

    return first

  }

  check expectTitle() {
    let actual = title()

    assert actual == "book"

  }

}

interaction "save twice"() {
  participant first: Store

  participant second: Store

  message first -> second.save()

  message second -> first.save()

}
`);
  expect(model.nodes('let').map(node => model.node(node.name, 'name').decoded)).toEqual(['first', 'actual']);
  expect(model.nodes('return')).toHaveLength(1);
  expect(model.nodes('assert')).toHaveLength(1);
  expect(model.nodes('participant').map(node => model.node(node.name, 'name').decoded)).toEqual(['first', 'second']);
  expect(model.nodes('message')).toHaveLength(2);
  expectNavigableSourceForest(model);
});
