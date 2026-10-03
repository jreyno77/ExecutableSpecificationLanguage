import fs from 'node:fs';
import processes from 'node:child_process';
import { vi } from 'vitest';
import { Compiler, ExternalModel, LangiumModel, LangiumReader, Resolver, TypeDescriber,
  type Compilation, type ExternalDefinition, type Item, type ModuleModel, type NodeId,
  type ProblemLocation, type TypeCatalog, type TypeFact, type TypeId } from '../../src/index.js';
import { IdentityDriver } from './specification-identity.js';

export class FailureDriver {
  text = '';
  readonly modules = new Map<string, string | readonly ExternalDefinition[]>();
  compilation!: Compilation;
  types!: TypeCatalog;
  readonly identity = new IdentityDriver();
  effects = -1;
  priorAnalysis = '';
  consumers: { declaration: NodeId; codes: readonly string[] }[] = [];

  compile(): void {
    const spies = [vi.spyOn(fs, 'readFileSync'), vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'readdirSync'),
      vi.spyOn(processes, 'spawn'), vi.spyOn(processes, 'exec')];
    try {
      const modules = [...this.modules].map(([locator, input]) => this.module(locator, input));
      this.compilation = new Compiler().compile({ source: { sourceId: 'entry', text: this.text }, locator: 'entry', dependencies: { modules, packages: [] } });
      if (this.compilation.value) this.types = this.compilation.value.types;
    } finally { this.effects = spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0); spies.forEach(spy => spy.mockRestore()); }
  }
  analyze(): void {
    this.types = new TypeDescriber().describe(new Resolver().resolve(this.module('entry', this.text),
      { modules: [...this.modules].map(([locator, input]) => this.module(locator, input)), packages: [] }));
  }
  module(locator: string, input: string | readonly ExternalDefinition[]): ModuleModel {
    if (typeof input !== 'string') return new ExternalModel(locator, input);
    const read = new LangiumReader().read({ sourceId: locator, text: input });
    if (read.status !== 'accepted') throw new Error('Expected accepted source: ' + JSON.stringify(read.diagnostics));
    return new LangiumModel(locator, read.document);
  }
  node(name: string): Item {
    const nodes = [...this.types.typeDeclarations(), ...this.types.callableDeclarations()].map(id => this.types.inspection.read(id));
    const node = nodes.find(node => 'name' in node && node.name === name);
    if (!node) throw new Error('Expected declaration ' + name);
    return node;
  }
  type(name: string): TypeId {
    for (const node of this.types.inspection.query('named-type')) if (this.at(node.origin) === name) return known(this.types.typeOf(node.id));
    return this.types.declaredType(this.node(name).id);
  }
  signature(name: string) {
    return this.types.callable(this.node(name).id);
  }
  error(name: string) { return this.types.error(this.type(name)); }
  failure(name: string, index: number) { return this.signature(name).failures[index]!; }
  errorField(name: string, field: string) { return known(this.error(name)).fields.find(slot => this.name(slot.declaration) === field)!; }
  name(id: NodeId): string { const node = this.types.inspection.read(id); if (!('name' in node)) throw new Error('Expected name'); return node.name; }
  label(id: TypeId): string {
    const type = this.types.describe(id);
    if ('declaration' in type) return this.name(type.declaration) + ('arguments' in type && type.arguments.length ? '<' + type.arguments.map(id => this.label(id)).join(', ') + '>' : '');
    if (type.kind === 'optional') return this.label(type.inner) + '?';
    if (type.kind === 'union') return type.alternatives.map(id => this.label(id)).join(' | ');
    if (type.kind === 'tuple') return '[' + type.elements.map(id => this.label(id)).join(', ') + ']';
    return this.at(this.types.inspection.read(type.expression).origin);
  }
  at(at: ProblemLocation): string {
    if (at.kind !== 'source') return JSON.stringify(at);
    const source = at.module === 'entry' ? this.text : this.modules.get(at.module);
    if (typeof source !== 'string') throw new Error('Expected authored source');
    return Array.from(source).slice(at.range.start.offset, at.range.end.offset).join('');
  }
  location(at: ProblemLocation, text: string, within?: string, occurrence?: number): boolean {
    if (at.kind !== 'source' || this.at(at) !== text) return false;
    const source = at.module === 'entry' ? this.text : this.modules.get(at.module);
    if (typeof source !== 'string') return false;
    const prefix = Array.from(source).slice(0, at.range.start.offset).join('');
    if (occurrence !== undefined) return prefix.split(text).length === occurrence;
    return !within || prefix.length >= source.indexOf(within) && prefix.length < source.indexOf(within) + within.length;
  }
  collect(name: string, fromInspection: boolean): void {
    const signature = this.signature(name);
    if (!fromInspection) this.consumers = signature.failures.map(fact => known(this.types.error(known(fact))));
    else {
      const selected = signature.failures.map(fact => known(this.types.error(known(fact))));
      this.consumers.push(...[...this.types.inspection.query('record-type-declaration')].flatMap(node =>
        selected.filter(error => error.declaration === node.id)));
    }
  }
  analysis(): string { return JSON.stringify({ problems: this.types.problems, deferred: this.types.deferred,
    signatures: [...this.types.callableDeclarations()].map(id => this.types.callable(id)) }); }
  identify(): void { this.identity.source('entry', this.text, true); this.identity.identify(); }
}
export function known<T>(fact: TypeFact<T>): T {
  if (fact.status !== 'known') throw new Error('Expected known fact: ' + JSON.stringify(fact));
  return fact.value;
}
export function causes(fact: TypeFact<unknown>) { return fact.status === 'invalid' ? fact.problems : []; }
export function requirements(fact: TypeFact<unknown>) { return fact.status === 'known' ? [] : fact.status === 'invalid' ? fact.deferred : fact.requirements; }
