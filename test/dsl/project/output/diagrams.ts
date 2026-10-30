import { afterEach, expect } from 'vitest';
import { DiagramDriver } from '../../../driver/project/output/diagrams.js';
import type { Class, Text, ShapeBase } from '@d2lang/d2';
import { DOMParser } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import type { Item } from '../../../../src/index.js';

const active = new Set<DiagramDriver>();
afterEach(async () => { for (const driver of active) await driver.dispose(); active.clear(); });
export class DiagramExamples {
  private constructor(readonly driver: DiagramDriver) {}
  static async connect(): Promise<DiagramExamples> { const driver = new DiagramDriver(); active.add(driver); await driver.initialize(); return new DiagramExamples(driver); }
  specify(text: string): void { this.driver.specify(text); }
  revise(text: string, retired: string[] = []): void { this.driver.pending = { text, retired }; }
  sourceFile(path: string, text: string): void { this.driver.sourceFiles[path] = text; }
  externalRecord(module: string, name: string, fields: string[]): void { this.driver.externalRecord(module, name, fields); }
  externalComponent(module: string, name: string, operation: string): void { this.driver.externalComponent(module, name, operation); }
  async createFrom(entry: string, options: { views: string[] }): Promise<void> { await this.driver.createFrom(entry, options); }
  renameIdentity(before: string, after: string): void { this.driver.renames.set(before, after); }
  async create(options: { views: string[] }): Promise<void> { await this.driver.create(options); }
  async update(): Promise<void> { await this.driver.update(); }
  private shapes() { return [...this.driver.native.values()].flatMap(result => result.diagram.shapes) as (Class & Text & ShapeBase)[]; }
  private edges() { return [...this.driver.native.values()].flatMap(result => result.diagram.connections); }
  private object(name: string) { return this.shapes().find(shape => shape.label.split('\n').includes(name)); }
  expectContainerKinds(expected: Record<string, string>): void {
    const containers = this.shapes().filter(shape => shape.type === 'class');
    expect(containers.map(shape => shape.label.split('\n').at(-1)).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, kind] of Object.entries(expected)) this.expectDeclaration(name, kind);
  }
  expectOperationLabel(name: string, label: string): void {
    const parts = name.split('.'), owner = parts.length > 1 ? parts.slice(0, -1).join('.') : name;
    expect(this.object(owner)?.methods?.map(method => method.name)).toContain(label);
  }
  expectNoDiagramDefinitions(names: string[]): void { for (const name of names) this.expectNoDeclaration(name); }
  expectNoVisibleTypeAnnotations(): void {
    for (const shape of this.shapes().filter(shape => shape.type === 'class')) {
      for (const method of shape.methods ?? []) { expect(method.name).not.toContain(':'); expect(method.return).toBe(''); }
      for (const field of shape.fields ?? []) expect(field.name).toMatch(/^(?:Promises · .+|.+ · \d+(?: · \d+)?)$/);
    }
  }
  expectNoDanglingEdges(): void {
    const native = this.driver.native.get('design/structure.d2'); expect(native).toBeDefined();
    const classes = new Set(native!.diagram.shapes.filter(shape => shape.type === 'class').map(shape => shape.id));
    for (const edge of native!.diagram.connections) { expect(classes.has(edge.src)).toBe(true); expect(classes.has(edge.dst)).toBe(true); }
  }
  expectPromiseSection(owner: string, operation: string, expected: string[]): void {
    const { group } = this.svgContainer(owner), titles = Array.from(group.getElementsByTagName('title'));
    expect(titles).toHaveLength(1);
    expect(titles[0]!.textContent).toBe(owner + '.' + operation + ':\n' + expected.join('\n'));
    expect(this.object(owner)?.fields ?? []).toEqual([]);
    for (const text of Array.from(group.getElementsByTagName('text'))) for (const promise of expected) expect(text.textContent).not.toContain(promise);
    const method = this.object(owner)?.methods?.find(method => method.name.startsWith(operation + '('));
    expect(method?.return).toBe('...');
  }
  private svgContainer(name: string) {
    const shape = this.object(name); expect(shape, name).toBeDefined();
    const text = this.driver.texts.get('design/structure.svg'); expect(text).toBeDefined();
    const xml = new DOMParser({ onError: (_level, message) => { throw Error(message); } }).parseFromString(text!, 'image/svg+xml');
    const group = Array.from(xml.getElementsByTagName('g')).find(group => Buffer.from(group.getAttribute('class') ?? '', 'base64').toString() === shape!.id);
    expect(group, 'actual rendered SVG group for ' + name).toBeDefined();
    const rect = Array.from(group!.getElementsByTagName('rect')).find(rect => !rect.getAttribute('class')?.includes('class_header'));
    expect(rect, 'actual rendered owner rectangle').toBeDefined();
    const header = Array.from(group!.getElementsByTagName('rect')).find(rect => rect.getAttribute('class')?.includes('class_header'));
    expect(header, 'actual rendered class title compartment').toBeDefined();
    return { group: group!, rect: rect!, header: header! };
  }
  expectAllContainerTitlesAboveTheirContent(): void {
    for (const shape of this.shapes().filter(shape => shape.type === 'class')) {
      const name = shape.label.split('\n').at(-1)!;
      const { group, header } = this.svgContainer(name);
      const bottom = Number(header.getAttribute('y')) + Number(header.getAttribute('height'));
      const texts = Array.from(group.getElementsByTagName('text'));
      const title = texts.find(text => Array.from(text.getElementsByTagName('tspan')).some(line => line.textContent === name));
      expect(title, 'visible container title').toBeDefined();
      expect(Number(title!.getAttribute('y'))).toBeLessThan(bottom);
      for (const text of texts.filter(text => text !== title)) expect(Number(text.getAttribute('y'))).toBeGreaterThanOrEqual(bottom);
    }
  }
  expectNoDetachedPromiseNodes(): void { expect(this.shapes().some(shape => shape.type === 'page')).toBe(false); }
  expectNoVisibleText(text: string): void {
    const xml = new DOMParser().parseFromString(this.driver.texts.get('design/structure.svg')!, 'image/svg+xml');
    expect(Array.from(xml.getElementsByTagName('text')).some(node => node.textContent?.includes(text))).toBe(false);
  }
  async openPriorOwnedDiagramWithType(): Promise<void> { await this.driver.openLegacyTypeFixture(); }
  async addHandwrittenEdge(from: string, to: string, label: string): Promise<void> { await this.driver.appendHandwrittenEdge(from, to, label); }
  rememberProjectBytes(): void {
    this.driver.remembered.set('project-bytes', new Map([...this.driver.bytes].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])));
  }
  expectLocatedOutputConflict(path: string): void {
    expect(this.driver.findings.some(problem => problem.code === 'output-conflict' && problem.at.kind === 'dependency' && problem.at.path.includes(path))).toBe(true);
  }
  expectNoPlannedWrites(): void { expect(this.driver.planned.value?.changes ?? []).toEqual([]); }
  expectRememberedProjectBytesUnchanged(): void { expect(this.driver.after).toEqual(this.driver.remembered.get('project-bytes')); }
  private declared(name: string) { return this.driver.current.specification.inspection.read(this.driver.current.node(this.driver.identifier(name))); }
  expectDeclaredKind(name: string, kind: string): void { expect(this.declared(name).kind).toBe(kind); }
  expectExternalDeclaration(name: string, module: string): void { expect(this.declared(name).origin).toMatchObject({ kind: 'external', module }); }
  expectDeclaredResultKind(name: string, kind: 'none' | 'unspecified'): void {
    expect(this.driver.current.specification.types.callable(this.declared(name).id).result).toMatchObject({ status: 'known', value: { kind } });
  }
  expectDeclaredResultTarget(name: string, target: string): void {
    const types = this.driver.current.specification.types, result = types.callable(this.declared(name).id).result;
    expect(result.status).toBe('known');
    if (result.status !== 'known' || result.value.kind !== 'value') throw Error('Expected declared value result');
    expect(types.describe(result.value.type)).toMatchObject({ kind: 'declared', declaration: this.declared(target).id });
  }
  expectDeclaredFailure(name: string, target: string, arguments_: string[] = []): void {
    const types = this.driver.current.specification.types, failures = types.callable(this.declared(name).id).failures;
    expect(failures).toHaveLength(1); const fact = failures[0]!; expect(fact.status).toBe('known');
    if (fact.status !== 'known') throw Error('Expected known failure');
    const description = types.describe(fact.value); expect(description).toMatchObject({ kind: 'declared', declaration: this.declared(target).id });
    if (!('arguments' in description)) throw Error('Expected declared failure arguments');
    expect(description.arguments.map(argument => types.describe(argument))).toEqual(arguments_.map(argument => expect.objectContaining({ kind: 'declared', declaration: this.declared(argument).id })));
  }
  private declaredField(owner: string, field: string) {
    const node = this.declared(owner); if (node.kind !== 'record-type-declaration') throw Error('Expected record');
    const found = node.fields.find(item => item.kind === 'field' && item.name === field); expect(found).toBeDefined();
    if (!found || found.kind !== 'field') throw Error('Expected field'); return found;
  }
  expectDeclaredFieldLiteral(owner: string, field: string, value: string): void { expect(this.declaredField(owner, field).declaredType).toMatchObject({ kind: 'literal-type', value: { kind: 'string-literal', value } }); }
  expectDeclaredFieldReference(owner: string, field: string, target: string): void { expect(this.declaredField(owner, field).declaredType).toMatchObject({ kind: 'named-type', reference: { segments: [target] } }); }
  expectDeclaredAliasReference(name: string, target: string): void { expect(this.declared(name)).toMatchObject({ kind: 'alias-type-declaration', targetType: { kind: 'named-type', reference: { segments: [target] } } }); }
  expectDeclaredTupleAlias(name: string, targets: string[]): void { expect(this.declared(name)).toMatchObject({ kind: 'alias-type-declaration', targetType: { kind: 'tuple-type', elements: targets.map(target => ({ kind: 'named-type', reference: { segments: [target] } })) } }); }
  private expectLiteralUnion(node: Item, expected: string[]): void { expect(node).toMatchObject({ kind: 'union-type', alternatives: expected.map(value => ({ kind: 'literal-type', value: { kind: 'string-literal', value } })) }); }
  expectDeclaredReturnLiterals(name: string, expected: string[]): void { const node = this.declared(name); if (node.kind !== 'capability' && node.kind !== 'function' || !node.returnType) throw Error('Expected callable result'); this.expectLiteralUnion(node.returnType, expected); }
  expectDeclaredFieldUnionLiterals(owner: string, field: string, expected: string[]): void { this.expectLiteralUnion(this.declaredField(owner, field).declaredType, expected); }
  expectDeclaredAliasUnionLiterals(name: string, expected: string[]): void { const node = this.declared(name); if (node.kind !== 'alias-type-declaration') throw Error('Expected alias'); this.expectLiteralUnion(node.targetType, expected); }
  expectAuthoredPromises(name: string, expected: string[]): void { const node = this.declared(name); if ((node.kind !== 'capability' && node.kind !== 'function') || node.body.kind !== 'available') throw Error('Expected contract body'); expect(node.body.content.members.flatMap(item => item.kind === 'promises' ? [item.text] : [])).toEqual(expected); }
  expectDeclaredParameterReferences(name: string, parameter: string, expected: string[]): void {
    const node = this.declared(name); if (node.kind !== 'capability' && node.kind !== 'function') throw Error('Expected callable');
    const slot = node.parameters.find(slot => slot.name === parameter); expect(slot).toBeDefined();
    const inspection = this.driver.current.specification.inspection;
    const references = (item: Item): string[] => item.kind === 'reference' ? [item.segments.join('.')]
      : [...inspection.children(item.id)].flatMap(references);
    expect(references(slot!.declaredType)).toEqual(expected);
  }
  expectDeclaredReturnShape(name: string, kind: string): void { const node = this.declared(name); if (node.kind !== 'capability' && node.kind !== 'function') throw Error('Expected callable'); expect(node.returnType?.kind).toBe(kind); }
  expectDeclaredParameterShape(name: string, parameter: string, kind: string): void { const node = this.declared(name); if (node.kind !== 'capability' && node.kind !== 'function') throw Error('Expected callable'); expect(node.parameters.find(slot => slot.name === parameter)?.declaredType.kind).toBe(kind); }
  expectDeclaration(name: string, kind: string): void { expect(this.driver.written.receipt, JSON.stringify(this.driver.written)).toBeDefined(); expect(this.object(name)?.label).toContain('«' + kind + '»'); }
  expectRole(role: { from: string; to: string; role: string; label?: string }): void {
    const from = this.object(role.from)?.id, to = this.object(role.to)?.id;
    expect(from).toBeDefined(); expect(to).toBeDefined();
    expect(this.edges().some(edge => edge.src === from && edge.dst === to && this.driver.roles.get(edge.label) === role.role && (!role.label || edge.label === role.label))).toBe(true);
  }
  expectNoRole(role: { from: string; to: string; role: string }): void {
    const from = this.object(role.from)?.id, to = this.object(role.to)?.id;
    expect(this.edges().some(edge => edge.src === from && edge.dst === to && this.driver.roles.get(edge.label) === role.role)).toBe(false);
  }
  expectNoOwnershipDiamonds(): void { expect(this.edges().some(edge => edge.srcArrow.includes('diamond') || edge.dstArrow.includes('diamond'))).toBe(false); }
  expectNoSequenceFiles(): void { expect([...this.driver.native.keys()].filter(path => path.includes('/interactions/'))).toEqual([]); }
  expectCapabilityVisibility(name: string, visibility: 'public' | 'internal'): void {
    const parts = name.split('.'), owner = parts.slice(0, -1).join('.'), member = parts.at(-1)!;
    const method = this.object(owner)?.methods?.find(method => method.name.startsWith(member + '('));
    expect(method, name).toBeDefined(); expect(method!.visibility).toBe(visibility === 'public' ? 'public' : 'private');
    expect(this.object('expec_legend')?.label ?? this.shapes().find(shape => shape.id === 'expec_legend')?.label).toContain('+ public; − internal (not published)');
  }
  expectAuthoredPublicCapabilities(name: string, expected: string[]): void {
    const inspection = this.driver.current.specification.inspection;
    const owner = [...inspection.query('concept'), ...inspection.query('component'), ...inspection.query('class'), ...inspection.query('interface')].find(item => item.name === name);
    expect(owner).toBeDefined();
    const names = owner!.members.flatMap(member => member.kind === 'public' ? member.references.map(reference => {
      expect(reference.resolution.status).toBe('bound');
      if (reference.resolution.status !== 'bound') throw Error('Unbound public selection');
      const selected = inspection.read(reference.resolution.target); return 'name' in selected ? selected.name : selected.kind;
    }) : []);
    expect(names).toEqual(expected);
  }
  expectCapabilityRole(operation: string, role: string, target: string): void { expect(this.driver.capabilityRole(operation, role, target), operation + ' ' + role + ' ' + target).toBe(true); }
  expectStructureDirection(direction: string): void { expect(this.driver.native.get('design/structure.d2')?.graph).toMatchObject({ root: { attributes: { direction: { value: direction } } } }); }
  expectProblem(code: string): void { expect(this.driver.findings.map(problem => problem.code), JSON.stringify(this.driver.findings)).toContain(code); }
  expectNoProblem(code: string): void { expect(this.driver.findings.map(problem => problem.code)).not.toContain(code); }
  expectNoProjectChanges(): void { expect(this.driver.after).toEqual(this.driver.before); }
  expectNoDeclaration(name: string): void { expect(this.object(name)).toBeUndefined(); }
  expectDeclarationCount(name: string, count: number): void { expect(this.shapes().filter(shape => shape.label === name || shape.label.endsWith('\n' + name))).toHaveLength(count); }
  expectNoRenderedMember(name: string): void { const [owner, member] = name.split('.'); expect(this.object(owner!)?.methods?.some(method => method.name.startsWith(member + '('))).not.toBe(true); }
  expectNativeEdgeCountBetween(a: string, b: string, count: number): void {
    const first = this.object(a)?.id, second = this.object(b)?.id; expect(this.edges().filter(edge => edge.src === first && edge.dst === second || edge.src === second && edge.dst === first)).toHaveLength(count);
  }
  expectNoNativeObject(key: string): void { expect(this.shapes().some(shape => shape.id === key)).toBe(false); }
  expectNativeExplicitEdgeCount(count: number): void { expect([...this.driver.native.values()].flatMap(result => (result.graph.ast.nodes as { map_key?: { edges?: unknown[] } }[]).flatMap(node => node.map_key?.edges ?? []))).toHaveLength(count); }
  expectNativeSvgLabel(label: string): void {
    const texts = [...this.driver.texts].filter(([path]) => path.endsWith('.svg')).map(([, text]) => {
      const xml = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(text, 'image/svg+xml');
      expect(xml.documentElement?.localName).toBe('svg'); return xml.documentElement?.textContent ?? '';
    });
    expect(texts.some(text => text.includes(label))).toBe(true);
  }
  expectVisibleSvgLabel(label: string): void {
    const labels = [...this.driver.texts].filter(([path]) => path.endsWith('.svg')).flatMap(([, text]) => {
      const xml = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(text, 'image/svg+xml');
      expect(xml.documentElement?.localName).toBe('svg');
      return ['text', 'tspan'].flatMap(name => Array.from(xml.getElementsByTagNameNS('http://www.w3.org/2000/svg', name), node => node.textContent?.trim()));
    });
    expect(labels).toContain(label);
  }
  private sequence(title: string) { return [...this.driver.native.values()].find(result => (result.diagram.root as Text).label.includes(title)); }
  expectParticipants(title: string, labels: string[]): void { expect(this.sequence(title)?.diagram.shapes.filter(shape => !shape.id.includes('.') && shape.type !== 'text').map(shape => (shape as Text).label)).toEqual(labels); }
  expectDistinctParticipantKeys(a: string, b: string): void { const shapes = this.shapes(); expect(shapes.find(shape => shape.label.startsWith(a + ': '))?.id).not.toBe(shapes.find(shape => shape.label.startsWith(b + ': '))?.id); }
  expectMessages(title: string, messages: string[]): void {
    const sequence = this.sequence(title); expect(sequence).toBeDefined();
    const labels = new Map(sequence!.diagram.shapes.map(shape => [shape.id, (shape as Text).label.split(': ')[0]]));
    type Segment = { unquoted_string?: { value: { string: string }[] } };
    const statements = sequence!.graph.ast.nodes as { map_key?: { edges?: { src: { path: Segment[] }; dst: { path: Segment[] } }[]; value?: { double_quoted_string?: { value: { string: string }[] } } } }[];
    const key = (segments: Segment[]) => segments.map(part => part.unquoted_string?.value.map(value => value.string).join('')).join('.');
    expect(statements.flatMap(statement => statement.map_key?.edges?.map(edge => labels.get(key(edge.src.path)) + ' -> ' + labels.get(key(edge.dst.path)) + ': '
      + statement.map_key?.value?.double_quoted_string?.value.map(part => part.string).join('')) ?? [])).toEqual(messages);
  }
  expectAuthoredMessageCount(title: string, count: number): void { expect((this.sequence(title)?.graph.ast.nodes as { map_key?: { edges?: unknown[] } }[] | undefined)?.flatMap(node => node.map_key?.edges ?? []) ?? []).toHaveLength(count); }
  expectMessageOperation(title: string, ordinal: number, operation: string): void {
    const messages = (this.sequence(title)?.graph.ast.nodes as { comment?: { value: string } }[] | undefined)?.flatMap(node => (node.comment?.value.split('\n') ?? []).filter(line => line.startsWith('expec-uml: ')).map(line => JSON.parse(Buffer.from(line.slice(11), 'base64url').toString()))) ?? [];
    expect(messages.find(value => value.message?.ordinal === ordinal)?.message?.operation).toBe(this.driver.identifier(operation));
  }
  expectNoExtraReplyMessage(title: string): void { this.expectAuthoredMessageCount(title, 2); }
  expectSequenceStatement(title: string, statement: string): void { expect((this.sequence(title)?.diagram.root as Text | undefined)?.label).toContain(statement); }
  rememberArtifactPaths(name: string): void { this.driver.remembered.set(name, [...this.driver.native.keys()].filter(path => path.includes('/interactions/'))); }
  expectArtifactPathsUnchanged(_name: string): void { expect([...this.driver.native.keys()].filter(path => path.includes('/interactions/'))).toEqual([...this.driver.remembered.values()][0]); }
  async writeIndependentNative(path: string, input: { reference: { key: string; subject: string }; source: string }): Promise<void> { await this.driver.independent(path, input.reference, input.source); }
  async write(path: string, text: string): Promise<void> { await this.driver.write(path, text); }
  async search(name: string): Promise<void> { await this.driver.search(name); }
  async read(name: string): Promise<void> { await this.driver.read(name); }
  async delete(name: string): Promise<void> { await this.driver.delete(name); }
  async changeNativeDependencyEndpoint(owner: string, target: string, replacement: { key: string; label: string }): Promise<void> { await this.driver.changeEndpoint(owner, target, replacement); }
  async replaceNativeMemberText(_name: string, before: string, after: string): Promise<void> { await this.driver.replaceMember(before, after); }
  async compareObservedDependencies(name: string, expected: string[]): Promise<void> { await this.driver.compare(name, expected); }
  expectDependencyComparison(expected: { matched: string[]; unobserved: string[]; projectOnly: string[] }): void {
    expect(this.driver.comparison.matched.map(item => item.id)).toEqual(expected.matched.map(name => this.driver.identifier(name)));
    expect(this.driver.comparison.unobserved).toEqual(expected.unobserved.map(name => this.driver.identifier(name)));
    expect(this.driver.comparison.observedOnly.map(use => use.target.id.split('#').at(-1))).toEqual(expected.projectOnly);
  }
  expectProjectConsumer(path: string, key: string): void { expect(this.driver.found.incoming.uses.map(use => use.target)).toContainEqual({ kind: 'project', id: path + '#' + key }); }
  expectNoProjectConsumer(path: string, key: string): void { expect(this.driver.found.incoming.uses.map(use => use.target)).not.toContainEqual({ kind: 'project', id: path + '#' + key }); }
  private slice(path: string, part: 'range' | 'targetRange' | 'keyRange', locator: unknown): string {
    const value = locator as { value: Record<string, { start: number; end: number }> }, range = value.value[part];
    expect(range).toBeDefined(); return this.driver.texts.get(path)!.slice(range!.start, range!.end);
  }
  expectNativeEdgeSlice(path: string, text: string): void { const use = this.driver.found.incoming.uses.find(use => (use.at.value as { path: string }).path === path); expect(use).toBeDefined(); expect(this.slice(path, 'range', use!.at)).toBe(text); }
  expectNativeEndpointSlice(path: string, text: string): void { const use = this.driver.found.incoming.uses.find(use => (use.at.value as { path: string }).path === path); expect(use).toBeDefined(); expect(this.slice(path, 'targetRange', use!.at)).toBe(text); }
  expectOriginalRawFileRetained(path: string): void { expect(this.driver.texts.get(path)).toBe(this.driver.remembered.get(path)); }
  expectCompleteWithinNativeProfile(): void { expect(this.driver.found.incoming.coverage).toMatchObject({ complete: true, limitations: [] }); expect(this.driver.found.outgoing.coverage).toMatchObject({ complete: true, limitations: [] }); }
  expectOutgoingTo(name: string): void { expect(this.driver.found.outgoing.uses.map(use => use.target)).toContainEqual({ kind: 'specified', id: this.driver.identifier(name) }); }
  expectNoOutgoingTo(name: string): void { expect(this.driver.found.outgoing.uses.map(use => use.target)).not.toContainEqual({ kind: 'specified', id: this.driver.identifier(name) }); }
  expectOutgoingProjectElement(path: string, key: string): void { expect(this.driver.found.outgoing.uses.map(use => use.target)).toContainEqual({ kind: 'project', id: path + '#' + key }); }
  expectDefinitionStatement(_name: string, text: string): void { const at = this.driver.found.definitions[0]; expect(at).toBeDefined(); expect(this.slice((at!.value as { path: string }).path, 'range', at)).toBe(text); }
  expectDefinitionKey(_name: string, text: string): void { const at = this.driver.found.definitions[0]; expect(at).toBeDefined(); expect(this.slice((at!.value as { path: string }).path, 'keyRange', at)).toBe(text); }
  expectOriginalRangeMatchesCurrentStatement(_name: string): void { const at = this.driver.found.definitions[0]; expect(at).toBeDefined(); const value = at!.value as { path: string; range: { start: number; line: number; column: number } }; const prefix = this.driver.texts.get(value.path)!.slice(0, value.range.start).split('\n'); expect(value.range.line).toBe(prefix.length); expect(value.range.column).toBe(prefix.at(-1)!.length); }
  expectNoWholeClassSubstituteForMember(_name: string): void { expect(this.driver.found.definitions).toHaveLength(1); expect(this.driver.found.definitions[0]!.format).toBe('d2-member'); }
  expectDeclaredOccurrenceReference(_owner: string, target: string): void { this.expectOutgoingTo(target); }
  expectNoDeclaredOccurrenceReference(_owner: string, target: string): void { this.expectNoOutgoingTo(target); }
  expectNoDuplicateDefinition(_name: string): void { expect(this.driver.found.definitions).toHaveLength(1); expect(this.driver.found.problems.map(problem => problem.code)).not.toContain('ambiguous-definition'); }
  expectCoverageGap(path: string, reason: string): void { expect(this.driver.found.incoming.coverage.complete).toBe(false); expect(this.driver.found.incoming.coverage.limitations.some(text => text.includes(path) && text.includes(reason))).toBe(true); }
  expectNoInventedImportedMemberRange(): void { expect(this.driver.found.definitions.some(at => (at.value as { path: string }).path === 'notes/index.d2')).toBe(false); }
  expectNoGuessedMemberReferenceFromName(_name: string): void { expect(this.driver.found.incoming.uses.some(use => (use.at.value as { path: string }).path === 'notes/nested.d2')).toBe(false); }
  expectNativeProblemAt(path: string, line: number, column: number): void { expect(this.driver.found.problems.some(problem => problem.message.includes(path + ':' + line + ':' + column))).toBe(true); }
  expectIncompleteCoverage(): void { expect(this.driver.found.incoming.coverage.complete).toBe(false); }
  expectIncomingDeclaredOccurrence(name: string): void { expect(this.driver.found.incoming.uses.map(use => use.target)).toContainEqual({ kind: 'specified', id: this.driver.identifier(name) }); }
  expectOwnershipConflict(path: string): void { expect(this.driver.written.problems.some(problem => problem.code === 'output-conflict' && problem.at.kind === 'dependency' && problem.at.path.includes(path))).toBe(true); }
  expectConflictAt(path: string): void { this.expectOwnershipConflict(path); }
  async append(path: string, text: string): Promise<void> { await this.driver.append(path, text); }
  async appendBytes(path: string, bytes: number[]): Promise<void> { await this.driver.append(path, Uint8Array.from(bytes)); }
  expectReadFiles(paths: string[]): void { expect(this.driver.reading.artifacts.map(artifact => artifact.file.path).sort()).toEqual([...paths].sort()); }
  expectReadBytesEqualFiles(): void { expect(this.driver.reading.artifacts.length).toBeGreaterThan(0); for (const artifact of this.driver.reading.artifacts) expect(Buffer.from(artifact.file.bytes)).toEqual(Buffer.from(this.driver.bytes.get(artifact.file.path)!)); }
  expectReadContains(text: string): void { expect(this.driver.reading.artifacts.some(artifact => Buffer.from(artifact.file.bytes).toString().includes(text))).toBe(true); }
  async appendNativePageNote(_name: string, text: string, options: { lineEnding: string }): Promise<void> { await this.driver.append('design/structure.d2', options.lineEnding + 'operator_note: ' + JSON.stringify(text) + ' {shape: page}' + options.lineEnding); }
  rememberFileBytes(path: string): void { this.driver.remembered.set(path, this.driver.bytes.get(path)); }
  expectFileBytesUnchanged(path: string): void { expect(this.driver.bytes.get(path)).toEqual(this.driver.remembered.get(path)); }
  expectFileEndsWithBytes(path: string, text: string): void { expect(Buffer.from(this.driver.bytes.get(path)!).subarray(-Buffer.byteLength(text))).toEqual(Buffer.from(text)); }
  expectSvgDigestMatchesActualSource(svg: string, source: string): void {
    const xml = new DOMParser().parseFromString(this.driver.texts.get(svg)!, 'image/svg+xml');
    const node = [...Array.from(xml.getElementsByTagName('metadata'))].find(node => node.getAttribute('id') === 'expec-diagram'); expect(node).toBeDefined();
    const data = JSON.parse(Buffer.from(node!.textContent ?? '', 'base64url').toString()); expect(data.source).toBe(source);
    expect(data.digest).toBe(createHash('sha256').update(this.driver.bytes.get(source)!).digest('hex'));
  }
  rememberNativeKey(name: string): void { this.driver.remembered.set('key:' + name, this.driver.nativeKey(name)); }
  expectNativeKeyUnchanged(name: string): void { expect(this.driver.nativeKey(name)).toBe(this.driver.remembered.get('key:' + name)); }
  async insert(): Promise<void> { await this.driver.insert(); }
  expectPlanPathsUnique(): void { const paths = this.driver.written.receipt?.outcomes.map(outcome => 'path' in outcome.change ? outcome.change.path : outcome.change.to); expect(paths).toBeDefined(); expect(new Set(paths).size).toBe(paths!.length); }
  expectUnchanged(): void { expect(this.driver.written.receipt?.status, JSON.stringify(this.driver.written)).toBe('unchanged'); }
  async appendNativeIncoming(name: string, key: string, label: string): Promise<void> { await this.driver.append('design/structure.d2', '\n' + key + ' -> ' + this.driver.nativeKey(name) + ': ' + JSON.stringify(label) + '\n'); }
  async appendActorNote(title: string, actor: string, text: string): Promise<void> { const entry = [...this.driver.native].find(([, diagram]) => (diagram.diagram.root as Text).label.includes(title)); expect(entry).toBeDefined(); await this.driver.append(entry![0], '\n' + this.driver.nativeKey(title + '.' + actor) + '.note: ' + JSON.stringify(text) + '\n'); }
  async appendNativeLabelOverride(name: string, text: string): Promise<void> { await this.driver.append('design/structure.d2', '\n' + this.driver.nativeKey(name) + ': ' + JSON.stringify(text) + '\n'); }
  async planUpdate(): Promise<void> { await this.driver.plan(); }
  async applyPlannedChangesWithRealWriter(): Promise<void> { await this.driver.apply(); }
  expectStaleWriteConflict(): void { expect(this.driver.written.receipt?.status).toBe('stopped'); this.expectProblem('stale-project'); }
  expectNoConfirmedAssociations(): void { expect(this.driver.written.artifacts).toBeUndefined(); }
  failActualWrite(path: string): void { this.driver.failWrite(path); }
  restoreFileWrites(): void { this.driver.restoreWrites(); }
  expectStoppedReceiptWithCreatedFile(path: string): void { expect(this.driver.written.receipt?.status).toBe('stopped'); expect(this.driver.written.receipt?.outcomes.some(outcome => outcome.state === 'applied' && 'path' in outcome.change && outcome.change.path === path)).toBe(true); }
  expectNoFile(path: string): void { expect(this.driver.bytes.has(path)).toBe(false); }
  async recordAndDenyAmbientResourceAccess(): Promise<void> { this.driver.denyResources(); }
  expectNoAssetOrNetworkReadAttempts(): void { expect(this.driver.deniedResources).toEqual([]); }
  expectNativeSvgDocuments(count: number): void {
    const files = [...this.driver.texts].filter(([path]) => path.endsWith('.svg')); expect(files).toHaveLength(count);
    for (const [, text] of files) { const xml = new DOMParser({ onError: (_level, message) => { throw Error(message); } }).parseFromString(text, 'image/svg+xml'); expect(xml.documentElement?.localName).toBe('svg'); expect(xml.getElementsByTagName('text').length).toBeGreaterThan(0); }
  }
  expectAllSvgDigestsMatchActualSources(): void { const files = [...this.driver.texts.keys()].filter(path => path.endsWith('.svg')); expect(files.length).toBeGreaterThan(0); for (const path of files) this.expectSvgDigestMatchesActualSource(path, path.replace(/\.svg$/, '.d2')); }
  expectSvgContainsNoExternalAssetReferences(): void {
    for (const [path, text] of this.driver.texts) if (path.endsWith('.svg')) {
      const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
      for (const element of Array.from(xml.getElementsByTagName('*'))) for (const attribute of Array.from(element.attributes)) if (['href', 'xlink:href', 'src'].includes(attribute.name)) expect(attribute.value).toMatch(/^(?:#|data:)/);
    }
  }
  async renderSameIdentifiedSpecificationInFreshProject(): Promise<void> { await this.driver.renderFresh(); }
  expectNativeSvgBytesIdenticalAcrossProjects(): void { const paths = [...this.driver.bytes.keys()].filter(path => path.endsWith('.svg')); expect(paths.length).toBeGreaterThan(0); expect(this.driver.fresh!.root).not.toBe(this.driver.root); for (const path of paths) expect(this.driver.bytes.get(path)).toEqual(this.driver.fresh!.bytes.get(path)); }
}
