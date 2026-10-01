import { AstUtils, GrammarUtils, isAstNode, type AstNode } from 'langium';
import { createNodeId, type LanguageNode, type ModelNode, type ModuleModel, type NodeId, type NodeKind } from './model.js';
import { IndexedModel } from './model-index.js';
import { getParsedDocument, type AcceptedDocument } from './langium/reader.js';

/** Adapts one private generated AST; model records are lazy projections over it. */
export class LangiumModel extends IndexedModel implements ModuleModel {
  constructor(readonly locator: string, document: AcceptedDocument) {
    const parsed = getParsedDocument(document);
    const nodes: LanguageNode[] = [];
    const ids = new Map<AstNode, NodeId>();
    const children = new Map<NodeId, readonly NodeId[]>();
    const visit = (node: AstNode): NodeId => {
      const id = createNodeId();
      ids.set(node, id);
      nodes.push(node as LanguageNode);
      const contained = AstUtils.streamContents(node).toArray().sort((a, b) =>
        parsed.range(a).start.offset - parsed.range(b).start.offset);
      children.set(id, contained.map(visit));
      return id;
    };
    const roots = parsed.ast.roots.map(visit);
    const links = (value: unknown): unknown => isAstNode(value) ? ids.get(value)
      : Array.isArray(value) ? value.map(links) : value;
    const records = nodes.map((node, ordinal) => {
      const kind = ('kind' in node ? node.kind : node.$type.replace(/([a-z])([A-Z])/gu, '$1-$2').toLowerCase()) as NodeKind;
      const record: Record<string, unknown> = {
        id: ids.get(node)!, kind,
        origin: { kind: 'source', module: locator, node: { sourceId: parsed.source.sourceId, ordinal }, range: parsed.range(node) },
      };
      const property = (name: string, get: () => unknown): void => { Object.defineProperty(record, name, { enumerable: true, get }); };
      for (const key of Object.keys(node)) {
        if (key.startsWith('$') || key === 'kind' || key === 'body') continue;
        property(key, () => links((node as unknown as Record<string, unknown>)[key]));
      }
      if (node.$type === 'Callable') property('body', () => node.body
        ? { kind: 'available', node: ids.get(node.body)! } : { kind: 'absent' });
      if (node.$type === 'Field' || node.$type === 'Parameter') property('hasDefault', () => node.defaultValue !== undefined);
      if (node.$type === 'UnaryExpression' || node.$type === 'BinaryExpression') {
        const operator = GrammarUtils.findNodeForProperty(node.$cstNode, 'operator')!;
        property('operatorRange', () => parsed.coordinates.range(operator.offset, operator.end));
      }
      return record as unknown as ModelNode;
    });
    super(roots, records, undefined, undefined, children);
  }
}
