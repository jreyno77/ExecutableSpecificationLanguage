import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const text = await readFile(process.argv[2], 'utf8');
let packageUrl;
try {
  packageUrl = import.meta.resolve('executable-specification-language');
  const { Compiler, ConfigurationReader, SourceLoader, SourceComposer } = await import('executable-specification-language');
  const result = new Compiler().compile({
    source: { sourceId: 'consumer.expec', text }, locator: 'consumer',
    dependencies: { modules: [], packages: [] },
  });
  const manifest = join(dirname(process.argv[2]), 'expec.json');
  const configuration = new ConfigurationReader([]).read({ sourceId: manifest, text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: [basename(process.argv[2])] }
  }) });
  const loaded = await new SourceLoader(manifest).load(configuration.value, { modules: [], packages: [] });
  const entry = loaded.value?.entries[0];
  const checked = entry && new Compiler().compile({ resolution: new SourceComposer(loaded.value.locate).compose(entry.entry, entry.dependencies) });
  const specification = result.value;
  const operations = specification ? [...specification.inspection.query('call-expression')].map(call => {
    const selected = specification.call(call.id);
    assert.deepEqual(selected.problems, []); assert.deepEqual(selected.deferred, []); assert.ok(selected.value);
    return specification.inspection.read(selected.value).name;
  }) : [];
  const steps = specification ? [...specification.inspection.query('scenario')].flatMap(scenario => scenario.steps.map(step => {
    const checked = specification.step(step.id);
    assert.deepEqual(checked.problems, []); assert.deepEqual(checked.deferred, []); assert.ok(checked.value);
    const capture = value => {
      const shape = specification.types.describe(value.type);
      assert.ok('declaration' in shape);
      return { name: specification.inspection.read(value.name, 'name').decoded,
        type: specification.inspection.read(shape.declaration).name };
    };
    return { available: checked.value.available.map(capture),
      ...(checked.value.capture ? { capture: capture(checked.value.capture) } : {}) };
  })) : [];
  const bodies = specification ? [...specification.inspection.query('check')].flatMap(check => {
    if (check.body.kind !== 'available') return [];
    const inspection = specification.inspection, statements = check.body.content.members;
    const textOf = node => Array.from(text).slice(node.origin.range.start.offset, node.origin.range.end.offset).join('');
    const generation = [];
    const collect = node => {
      if (node.kind === 'call-expression') generation.push(specification.call(node.id).value);
      for (const child of inspection.children(node.id)) collect(child);
    };
    collect(check.body.content);
    const before = statements.map(textOf);
    const documentation = [...inspection.query('call-expression')].filter(call => {
      for (let parent = inspection.parent(call.id); parent; parent = inspection.parent(parent.id)) if (parent.id === check.id) return true;
      return false;
    }).map(call => specification.call(call.id).value);
    assert.deepEqual(generation, documentation);
    assert.deepEqual(statements.map(textOf), before);
    for (const id of generation) assert.ok(id);
    return [{ name: check.name, generation: generation.map(id => inspection.read(id).name),
      documentation: documentation.map(id => inspection.read(id).name), statements: before, earlierUnchanged: true }];
  }) : [];
  process.stdout.write(JSON.stringify({ operations, steps, bodies,
    packageUrl, accepted: result.value !== undefined, syntax: result.syntax, deferred: result.deferred,
    problems: result.problems.map(problem => ({ ...problem,
      text: problem.at.kind === 'source'
        ? Array.from(text).slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') : undefined,
    })),
    capabilities: result.value ? [...result.value.inspection.query('capability')].map(item => item.name) : [],
    loaded: { accepted: checked?.value !== undefined, captures: loaded.captures.length,
      capabilities: checked?.value ? [...checked.value.inspection.query('capability')].map(item => item.name) : [],
      problems: loaded.problems, syntax: loaded.syntax },
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ packageUrl, error: { code: error.code, message: error.message, url: error.url } }));
  process.exitCode = 1;
}
