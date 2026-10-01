import {
  ExternalModel, LangiumModel, LangiumReader, QueryInspection, Resolver,
  type ExternalDefinition, type Inspection, type Item, type ModuleModel, type ReadResult, type SourceDocument,
} from '../../src/index.js';

export class ReadableInspectionDriver {
  private model!: ModuleModel;
  private inspection!: Inspection;
  private result!: ReadResult;
  private source: SourceDocument | undefined;

  sourceIs(sourceId: string, text: string, locator = sourceId): void {
    this.source = { sourceId, text };
    this.result = new LangiumReader().read(this.source);
    if (this.result.status === 'accepted') {
      this.model = new LangiumModel(locator, this.result.document);
      this.inspection = new QueryInspection(this.model);
    }
  }

  externalContractIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.model = new ExternalModel(locator, definitions);
    this.inspection = new QueryInspection(this.model);
  }

  capabilities(): Item<'capability'>[] { return [...this.inspection.query('capability')]; }
  namedTypes(): Item<'named-type'>[] { return [...this.inspection.query('named-type')]; }
  promises(): Item<'promises'>[] { return [...this.inspection.query('promises')]; }
  records(): Item<'record-type-declaration'>[] { return [...this.inspection.query('record-type-declaration')]; }
  opaqueTypes(): Item<'opaque-type-declaration'>[] { return [...this.inspection.query('opaque-type-declaration')]; }
  readResult(): ReadResult { return this.result; }

  capabilityIterations(): string[][] {
    const capabilities = this.inspection.query('capability');
    const first = capabilities[Symbol.iterator](), second = capabilities[Symbol.iterator]();
    const firstNames: string[] = [], secondNames: string[] = [];
    const item = first.next();
    if (!item.done) firstNames.push(item.value.name);
    for (let item = second.next(); !item.done; item = second.next()) secondNames.push(item.value.name);
    for (let item = first.next(); !item.done; item = first.next()) firstNames.push(item.value.name);
    return [firstNames, secondNames, [...capabilities].map(item => item.name)];
  }

  replaceSourceArgument(text: string): void {
    if (!this.source) throw new Error('A source argument must be supplied first.');
    this.source.text = text;
    new LangiumReader().read(this.source);
  }

  resolveWith(dependency: ReadableInspectionDriver): Inspection {
    return new QueryInspection(new Resolver().resolve(this.model, { modules: [dependency.model], packages: [] }).model);
  }
}
