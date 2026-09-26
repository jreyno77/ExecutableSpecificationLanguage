import { collect, type Collector, type Inspection } from '../../src/index.js';

// Static public contract examples, checked by tsc and never called.
export function collectorTypeExamples(inspection: Inspection): void {
  const names: string[] = collect(inspection, {
    kind: 'capability',
    project: (node, source) => {
      const name: string = source.name(node.payload.name);
      void node.payload.parameters;
      // @ts-expect-error A capability is not a named type.
      node.payload.arguments;
      // @ts-expect-error Projected source nodes stay readonly.
      node.payload.parameters.push(node.id);
      return name;
    },
  });
  const lines: number[] = collect(inspection, { kind: 'name', project: node => node.range.start.line });
  // @ts-expect-error Projection result is inferred as number, not string.
  const wrong: string[] = collect(inspection, { kind: 'name', project: node => node.range.start.line });
  // @ts-expect-error Unknown kinds are not part of the inspection contract.
  collect(inspection, { kind: 'unknown-kind', project: () => '' });

  const collector: Collector<'name', string> = { kind: 'name', project: node => node.payload.decoded };
  // @ts-expect-error A collector's kind cannot be reassigned.
  collector.kind = 'name';
  void [names, lines, wrong];
}
