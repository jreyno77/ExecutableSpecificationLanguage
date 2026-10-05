import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { javaTupleTypes } from '../../src/java-output-state.js';
import { javaData } from '../../src/java-types.js';
import { Compiler, SpecificationIdentity, javaOutput, type ProjectSnapshot } from '../../src/index.js';

const generated = 'package store; public class Store {}\n';
const artifact = { specId: 'store', locator: { outputId: 'java', format: 'java-symbol-1', value: { file: 'src/main/java/store/Store.java', type: 'store.Store' } } };
const record = { path: 'src/main/java/store/Store.java', generated, hash: createHash('sha256').update(generated).digest('hex'), artifacts: [artifact] };
async function plan(recording: Record<string, unknown>) {
  const checked = new Compiler().compile({ locator: 'main', source: { sourceId: 'main.expec', text: 'class Store {}' }, dependencies: { modules: [], packages: [] } });
  if (!checked.value) throw new Error(JSON.stringify(checked));
  const current = new SpecificationIdentity(() => 'store').associate(checked.value);
  if (!current.value) throw new Error(JSON.stringify(current));
  const bytes = Buffer.from(JSON.stringify({ format: 1, options: { package: 'store' }, files: [recording] }));
  const snapshot: ProjectSnapshot = { root: { path: join(tmpdir(), 'java-state'), identity: 'fixture' }, complete: true, problems: [], excludeNames: [], excluded: [],
    files: [{ path: '.expec/outputs/java.json', bytes, version: createHash('sha256').update(bytes).digest('hex') }] };
  return javaOutput.open({ package: 'store' }).plan({ operation: 'create', current: current.value }, snapshot);
}
async function expectRefused(recording: Record<string, unknown>) {
  const result = await plan(recording);
  expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('invalid-output-state');
}
describe('Java recorded native ownership', () => {
  it('refuses an unsupported native selector in recorded ownership', async () => {
    await expectRefused({ ...record, artifacts: [{ ...artifact, locator: { ...artifact.locator, format: 'future-java-9' } }] });
  });
  it('refuses two different identities claiming the same native declaration', async () => {
    await expectRefused({ ...record, artifacts: [artifact, { ...artifact, specId: 'another-store' }] });
  });
  it('refuses a malformed parameter claim without a callable', async () => {
    await expectRefused({ ...record, artifacts: [{ ...artifact, locator: { ...artifact.locator, value: { ...artifact.locator.value, parameter: 0 } } }] });
  });
  it('refuses a foreign output in the generated comparison baseline', async () => {
    await expectRefused({ ...record, renderedArtifacts: [{ ...artifact, locator: { ...artifact.locator, outputId: 'typescript' } }] });
  });
  it('refuses an adopted identity absent from its recorded native declarations', async () => {
    await expectRefused({ ...record, adopted: ['unowned-method'] });
  });
  it('refuses generated text whose saved digest no longer matches', async () => {
    await expectRefused({ ...record, generated: generated + '// changed' });
  });
});


describe('Java tuple support shares only established generated data', () => {
  const tuple='package store;\n\npublic record Tuple2<T1, T2>(T1 item1, T2 item2) {\n    public Tuple2 { ExpecData.required(item1, "item1"); ExpecData.required(item2, "item2"); }\n}\n';
  function capture(actual=tuple,baseline=tuple,support='package store;\n\n'+javaData()+'\n'):ProjectSnapshot {
    const path='src/main/java/store/Tuple2.java',digest=(text:string)=>createHash('sha256').update(text).digest('hex');
    const state=JSON.stringify({format:1,options:{package:'store'},files:[{path,generated:baseline,hash:digest(baseline),artifacts:[]}]});
    return {root:{path:join(tmpdir(),'tuple-state'),identity:'fixture'},complete:true,problems:[],excludeNames:[],excluded:[],files:[
      {path:'.expec/outputs/java.json',bytes:Buffer.from(state),version:digest(state)},
      {path,bytes:Buffer.from(actual),version:digest(actual)},
      {path:'src/main/java/store/ExpecData.java',bytes:Buffer.from(support),version:digest(support)},
    ]};
  }
  it('reuses the unchanged generated tuple in its actual package',()=>{
    const result=javaTupleTypes(capture()); expect(result.problems).toEqual([]); expect([...result.tuples]).toEqual([[2,'store.Tuple2']]);
  });
  it('does not grant comparison access to a handwritten replacement accessor',()=>{
    const result=javaTupleTypes(capture(tuple.replace('\n}', '\n    public T1 item1() { throw new AssertionError("hook"); }\n}')));
    expect([...result.tuples]).toEqual([]);
  });
  it('does not reuse a tuple whose constructor dependency invokes handwritten behavior',()=>{
    const support='package store; public class ExpecData { static <T> T required(T value,String path) { System.out.print(\"hook\"); return value; } }';
    expect([...javaTupleTypes(capture(tuple,tuple,support)).tuples]).toEqual([]);
  });
  it('does not trust a substituted same-name record even with a matching saved digest',()=>{
    const changed=tuple.replace('ExpecData.required(item1, "item1");','System.out.print("hook");');
    expect([...javaTupleTypes(capture(changed,changed)).tuples]).toEqual([]);
  });
});
