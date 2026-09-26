import type { InspectionNode } from '../inspection.js';
import {
  ResolutionQueryError,
  type Declaration, type DeclarationId, type DeferredReference, type NodeId,
  type ReferenceBinding, type Resolution, type ResolutionProblem,
} from './contracts.js';
import { nodeKey } from './source-index.js';

/** Detached observations: querying a report never calls its input provider. */
export class ResolutionReport implements Resolution {
  readonly problems: readonly ResolutionProblem[];
  readonly deferred: readonly DeferredReference[];
  private readonly orderedDeclarations: readonly Declaration[];
  private readonly declarationsById: ReadonlyMap<DeclarationId, Declaration>;
  private readonly kinds: ReadonlyMap<string, InspectionNode['payload']['kind']>;
  private readonly sourceIds: ReadonlySet<string>;
  private readonly bindings: ReadonlyMap<string, ReferenceBinding>;

  constructor(
    declarations: readonly Declaration[], nodes: readonly InspectionNode[],
    bindings: ReadonlyMap<string, ReferenceBinding>, problems: readonly ResolutionProblem[],
    deferred: readonly DeferredReference[],
  ) {
    this.orderedDeclarations = [...declarations];
    this.declarationsById = new Map(declarations.map(declaration => [declaration.id, declaration]));
    this.kinds = new Map(nodes.map(node => [nodeKey(node.id), node.payload.kind]));
    this.sourceIds = new Set(nodes.map(node => node.id.sourceId));
    this.bindings = new Map(bindings);
    this.problems = [...new Set(problems)];
    this.deferred = [...deferred];
  }

  declarations(): Iterable<Declaration> { return this.orderedDeclarations; }
  declaration(id: DeclarationId): Declaration {
    const declaration = this.declarationsById.get(id);
    if (!declaration) throw new ResolutionQueryError('unknown-declaration', 'The declaration identity does not belong to this resolution.');
    return declaration;
  }
  binding(occurrence: NodeId): ReferenceBinding {
    if (this.sourceIds.size && !this.sourceIds.has(occurrence.sourceId)) {
      throw new ResolutionQueryError('foreign-source', 'The occurrence does not belong to this source snapshot.');
    }
    const key = nodeKey(occurrence);
    const kind = this.kinds.get(key);
    if (kind === undefined) throw new ResolutionQueryError('missing-node', 'The occurrence is absent from this source snapshot.');
    if (kind !== 'reference') throw new ResolutionQueryError('non-reference', 'Query a ReferenceNode, not its containing expression or name.');
    const binding = this.bindings.get(key);
    if (!binding) throw new ResolutionQueryError('not-analyzed', 'This reference is outside the analyzed resolution scope.');
    return binding;
  }
}
