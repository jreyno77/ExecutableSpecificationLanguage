import {
  Compiler, LangiumModel, LangiumReader, SourceComposer,
  type Compilation, type Item, type NodeId, type NodeKind, type Origin, type Specification, type TypeFact,
} from '../../src/index.js';

export class CheckedQueryDriver {
  readonly compiler = new Compiler();
  readonly sources = new Map<string, string>();
  entry = 'game';
  result!: Compilation;
  source(locator: string, text: string): void { this.entry = locator; this.sources.set(locator, text); }
  module(locator: string, text: string): void { this.sources.set(locator, text); }
  compile(composed = false): void {
    const modules = [...this.sources].map(([locator, text]) => {
      const read = new LangiumReader().read({ sourceId: `${locator}.expec`, text });
      if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
      return new LangiumModel(locator, read.document);
    });
    const entry = one(modules.filter(model => model.locator === this.entry), this.entry);
    const dependencies = { modules: modules.filter(model => model !== entry), packages: [] };
    this.result = composed ? this.compiler.compile({ resolution: new SourceComposer().compose(entry, dependencies) })
      : this.compiler.compile({ locator: this.entry, source: { sourceId: `${this.entry}.expec`, text: this.sources.get(this.entry)! }, dependencies });
  }
  specification(): Specification {
    if (!this.result.value) throw new Error('Expected a checked specification: ' + JSON.stringify(this.result));
    return this.result.value;
  }
  query<K extends NodeKind>(kind: K, spec = this.specification()): Item<K>[] { return [...spec.inspection.query(kind)]; }
  named(selector: string, spec = this.specification()): Item {
    const [module, path] = selector.includes(':') ? selector.split(':') : [undefined, selector];
    const candidates = [...new Set([...spec.types.callableDeclarations(), ...spec.types.typeDeclarations(),
      ...this.query('builtin-type', spec).map(node => node.id), ...this.query('fixture', spec).map(node => node.id)])].map(id => spec.inspection.read(id));
    return one(candidates.filter(node => (!module || node.origin.kind !== 'builtin' && node.origin.module === module)
      && (this.path(node, spec) === path || 'name' in node && node.name === path)), selector);
  }
  path(node: Item, spec: Specification): string {
    const names: string[] = [];
    for (let item: Item | undefined = node; item; item = spec.inspection.parent(item.id)) {
      if ('name' in item && typeof item.name === 'string') names.unshift(item.name);
      else if (item.kind === 'examples') names.unshift(`examples[${this.query('examples', spec).filter(block => block.origin.kind === 'source'
        && item!.origin.kind === 'source' && block.origin.module === item!.origin.module).findIndex(block => block.id === item!.id)}]`);
    }
    return names.join('.');
  }
  expression(text: string, spec = this.specification()): Item {
    const nodes = ['call-expression', 'grouped-expression', 'name-expression', 'number-literal'] as const;
    return one(nodes.flatMap(kind => this.query(kind, spec)).filter(node => this.text(node.origin) === text), text);
  }
  call(text: string, spec = this.specification()): Item<'call-expression'> {
    let node = this.expression(text, spec);
    while (node.kind === 'grouped-expression') node = node.inner;
    if (node.kind !== 'call-expression') throw new Error('Expected a call expression');
    return node;
  }
  titled<K extends 'scenario' | 'example' | 'interaction'>(kind: K, title: string, spec = this.specification()): Item<K> {
    return one(this.query(kind, spec).filter(node => node.title.value === title), title);
  }
  step(title: string, index: number, spec = this.specification()) {
    const node = this.titled('scenario', title, spec).steps[index];
    if (!node) throw new Error('Missing scenario step ' + index);
    return node;
  }
  message(title: string, index: number) {
    const node = this.titled('interaction', title).members.filter(item => item.kind === 'message')[index];
    if (!node) throw new Error('Missing declared message ' + index);
    return node;
  }
  text(origin: Origin): string {
    if (origin.kind !== 'source') throw new Error('Expected source provenance');
    return Array.from(this.sources.get(origin.module)!).slice(origin.range.start.offset, origin.range.end.offset).join('');
  }
  expectedOffset(text: string, within?: string, occurrence = 0): number {
    const source = this.sources.get(this.entry)!, context = within ?? source;
    const base = within ? source.indexOf(within) : 0;
    let index = -1;
    for (let count = 0; count <= occurrence; count++) index = context.indexOf(text, index + 1);
    if (base < 0 || index < 0) throw new Error('Missing authored text ' + text);
    return Array.from(source.slice(0, base + index)).length;
  }
  namedType(name: string, spec = this.specification()) { return spec.types.declaredType(this.named(name, spec).id); }
}
export function one<T>(items: readonly T[], description: string): T {
  if (items.length !== 1) throw new Error(`Expected one ${description}; found ${items.length}`);
  return items[0]!;
}
export function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error('Expected a known fact: ' + JSON.stringify(fact));
  return fact.value;
}
