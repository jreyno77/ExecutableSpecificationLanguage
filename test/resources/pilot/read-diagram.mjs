import { readFile, readdir } from 'node:fs/promises';
import { D2 } from '@d2lang/d2';

const engine = new D2(), diagrams = [];
try {
  for (const entry of await readdir('project/design/interactions')) {
    if (!entry.endsWith('.d2')) continue;
    const path = 'project/design/interactions/' + entry;
    const compiled = await engine.compile({ fs: { [path]: await readFile(path, 'utf8') }, inputPath: path });
    const labels = new Map(compiled.diagram.shapes.map(shape => [shape.id, shape.label.split(': ')[0]]));
    const key = segments => segments.map(part => part.unquoted_string?.value.map(value => value.string).join('')).join('.');
    const messages = compiled.graph.ast.nodes.flatMap(statement => statement.map_key?.edges?.map(edge =>
      labels.get(key(edge.src.path)) + ' -> ' + labels.get(key(edge.dst.path)) + ': '
      + statement.map_key.value?.double_quoted_string?.value.map(part => part.string).join('')) ?? []);
    diagrams.push({ label: compiled.diagram.root.label, messages, svg: await readFile(path.replace(/\.d2$/, '.svg'), 'utf8') });
  }
} finally { await engine.dispose(); }
console.log(JSON.stringify(diagrams));
