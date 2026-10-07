import { readFile } from 'node:fs/promises';
import { D2 } from '@d2lang/d2';

const path = 'game/design/structure.d2', engine = new D2();
try {
  const { diagram } = await engine.compile({ fs: { [path]: await readFile(path, 'utf8') }, inputPath: path });
  process.stdout.write(JSON.stringify({ shapes: diagram.shapes.map(({ id, label, methods }) => ({ id, label, methods })),
    connections: diagram.connections.map(({ src, dst, srcArrow, dstArrow, label }) => ({ src, dst, srcArrow, dstArrow, label })) }));
} finally { await engine.dispose(); }
