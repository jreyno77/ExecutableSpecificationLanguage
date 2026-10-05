import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative, isAbsolute, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { javaComparison } from '../../src/project/java/acceptance/java-comparison.js';

const execute = promisify(execFile), roots: { parent: string; path: string }[] = [];
async function compare(body: string): Promise<string> {
  const parent = await fs.realpath(tmpdir()), path = await fs.mkdtemp(join(parent,'expec-java-comparison-')); roots.push({ parent, path });
  const junit = process.env.EXPEC_TEST_JUNIT_CONSOLE;
  if (!process.env.JAVA_HOME || !junit) throw Error('Supply the actual JDK21 and JUnit6.1.3 for this native runtime test.');
  await fs.writeFile(join(path,'ExpecChecks.java'),javaComparison([{type:'Consumer.Book',fields:[{name:'copies',expression:'item.copies()'}]}]));
  await fs.writeFile(join(path,'Consumer.java'),`public class Consumer {
    record Book(java.util.Optional<Double> copies) { public boolean equals(Object other) { throw new AssertionError("equals hook ran"); } public String toString() { throw new AssertionError("toString hook ran"); } }
    public static void main(String[] arguments) {
      try { ${body} System.out.print("same data"); }
      catch (Throwable failure) { System.out.print(failure.getClass().getName()+": "+failure.getMessage()); }
    }
  }`);
  const bin = (name: string) => join(process.env.JAVA_HOME!,'bin',name+(process.platform==='win32'?'.exe':''));
  await execute(bin('javac'),['-proc:none','--release','21','-cp',junit,'-d',path,join(path,'ExpecChecks.java'),join(path,'Consumer.java')],{windowsHide:true,timeout:10_000});
  return (await execute(bin('java'),['-cp',[path,junit].join(delimiter),'Consumer'],{windowsHide:true,timeout:10_000})).stdout;
}
afterEach(async () => {
  for (const {parent,path} of roots.splice(0)) {
    const child=relative(parent,path);
    if(isAbsolute(child)||child.includes(sep)||!child.startsWith('expec-java-comparison-')) throw Error('Unexpected comparison fixture root.');
    await fs.rm(path,{recursive:true,force:true});
  }
});

describe('emitted Java data comparison', { timeout: 30_000 }, () => {
  it('normalizes signed zero inside a list of known records without invoking record hooks', async () => {
    expect(await compare('ExpecChecks.equal(java.util.List.of(new Book(java.util.Optional.of(-0.0))), java.util.List.of(new Book(java.util.Optional.of(0.0))));')).toBe('same data');
  });
  it('retains the component path and optional presence in an actual JUnit failure', async () => {
    const result=await compare('ExpecChecks.equal(new Book(java.util.Optional.empty()),new Book(java.util.Optional.of(0.0)));');
    expect(result).toContain('org.opentest4j.AssertionFailedError'); expect(result).toContain('value.copies'); expect(result).toContain('expected: <true> but was: <false>');
  });
  it('rejects a class with hostile equality before that hook can run', async () => {
    const result=await compare('class Other { public boolean equals(Object other) { throw new AssertionError("equals hook ran"); } } ExpecChecks.equal(new Other(),new Other());');
    expect(result).toContain('IllegalArgumentException: value: unsupported comparison data'); expect(result).not.toContain('equals hook ran');
  });
  it('rejects a list subclass before reading its overridden data method', async () => {
    const result=await compare('class Hook extends java.util.ArrayList<Double> { public Double get(int index) { throw new AssertionError("get hook ran"); } } var value=new Hook(); value.add(1.0); ExpecChecks.equal(value,java.util.List.of(1.0));');
    expect(result).toContain('unsupported comparison data'); expect(result).not.toContain('get hook ran');
  });
  it('rejects an actual cyclic list at its native element path', async () => {
    const result=await compare('var list=new java.util.ArrayList<Object>(); list.add(list); ExpecChecks.equal(list,list);');
    expect(result).toContain('value[0]: cyclic comparison data');
  });
  it('permits repeated acyclic values without mutating the original list', async () => {
    expect(await compare('var inner=new java.util.ArrayList<Double>(); inner.add(-0.0); ExpecChecks.equal(java.util.List.of(inner,inner),java.util.List.of(java.util.List.of(0.0),java.util.List.of(0.0))); if(Double.doubleToRawLongBits(inner.get(0))!=Double.doubleToRawLongBits(-0.0)) throw new AssertionError("mutated original");')).toBe('same data');
  });
});
