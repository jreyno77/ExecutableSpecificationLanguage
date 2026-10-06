import { describe, expect, it } from 'vitest';
import { LangiumReader, LangiumModel, Resolver, TypeDescriber, type Item, type TypeId } from '../../../src/index.js';
import { TypeCompatibility } from '../../../src/compiler/type-compatibility.js';

describe('an expression checker compares described types', () => {
  it('accepts a transparent Number alias without confusing Number with Text', () => {
    const types = describeTypes('type Count = Number');
    expect(types.assignable('Count', 'Number')).toEqual(known(true));
    expect(types.assignable('Number', 'Text')).toEqual(known(false));
  });

  it('keeps records with the same fields nominally distinct', () => {
    const types = describeTypes('type Cart { count: Number }\ntype Basket { count: Number }');
    expect(types.assignable('Cart', 'Cart')).toEqual(known(true));
    expect(types.assignable('Cart', 'Basket')).toEqual(known(false));
  });

  it('compares generic arguments through aliases but keeps applications invariant', () => {
    const types = describeTypes('type Box<T> { value: T }\ntype Count = Number\ntype Counts = Box<Count>\ntype Numbers = Box<Number>\ntype Mixed = Box<Number | Text>');
    expect(types.assignable('Counts', 'Numbers')).toEqual(known(true));
    expect(types.assignable('Numbers', 'Mixed')).toEqual(known(false));
  });

  it('requires every source union alternative and accepts a fitting destination alternative', () => {
    const types = describeTypes('type Mixed = Number | Text');
    expect(types.assignable('Mixed', 'Number')).toEqual(known(false));
    expect(types.assignable('Number', 'Mixed')).toEqual(known(true));
  });

  it('treats reordered union arguments as the same invariant meaning', () => {
    const types = describeTypes('type Box<T> {}\ntype First = Box<Number | Text>\ntype Second = Box<Text | Number>');
    expect(types.assignable('First', 'Second')).toEqual(known(true));
  });

  it('allows required values in an optional destination without unwrapping optional sources', () => {
    const types = describeTypes('type Maybe = Number?');
    expect(types.assignable('Number', 'Maybe')).toEqual(known(true));
    expect(types.assignable('Maybe', 'Number')).toEqual(known(false));
  });

  it('checks tuple length and position without turning tuples into lists', () => {
    const types = describeTypes('type Pair = [Number, Text]\ntype Same = [Number, Text]\ntype Reversed = [Text, Number]\ntype Extra = [Number, Text, Number]\ntype Numbers = List<Number>');
    expect(types.assignable('Pair', 'Same')).toEqual(known(true));
    expect(types.assignable('Pair', 'Reversed')).toEqual(known(false));
    expect(types.assignable('Pair', 'Extra')).toEqual(known(false));
    expect(types.assignable('Pair', 'Numbers')).toEqual(known(false));
  });

  it('widens a literal type to its primitive without narrowing an arbitrary primitive', () => {
    const types = describeTypes('type One = 1\ntype Same = 1.0e0');
    expect(types.assignable('One', 'Number')).toEqual(known(true));
    expect(types.assignable('Number', 'One')).toEqual(known(false));
    expect(types.assignable('One', 'Same')).toEqual(known(true));
  });

  it('retains both original causes when the compared aliases are invalid', () => {
    const types = describeTypes('type First = MissingFirst\ntype Second = MissingSecond');
    const result = types.assignable('First', 'Second');
    expect(result.value).toBeUndefined();
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toBe(types.resolution.problems[0]);
    expect(result.problems[1]).toBe(types.resolution.problems[1]);
  });

  it('retains the original deferred prerequisite instead of deciding compatibility', () => {
    const types = describeTypes('include "later"\ntype Pending = Later');
    const result = types.assignable('Pending', 'Number');
    expect(result.value).toBeUndefined();
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0]).toBe(types.resolution.deferred[0]);
  });
});

describe('an expression checker checks authored literals exactly', () => {
  it('matches decimal spellings by value without rounding adjacent large integers', () => {
    const types = describeTypes('type One = 1\ntype Large = 9007199254740992\nfunction same(value: Number = 1.0e0)\nfunction different(value: Number = 9007199254740993)');
    expect(types.literal('same', 'One')).toEqual(known(true));
    expect(types.literal('different', 'Large')).toEqual(known(false));
  });

  it('matches a grouped single-sign literal and treats negative zero as zero', () => {
    const types = describeTypes('type Minus = -1\ntype Zero = 0\nfunction negative(value: Number = -(1.00e0))\nfunction zero(value: Number = -0.0)');
    expect(types.literal('negative', 'Minus')).toEqual(known(true));
    expect(types.literal('zero', 'Zero')).toEqual(known(true));
  });

  it('does not fold arithmetic into a literal match', () => {
    const types = describeTypes('type Two = 2\nfunction calculated(value: Number = 1 + 1)');
    expect(types.literal('calculated', 'Two')).toEqual(known(false));
    expect(types.literal('calculated', 'Number')).toBeUndefined();
  });

  it('matches decoded text and Boolean literals without coercion', () => {
    const types = describeTypes('type Label = "saved"\ntype Yes = true\nfunction text(value: Text = "saved")\nfunction flag(value: Boolean = true)');
    expect(types.literal('text', 'Label')).toEqual(known(true));
    expect(types.literal('flag', 'Yes')).toEqual(known(true));
    expect(types.literal('text', 'Yes')).toEqual(known(false));
  });
});

describe('an expression checker identifies value-comparable types', () => {
  it('admits primitive, tuple, optional and list contents', () => {
    const types = describeTypes('type Pair = [Number, Text?]\ntype Numbers = List<Number>');
    expect(types.comparable('Number')).toEqual(known(true));
    expect(types.comparable('Pair')).toEqual(known(true));
    expect(types.comparable('Numbers')).toEqual(known(true));
  });

  it('rejects concept values and requires every union alternative to be comparable', () => {
    const types = describeTypes('concept Service {}\ntype Mixed = Number | Service\ntype Services = List<Service>');
    expect(types.comparable('Service')).toEqual(known(false));
    expect(types.comparable('Mixed')).toEqual(known(false));
    expect(types.comparable('Services')).toEqual(known(false));
  });

  it('checks recursive record contents finitely', () => {
    const types = describeTypes('type Tree { value: Number\nchildren: List<Tree> }');
    expect(types.comparable('Tree')).toEqual(known(true));
  });

  it('terminates when recursive generic fields expand their type arguments', () => {
    const types = describeTypes('type Wrap<T> { next: Wrap<Wrap<T>>? }\ntype Numbers = Wrap<Number>');
    expect(types.comparable('Numbers')).toEqual(known(true));
  });

  it('checks changed recursive arguments without rejecting unused opaque arguments', () => {
    const types = describeTypes('opaque type Handle\ntype Switch<T> { next: Switch<Handle>?\nvalue: T }\ntype Empty<T> {}\ntype Numbers = Switch<Number>\ntype Phantom = Empty<Handle>');
    expect(types.comparable('Numbers')).toEqual(known(false));
    expect(types.comparable('Phantom')).toEqual(known(true));
    expect(types.comparable('Handle')).toEqual(known(false));
  });

  it('keeps an invalid record field cause when checking comparability', () => {
    const types = describeTypes('type Broken { value: Missing }');
    const result = types.comparable('Broken');
    expect(result.value).toBeUndefined();
    expect(result.problems[0]).toBe(types.resolution.problems[0]);
  });
});

function known(value: boolean) { return { value, problems: [], deferred: [] }; }
function describeTypes(text: string) {
  const read = new LangiumReader().read({ sourceId: 'compatibility.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('compatibility', read.document), { modules: [], packages: [] });
  const catalog = new TypeDescriber().describe(resolution);
  const compatibility = new TypeCompatibility(catalog);
  function type(name: string): TypeId {
    const declaration = [...catalog.typeDeclarations(), ...[...catalog.inspection.query('builtin-type')].map(node => node.id)]
      .find(id => { const node = catalog.inspection.read(id); return 'name' in node && node.name === name; });
    if (!declaration) throw new Error('Expected type ' + name);
    return catalog.declaredType(declaration);
  }
  function initializer(name: string): Item {
    const callable = [...catalog.inspection.query('function')].find(node => node.name === name);
    const value = callable?.parameters[0]?.defaultValue;
    if (!value) throw new Error('Expected initializer on ' + name);
    return value;
  }
  return { resolution, catalog, compatibility, type,
    assignable: (source: string, target: string) => compatibility.assignable(type(source), type(target)),
    comparable: (name: string) => compatibility.comparable(type(name)),
    literal: (callable: string, target: string) => compatibility.literal(initializer(callable), type(target)) };
}
