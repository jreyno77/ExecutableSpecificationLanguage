import { describe, expect, it } from 'vitest';
import {
  ExpressionChecker, LangiumModel, LangiumReader, Resolver, TypeDescriber,
  type Check, type TypeId,
} from '../../src/index.js';

describe('a caller selects an explicitly public capability', () => {
  it('resolves a message selector without validating arguments or the result', () => {
    const source = read(`interface Storage {
  public persist
  capability persist(count: Number) returns Missing
}
interaction "save"() {
  participant storage: Storage
  message storage -> storage.persist("many")
}`);

    const selected = source.select('Storage');

    expect(selected.value).toBe(source.operation('persist').id);
    expect(selected.problems).toEqual([]);
    expect(selected.deferred).toEqual([]);
  });

  it('requires explicit public membership even inside the capability owner', () => {
    const source = read(`component Storage {
  capability persist() returns Nothing
  interaction "private message"() {
    participant storage: Storage
    message storage -> storage.persist()
  }
  examples { example "internal call": persist() => satisfies "saved" }
}`);
    const call = [...source.catalog.inspection.query('call-expression')][0]!;

    expect(source.checker.calledOperation(call.id).value).toBe(source.operation('persist').id);
    expect(source.select('Storage').problems).toContainEqual(expect.objectContaining({
      code: 'invalid-member', at: source.message().operation.origin,
    }));
  });

  it('follows an instantiated alias to the receiver contract', () => {
    const source = read(`type Endpoint<T> = T
type Stored = Endpoint<Storage>
interface Storage {
  public persist
  capability persist() returns Nothing
}
interaction "save"() {
  participant storage: Stored
  message storage -> storage.persist()
}`);

    expect(source.select('Stored').value).toBe(source.operation('persist').id);
  });

  it('does not borrow an operation from another receiver', () => {
    const source = read(`interface Storage {}
interface Other {
  public persist
  capability persist() returns Nothing
}
interaction "wrong receiver"() {
  participant storage: Storage
  message storage -> storage.persist()
}`);

    expect(source.select('Storage').value).toBeUndefined();
    expect(source.select('Storage').problems).toContainEqual(expect.objectContaining({ code: 'invalid-member' }));
  });

  it('preserves the cause of an invalid public declaration', () => {
    const source = read(`component Storage {
  public persist
  local type persist {}
}
interaction "not a capability"() {
  participant storage: Storage
  message storage -> storage.persist()
}`);

    expect(source.select('Storage').problems).toContain(source.resolution.problems[0]);
    expect(source.select('Storage').value).toBeUndefined();
  });

  it('keeps unresolved public composition pending', () => {
    const source = read(`interface Storage {}
extend Storage {
  public persist
  capability persist() returns Nothing
}
interaction "pending members"() {
  participant storage: Storage
  message storage -> storage.persist()
}`);

    const selected = source.select('Storage');

    expect(selected.value).toBeUndefined();
    expect(selected.problems).toEqual([]);
    expect(selected.deferred).toContainEqual(expect.objectContaining({ reason: 'composition' }));
  });

  it('does not erase an invalid selector reference', () => {
    const source = read(`interface Storage { public persist
  capability persist() returns Nothing
}
examples { example "bad selector": missing => 1 }`);
    const selector = [...source.catalog.inspection.query('name-expression')][0]!.reference;

    const selected = source.checker.publicCapability(source.type('Storage'), selector.id);

    expect(selected.problems[0]).toBe(source.resolution.problems[0]);
    expect(selected.value).toBeUndefined();
  });

  it('retains an invalid selector even when the receiver also needs narrowing', () => {
    const source = read(`type MaybeStorage = Storage?
interface Storage {}
examples { example "bad selector": missing => 1 }`);
    const selector = [...source.catalog.inspection.query('name-expression')][0]!.reference;

    expect(source.checker.publicCapability(source.type('MaybeStorage'), selector.id).problems)
      .toContain(source.resolution.problems[0]);
  });

  it('does not select a capability through an optional receiver', () => {
    const source = read(`type MaybeStorage = Storage?
interface Storage { public persist
  capability persist() returns Nothing
}
interaction "optional receiver"() {
  participant storage: MaybeStorage
  message storage -> storage.persist()
}`);

    expect(source.select('MaybeStorage').problems).toContainEqual(expect.objectContaining({ code: 'invalid-member' }));
  });

  it('does not guess which union receiver receives a message', () => {
    const source = read(`type Choice = Storage | Other
interface Storage { public persist
  capability persist() returns Nothing
}
interface Other {}
interaction "union receiver"() {
  participant storage: Choice
  message storage -> storage.persist()
}`);

    expect(source.select('Choice').problems).toContainEqual(expect.objectContaining({ code: 'invalid-member' }));
  });
});

describe('a caller checks arguments against an already selected operation', () => {
  it('retains input findings when a catalog copies diagnostic locations', () => {
    const source = read(`component Storage {
  local type Snapshot {}
  public persist
  capability persist(snapshot: Snapshot) returns Nothing
}
interaction "private input"() {
  participant storage: Storage
  message storage -> storage.persist({})
}`);
    const catalog: typeof source.catalog = Object.create(source.catalog);
    catalog.callable = declaration => {
      const signature = source.catalog.callable(declaration);
      return { ...signature, problems: structuredClone(signature.problems) };
    };
    const checker = new ExpressionChecker(catalog), message = source.message();

    expect(checker.checkArguments(source.operation('persist').id, message.arguments.map(argument => argument.id), message.id).problems)
      .toContainEqual(expect.objectContaining({ code: 'private-type-exposure' }));
  });

  it('does not treat an invalid public result as an argument failure', () => {
    const source = read(`component Storage {
  local type Receipt {}
  public persist
  capability persist(count: Number) returns Receipt
}
interaction "arguments only"() {
  participant storage: Storage
  message storage -> storage.persist(1)
}
examples { example "ordinary call": Storage.persist(1) => satisfies "saved" }`);
    const call = [...source.catalog.inspection.query('call-expression')][0]!;

    expect(source.arguments('persist')).toEqual({ problems: [], deferred: [] });
    expect(source.checker.checkCall(call.id).problems).toContainEqual(expect.objectContaining({ code: 'private-type-exposure' }));
  });

  it('reports an incompatible argument independently of an invalid result type', () => {
    const source = read(`interface Storage { public persist
  capability persist(count: Number) returns Missing
}
interaction "wrong argument"() {
  participant storage: Storage
  message storage -> storage.persist("many")
}`);

    expect(source.arguments('persist').problems.map(problem => problem.code)).toEqual(['incompatible-type']);
    expect(source.arguments('persist').deferred).toEqual([]);
  });

  it('checks supplied arguments without requiring any result declaration', () => {
    const source = read(`interface Storage { public persist
  capability persist(count: Number)
}
interaction "send only"() {
  participant storage: Storage
  message storage -> storage.persist(1)
}`);

    expect(source.arguments('persist')).toEqual({ problems: [], deferred: [] });
  });

  it('uses contextual record and collection types while allowing omitted defaults', () => {
    const source = read(`type Snapshot { title: Text }
interface Storage { public persist
  capability persist(snapshots: List<Snapshot>, attempts: Number = 1) returns Nothing
}
interaction "contextual arguments"() {
  participant storage: Storage
  message storage -> storage.persist([{ title: "Dune" }])
}`);

    expect(source.arguments('persist')).toEqual({ problems: [], deferred: [] });
    expect(source.message().arguments).toHaveLength(1);
  });

  it('reports missing required arguments at the supplied invocation', () => {
    const source = read(`interface Storage { public persist
  capability persist(count: Number) returns Nothing
}
interaction "missing argument"() {
  participant storage: Storage
  message storage -> storage.persist()
}`);

    expect(source.arguments('persist').problems).toContainEqual(expect.objectContaining({
      code: 'invalid-arity', at: source.message().origin,
    }));
  });

  it('checks surplus arguments even when their count is invalid', () => {
    const source = read(`interface Storage { public persist
  capability persist() returns Nothing
}
interaction "extra argument"() {
  participant storage: Storage
  message storage -> storage.persist(missing)
}`);

    const checked = source.arguments('persist');

    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'invalid-arity' }));
    expect(checked.problems).toContain(source.resolution.problems[0]);
  });

  it('retains unavailable value causes beside another incompatible argument', () => {
    const source = read(`include "shared.expec"
interface Storage { public persist
  capability persist(first: Number, second: Number) returns Nothing
}
interaction "independent findings"() {
  participant storage: Storage
  message storage -> storage.persist(sharedCount, "many")
}`);

    const checked = source.arguments('persist');

    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'incompatible-type' }));
    expect(checked.deferred).toContainEqual(expect.objectContaining({ reason: 'composition' }));
  });

  it('uses the caller supplied value scope for a message argument', () => {
    const source = read(`interface Storage { public persist
  capability persist(count: Number) returns Nothing
}
interaction "input"(count: Number) {
  participant storage: Storage
  message storage -> storage.persist(count)
}`);
    const message = source.message(), operation = source.operation('persist');

    expect(source.checker.checkArguments(operation.id, message.arguments.map(argument => argument.id), message.id,
      () => known(source.type('Number')))).toEqual({ problems: [], deferred: [] });
    expect(source.arguments('persist').problems).toContainEqual(expect.objectContaining({ code: 'unavailable-value' }));
  });
});

describe('message expression queries keep snapshot boundaries', () => {
  it('rejects an operation from another snapshot', () => {
    const source = read(`interface Storage { capability persist() returns Nothing }
interaction "local"() {
  participant storage: Storage
  message storage -> storage.persist()
}`);
    const foreign = read('function save() returns Nothing').operation('save');

    expect(() => source.checker.checkArguments(foreign.id, [], source.message().id))
      .toThrow(expect.objectContaining({ code: 'foreign-node', nodeId: foreign.id }));
  });

  it('rejects a foreign receiver type', () => {
    const source = read(`interface Storage {}
interaction "local"() {
  participant storage: Storage
  message storage -> storage.persist()
}`);
    const foreign = read('interface Other {}').type('Other');

    expect(() => source.checker.publicCapability(foreign, source.message().operation.id))
      .toThrow(expect.objectContaining({ code: 'unknown-type', typeId: foreign }));
  });

  it('rejects an argument handle that is not an expression', () => {
    const source = read(`interface Storage { capability persist(count: Number) returns Nothing }
interaction "local"() {
  participant storage: Storage
  message storage -> storage.persist(1)
}`);
    const declaration = source.operation('persist');

    expect(() => source.checker.checkArguments(declaration.id, [declaration.id], source.message().id))
      .toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: declaration.id }));
  });
});

function read(text: string) {
  const parsed = new LangiumReader().read({ sourceId: 'message.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('message.expec', parsed.document), { modules: [], packages: [] });
  const catalog = new TypeDescriber().describe(resolution), checker = new ExpressionChecker(catalog);
  const type = (name: string): TypeId => {
    const declaration = [...catalog.typeDeclarations()].map(id => catalog.inspection.read(id))
      .concat([...catalog.inspection.query('builtin-type')])
      .find(node => 'name' in node && node.name === name);
    if (!declaration) throw new Error('Missing declared type ' + name);
    return catalog.declaredType(declaration.id);
  };
  const operation = (name: string) => {
    const declaration = [...catalog.callableDeclarations()].map(id => catalog.inspection.read(id))
      .find(node => 'name' in node && node.name === name);
    if (!declaration) throw new Error('Missing operation ' + name);
    return declaration;
  };
  const message = () => [...catalog.inspection.query('message')][0]!;
  return { catalog, checker, resolution, type, operation, message,
    select: (receiver: string) => checker.publicCapability(type(receiver), message().operation.id),
    arguments: (name: string) => checker.checkArguments(operation(name).id, message().arguments.map(argument => argument.id), message().id),
  };
}
function known<T>(value: T): Check<T> { return { value, problems: [], deferred: [] }; }
