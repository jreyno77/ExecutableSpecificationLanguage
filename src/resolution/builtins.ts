import { builtinNames } from '../inspection/builtins.js';
import type { InspectionNode } from '../inspection.js';
import { createNodeId, InspectionView } from '../inspection/view.js';


/** Primitive declarations participate in the common inspection graph. */
export function builtinInspection(): InspectionView {
  const nodes: InspectionNode[] = [];
  const roots = builtinNames.map(name => {
    const origin = { kind: 'builtin' as const, name };
    const id = createNodeId(), nameId = createNodeId();
    nodes.push({ id, origin, payload: { kind: 'builtin-type', name: nameId } },
      { id: nameId, origin, payload: { kind: 'name', decoded: name } });
    return id;
  });
  return new InspectionView(roots, nodes);
}
