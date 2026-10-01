import { AntlrSyntaxReader, DescriptionInspection, type Inspection } from '../../src/index.js';

export class ReadableInspectionDriver {
  private inspection!: Inspection;

  sourceIs(sourceId: string, text: string): void {
    const result = new AntlrSyntaxReader().read({ sourceId, text });
    if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
    this.inspection = new DescriptionInspection(sourceId, result.description);
  }

  capabilityNames(): unknown[] {
    return Array.from(this.inspection.nodes('capability'), capability => Reflect.get(capability, 'name'));
  }

  capabilityInputs(): unknown[] {
    return Array.from(this.inspection.nodes('capability'), capability => {
      const parameters: unknown = Reflect.get(capability, 'parameters');
      return Array.isArray(parameters) ? parameters.map(parameter => Reflect.get(parameter, 'name')) : undefined;
    });
  }
}
