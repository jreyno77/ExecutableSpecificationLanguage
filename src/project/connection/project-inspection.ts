import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectFile } from './project-connection.js';
import type { ArtifactLocator, RelationshipObservation } from '../../model/specification-identity.js';

export interface ProjectRead {
  readonly artifacts: readonly { readonly at: ArtifactLocator; readonly file: ProjectFile }[];
  readonly coverage: RelationshipObservation['coverage'];
  readonly problems: readonly Diagnostic[];
}
export interface ProjectSearch {
  readonly definitions: readonly ArtifactLocator[];
  readonly incoming: RelationshipObservation;
  readonly outgoing: RelationshipObservation;
  readonly problems: readonly Diagnostic[];
}
