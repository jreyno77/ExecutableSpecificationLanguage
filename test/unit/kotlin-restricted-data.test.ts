import { expect, it } from 'vitest';
import { Compiler, SpecificationIdentity, type ProjectSnapshot } from '../../src/index.js';
import { KotlinDeclarations, kotlinOptions } from '../../src/kotlin-declarations.js';
import { kotlinGeneratedFiles, kotlinStatePath } from '../../src/kotlin-output-state.js';
import { canonical } from '../../src/identity-baseline.js';
import { hash } from '../../src/project-files.js';

function generatedRestriction() {
  const compiled = new Compiler().compile({ source: { sourceId: 'main.expec', text: 'type OS = "windows" | "linux"' },
    locator: 'main', dependencies: { modules: [], packages: [] } });
  expect(compiled.problems).toEqual([]);
  let next = 0;
  const current = new SpecificationIdentity(() => 'restriction-' + ++next).associate(compiled.value!).value!;
  const options = kotlinOptions.parse({ package: 'store' });
  const renderer = new KotlinDeclarations(current, options), files = renderer.render();
  expect(renderer.problems).toEqual([]);
  const recorded = { format: 1, options: canonical(options), subjects: current.baseline.elements.map(item => item.id), deleted: [], mappings: [],
    files: files.map(file => ({ ...file, generated: file.text, hash: hash(Buffer.from(file.text)) })).map(({ text: _text, ...file }) => file) };
  const native = files.map(file => ({ path: file.path, bytes: Buffer.from(file.text), version: hash(Buffer.from(file.text)) }));
  const capture = (): ProjectSnapshot => {
    const bytes = Buffer.from(JSON.stringify(recorded));
    return { root: { path: '/supplied', identity: 'captured' }, complete: true, problems: [], excludeNames: [], excluded: [],
      files: [...native, { path: kotlinStatePath, bytes, version: hash(bytes) }] };
  };
  return { current, recorded, native, capture };
}

it('recognizes the actual unchanged generated restriction', () => {
  const p = generatedRestriction(), checked = kotlinGeneratedFiles(p.capture(), p.current);
  expect(checked.problems).toEqual([]);
  expect([...checked.value!]).toEqual(['src/main/kotlin/store/OS.kt']);
});

it('checks current restriction bytes even if the supplied version has not changed', () => {
  const p = generatedRestriction();
  p.native[0]!.bytes = Buffer.concat([p.native[0]!.bytes, Buffer.from('\n// changed native source')]);
  expect([...kotlinGeneratedFiles(p.capture(), p.current).value!]).toEqual([]);
});

it('does not let a rewritten saved baseline certify new initialization effects', () => {
  const p = generatedRestriction(), file = p.recorded.files[0]!;
  file.generated = file.generated.replace('Linux("linux")', 'Linux("linux"); init { println("setup") }');
  file.hash = hash(Buffer.from(file.generated));
  p.native[0]!.bytes = Buffer.from(file.generated); p.native[0]!.version = file.hash;
  const checked = kotlinGeneratedFiles(p.capture(), p.current);
  expect(checked.problems).toEqual([]);
  expect([...checked.value!]).toEqual([]);
});

it('does not grant generated-construction ownership to adopted source', () => {
  const p = generatedRestriction();
  Object.assign(p.recorded.files[0]!, { adopted: true });
  expect([...kotlinGeneratedFiles(p.capture(), p.current).value!]).toEqual([]);
});

