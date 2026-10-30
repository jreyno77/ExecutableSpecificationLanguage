import { describe, expect, it } from 'vitest';
import { Compiler, SpecificationIdentity } from '../../../../src/index.js';
import { JavaDeclarations } from '../../../../src/project/java/java-declarations.js';
import { javaOptions } from '../../../../src/project/java/java-settings.js';
import { KotlinDeclarations, kotlinOptions } from '../../../../src/project/kotlin/kotlin-declarations.js';
import { PythonDeclarations, pythonOptions } from '../../../../src/project/python/python-declarations.js';
import { TypeScriptDeclarations, typescriptOptions } from '../../../../src/project/typescript/typescript-declarations.js';

const source = `class Transformer {
  public transform
  capability transform(value: Number) returns Number
}
class Calculator {
  public add
  capability add(value: Number) returns Number {
    calls Transformer.transform
  }
}`;
function contract() {
  const checked = new Compiler().compile({ locator: 'main', source: { sourceId: 'main.expec', text: source }, dependencies: { modules: [], packages: [] } });
  expect(checked.syntax).toEqual([]); expect(checked.problems).toEqual([]); expect(checked.deferred).toEqual([]);
  if (!checked.value) throw Error('The authored callable contract must compile.');
  let next = 0;
  const identified = new SpecificationIdentity(() => 'call-comment-' + ++next).associate(checked.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  return identified.value;
}

describe('native declaration renderers retain authored call contracts', () => {
  it('keeps the relationship in a TypeScript comment and leaves add unimplemented', () => {
    const declarations = new TypeScriptDeclarations(contract(), typescriptOptions.parse({ directory: 'src' }));
    const files = declarations.render();
    expect(declarations.problems).toEqual([]);
    const calculator = files.find(file => file.path === 'src/Calculator.ts')!.text;
    expect(calculator).toContain('calls Transformer.transform');
    expect(calculator).toContain('Not implemented: Calculator.add');
    expect(calculator).not.toContain('new Transformer');
    expect(calculator).not.toContain('Transformer.transform(value)');
  });

  it('retains the same authored clause in Java documentation without a native launch', () => {
    const declarations = new JavaDeclarations(contract(), javaOptions.parse({ package: 'sample' }));
    const files = declarations.files();
    expect(declarations.problems).toEqual([]);
    expect(files.find(file => file.path.endsWith('/Calculator.java'))!.generated).toContain('calls Transformer.transform');
  });

  it('retains the same authored clause in Kotlin documentation without a native launch', () => {
    const declarations = new KotlinDeclarations(contract(), kotlinOptions.parse({ package: 'sample' }));
    const files = declarations.render();
    expect(declarations.problems).toEqual([]);
    expect(files.find(file => file.path.endsWith('/Calculator.kt'))!.text).toContain('calls Transformer.transform');
  });

  it('retains the same authored clause in Python documentation without a native launch', () => {
    const declarations = new PythonDeclarations(contract(), pythonOptions.parse({ module: 'sample.contracts' }));
    const rendered = declarations.render();
    expect(declarations.problems).toEqual([]);
    expect(rendered.text).toContain('calls Transformer.transform');
  });
});
