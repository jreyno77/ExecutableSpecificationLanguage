import type { InspectionInput, ModuleInspection } from './model.js';
import type { ExternalDefinition } from './external-definition.js';
import { InspectionView } from './view.js';
import { sourceNodes } from './source.js';
import { externalNodes } from './external.js';
export class DescriptionInspection extends InspectionView implements ModuleInspection {
  constructor(readonly locator: string, description: InspectionInput) {
    const captured = sourceNodes(locator, description);
    super(captured.roots, captured.nodes);
  }
}
export class ExternalInspection extends InspectionView implements ModuleInspection {
  constructor(readonly locator: string, definitions: readonly ExternalDefinition[]) {
    const captured = externalNodes(locator, definitions);
    super(captured.roots, captured.nodes);
  }
}
