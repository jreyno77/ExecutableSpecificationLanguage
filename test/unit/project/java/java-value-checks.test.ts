import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Compiler } from '../../../../src/index.js';
import { JavaTypes } from '../../../../src/project/java/java-types.js';
import { JavaValueChecks } from '../../../../src/project/java/java-value-checks.js';

const roots:{parent:string;path:string}[]=[],execute=promisify(execFile);
async function admitted(body:string):Promise<string> {
  const checked=new Compiler().compile({locator:'main',source:{sourceId:'main.expec',text:'type Node { children: List<Node> }\nfunction inspect() returns Node'},dependencies:{modules:[],packages:[]}});
  if(!checked.value) throw Error(JSON.stringify(checked));
  const catalog=checked.value.types,callable=[...catalog.callableDeclarations()][0]!,result=catalog.callable(callable).result;
  if(result.status!=='known'||result.value.kind!=='value') throw Error('Expected checked recursive Node result.');
  const types:JavaTypes=new JavaTypes(catalog,'checks',item=>'checks.Consumer.'+('name' in item?item.name:''),()=>{throw Error('Unexpected unsupported native type.');},new Map(),(id,value,path)=>checks.value(id,value,path));
  const checks:JavaValueChecks=new JavaValueChecks(catalog,types,item=>item.name),expression=types.value(result.value.type,'value','"result"');
  const parent=await fs.realpath(tmpdir()),path=await fs.mkdtemp(join(parent,'expec-java-values-')); roots.push({parent,path});
  for(const support of types.support()) await fs.writeFile(join(path,support.name+'.java'),'package checks;\n'+support.text);
  await fs.writeFile(join(path,'ExpecChecks.java'),'package checks; final class ExpecChecks {\n'+checks.source()+'\n}');
  await fs.writeFile(join(path,'Consumer.java'),`package checks; public class Consumer {
    record Node(java.util.List<Node> children) {}
    static Node checked(Node value) { return ${expression}; }
    public static void main(String[] arguments) { try { ${body} } catch(IllegalArgumentException failure) { System.out.print(failure.getMessage()); } }
  }`);
  if(!process.env.JAVA_HOME) throw Error('Supply the actual JDK21 for this native value check.');
  const bin=(name:string)=>join(process.env.JAVA_HOME!,'bin',name+(process.platform==='win32'?'.exe':''));
  await execute(bin('javac'),['-proc:none','--release','21','-d',path,join(path,'Consumer.java'),join(path,'ExpecChecks.java'),join(path,'ExpecData.java')],{windowsHide:true,timeout:10_000});
  return (await execute(bin('java'),['-cp',path,'checks.Consumer'],{windowsHide:true,timeout:10_000})).stdout;
}
afterEach(async()=>{ for(const {parent,path} of roots.splice(0)) {
  const child=relative(parent,path);if(isAbsolute(child)||child.includes(sep)||!child.startsWith('expec-java-values-'))throw Error('Unexpected native value fixture root.');
  await fs.rm(path,{recursive:true,force:true});
} });
describe('emitted Java instantiated record admission', {timeout:30_000},()=>{
  it('retains the actual object and repeated acyclic children',async()=>{
    expect(await admitted('var leaf=new Node(java.util.List.of()); var children=new java.util.ArrayList<Node>(); children.add(leaf); children.add(leaf); var value=new Node(children); System.out.print(checked(value)==value && value.children()==children && children.size()==2);')).toBe('true');
  });
  it('rejects actual recursive data at its field rather than overflowing the native stack',async()=>{
    expect(await admitted('var children=new java.util.ArrayList<Node>(); var value=new Node(children); children.add(value); checked(value);')).toBe('result.children: cyclic data');
  });
});
