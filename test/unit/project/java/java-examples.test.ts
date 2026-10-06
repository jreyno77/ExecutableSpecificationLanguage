import { describe, expect, it } from 'vitest';
import { Compiler, SpecificationIdentity, type IdentifiedSpecification } from '../../../../src/index.js';
import { JavaExamples } from '../../../../src/project/java/java-examples.js';
import { javaAcceptanceOptions } from '../../../../src/project/java/java-settings.js';

function examples(source: string, options: (current: IdentifiedSpecification) => Record<string,unknown> = () => ({})) {
  const checked=new Compiler().compile({locator:'main',source:{sourceId:'main.expec',text:source},dependencies:{modules:[],packages:[]}});
  if(!checked.value) throw new Error(JSON.stringify(checked));
  let next=0; const current=new SpecificationIdentity(()=>'example-'+ ++next).associate(checked.value);
  if(!current.value) throw new Error(JSON.stringify(current));
  const projection=new JavaExamples(current.value,javaAcceptanceOptions.parse({package:'store.tests',domain:'shopping',...options(current.value)}),
    {format:1,declarations:[],uses:[],unresolved:[],problems:[],comments:[]});
  return {files:projection.files(),problems:projection.problems};
}

describe('Java test projection keeps explicit names bound to their declarations', () => {
  it('reports a domain that collides with required generated data support', () => {
    const result = examples('examples { observation copies() returns Number { return 1 } }', () => ({ domain: 'expecData' }));
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-name-conflict', at: { kind: 'dependency', path: ['java', '<options>', 'domain'] } }));
  });
  it('does not reserve a support name when that support file is not emitted', () => {
    const result = examples('examples { action begin() {} }', () => ({ domain: 'expecData' }));
    expect(result.problems).toEqual([]);
    expect(result.files.filter(file => file.path.endsWith('/dsl/ExpecData.java'))).toHaveLength(1);
  });
  it('reports an unknown mapping without throwing away the checked report', () => {
    const result=examples('examples { action begin() {} }',()=>({names:[{id:'missing',name:'renamed'}]}));
    expect(result.problems.map(problem=>problem.code)).toContain('invalid-native-mapping');
  });
  it('rejects two parameters mapped to the same native binding', () => {
    const result=examples('examples { action copy(first: Text, second: Text) }',current=>({names:current.baseline.elements.filter(item=>['first','second'].includes(item.address.name??''))
      .map(item=>({id:item.id,name:'value'}))}));
    expect(result.problems.map(problem=>problem.code)).toContain('native-name-conflict');
  });
  it('uses the mapped parameter in its actual checked return expression', () => {
    const result=examples('examples { observation echo(title: Text) returns Text { return title } }',current=>({names:[{id:current.baseline.elements.find(item=>item.address.name==='title')!.id,name:'label'}]}));
    expect(result.problems).toEqual([]);
    const dsl=result.files.find(file=>file.path.endsWith('/dsl/Shopping.java'))!.generated;
    expect(dsl).toContain('echo(java.lang.String label)'); expect(dsl).toContain('= label;'); expect(dsl).not.toContain('= title;');
  });
  it('lets an ordinary driver parameter coexist with the native driver field', () => {
    const result=examples('examples { action add(driver: Text) }');
    expect(result.problems).toEqual([]);
    expect(result.files.find(file=>file.path.endsWith('/dsl/Shopping.java'))!.generated).toContain('this.driver.add(driver);');
  });
});
