import type { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { ArtifactAssociation, IdentifiedSpecification } from './specification-identity.js';
import type { OutputContext } from './output.js';
import { javaName, javaOptions } from './java-settings.js';
import { JavaTypes } from './java-types.js';
import { language } from './language-text.js';
import { canonical } from './identity-baseline.js';

type Options = z.infer<typeof javaOptions>;
export interface JavaFile { path: string; generated: string; artifacts: ArtifactAssociation[] }
type Associate = (node: Item, member?: object, parameter?: number) => void;

/** Translate already checked declarations; JDT separately validates the emitted native contract. */
export class JavaDeclarations {
  readonly problems: Diagnostic[] = [];
  private readonly names = new Map<string, string>();
  private readonly mappings = new Map<string, string>();
  private readonly workspace: ReadonlySet<string>;
  private readonly types: JavaTypes;
  private generics: readonly Item[] = [];
  private signatures = new Map<string, Item>();
  constructor(private readonly current: IdentifiedSpecification, private readonly options: Options, context?: OutputContext) {
    this.workspace = new Set([current.baseline.entry, ...context?.workspaceModules ?? []]);
    const structural = new Set(['class', 'concept', 'component', 'interface', 'record-type-declaration', 'alias-type-declaration',
      'opaque-type-declaration', 'capability', 'function', 'construction', 'field', 'parameter', 'type-parameter']);
    const ownership = (item: Item, owned: boolean): void => {
      if (item.kind === 'examples' || item.kind === 'interaction') return;
      if (structural.has(item.kind) && (item.origin.kind === 'source' && this.workspace.has(item.origin.module)) !== owned)
        this.problem('unsupported-augmentation', 'Native declarations and their effective owner need explicit workspace authority.', item);
      for (const child of current.specification.inspection.children(item.id)) ownership(child, owned);
    };
    for (const root of current.specification.inspection.roots()) if (structural.has(root.kind))
      ownership(root, root.origin.kind === 'source' && this.workspace.has(root.origin.module));
    this.types = new JavaTypes(current.specification.types, options.package, node => this.reference(node), this.problem.bind(this));
    for (const mapping of options.names ?? []) {
      const matches = current.baseline.elements.filter(record => 'id' in mapping ? record.id === mapping.id
        : (!mapping.module || record.address.module === mapping.module) && canonical(this.path(record.id)) === canonical(mapping.declaration));
      if (matches.length !== 1 || this.names.has(matches[0]!.id)) this.mappingProblem('Name mapping must select one distinct checked declaration.');
      else this.names.set(matches[0]!.id, mapping.name);
    }
    for (const mapping of options.imports ?? []) {
      const matches = current.baseline.elements.filter(record => record.address.module === mapping.module && canonical(this.path(record.id)) === canonical(mapping.declaration));
      if (matches.length !== 1 || this.mappings.has(matches[0]!.id)) this.mappingProblem('Import must select one distinct checked declaration.');
      else this.mappings.set(matches[0]!.id, mapping.name);
    }
  }
  private path(id: string): string[] {
    const record = this.current.baseline.elements.find(item => item.id === id)!;
    return [...record.address.owner ? this.path(record.address.owner) : [], record.address.name ?? ''];
  }
  private name(node: Item): string {
    const value = this.names.get(this.current.id(node.id)) ?? ('name' in node ? node.name : node.kind);
    if (!javaName(value)) this.problem('invalid-native-name', 'Map the authored name to an explicit Java identifier: ' + value, node);
    return value;
  }
  private problem(code: string, message: string, node: Item): void { this.problems.push({ code, message, at: node.origin, related: [] }); }
  private mappingProblem(message: string): void { this.problems.push({ code: 'invalid-native-mapping', message, at: { kind: 'dependency', path: ['outputs', 'java', 'options'] }, related: [] }); }
  private distinct(nodes: readonly Item[]): void {
    const names = new Set<string>();
    for (const node of nodes) {
      const name = this.name(node);
      if (names.has(name)) this.problem('native-name-conflict', 'Native name conflicts in this scope: ' + name, node);
      names.add(name);
    }
  }
  private reference(node: Item): string {
    if (node.kind === 'type-parameter') return this.name(node);
    if (this.generics.some(parameter => this.name(parameter) === this.name(node))) this.problem('native-name-conflict', 'Generic name hides a referenced contract: ' + this.name(node), node);
    const mapped = this.mappings.get(this.current.id(node.id));
    if (mapped) return mapped;
    if (node.kind === 'opaque-type-declaration' || node.origin.kind !== 'source' || !this.workspace.has(node.origin.module))
      this.problem('missing-native-mapping', 'Provide an actual native type mapping for ' + this.name(node) + '.', node);
    return this.options.package + '.' + this.name(node);
  }
  private type(node: Item, boxed = false): string {
    return this.types.of(node, boxed);
  }
  private docs(lines: string[]): string { return lines.length ? '/**\n * Unverified implementation obligation.\n' + lines.map(line => ' * ' + line.replaceAll('*/', '* /')).join('\n') + '\n */\n' : ''; }
  private parameterLists(member: Item<'capability' | 'function' | 'construction'>) {
    this.distinct(member.parameters);
    let required = member.parameters.length;
    while (required && member.parameters[required - 1]!.hasDefault) required--;
    return Array.from({ length: member.parameters.length - required + 1 }, (_, index) => {
      const members = member.parameters.slice(0, member.parameters.length - index);
      return { members, text: members.map(parameter => this.type(parameter.declaredType) + ' ' + this.name(parameter)).join(', '),
        erased: members.map(parameter => this.types.erased(this.types.known(this.current.specification.types.typeOf(parameter.declaredType.id)), parameter.declaredType)) };
    });
  }
  private signature(name: string, parameters: readonly string[], member: Item): void {
    const key = name + '(' + parameters.join(',') + ')';
    if (this.signatures.has(key)) this.problem('native-signature-conflict', 'Native overload erasure conflicts: ' + key, member);
    this.signatures.set(key, member);
  }
  private callable(member: Item<'capability' | 'function'>, public_: boolean, signature: boolean, static_: boolean, associate: Associate): string[] {
    const name = this.name(member);
    const docs = member.parameters.flatMap(parameter => parameter.defaultValue ? ['@default ' + parameter.name + ' = ' + language(parameter.defaultValue)] : []);
    if (!member.returnType) docs.push('Result unspecified for ' + member.name + '; java.lang.Object is an implementation obligation.');
    for (const failure of member.failures) docs.push(member.name + ' may fail with ' + language(failure) + '; implementation obligation.');
    if (member.body.kind === 'available') docs.push(...member.body.content.members.map(item => item.kind === 'promises' ? item.text : language(item)));
    return this.parameterLists(member).map(parameters => {
      const selector = { kind: 'method', name, parameters: parameters.erased, static: static_ };
      this.signature(name, parameters.erased, member); associate(member, selector);
      parameters.members.forEach((parameter, index) => associate(parameter, selector, index));
      return this.docs(docs) + (public_ ? 'public ' : 'private ') + (static_ ? 'static ' : '')
        + (member.returnType ? this.type(member.returnType) : 'java.lang.Object') + ' ' + name + '('
        + parameters.text + ')'
        + (signature ? ';' : ' { throw new java.lang.UnsupportedOperationException(' + JSON.stringify('Not implemented: ' + member.name) + '); }');
    });
  }
  private construction(owner: Item<'class' | 'concept' | 'component'>, member: Item<'construction'>, associate: Associate): string[] {
    const docs = member.parameters.flatMap(parameter => parameter.defaultValue ? ['@default ' + parameter.name + ' = ' + language(parameter.defaultValue)] : []);
    return this.parameterLists(member).map(parameters => {
      const selector = { kind: 'constructor', parameters: parameters.erased };
      this.signature('<init>', parameters.erased, member); associate(member, selector);
      parameters.members.forEach((parameter, index) => associate(parameter, selector, index));
      return this.docs(docs) + 'public ' + this.name(owner) + '(' + parameters.text + ') { throw new java.lang.UnsupportedOperationException('
        + JSON.stringify('Not implemented: ' + owner.name + '.construction') + '); }';
    });
  }
  private file(name: string, text: string, artifacts: ArtifactAssociation[]): JavaFile {
    return { path: (this.options.directory ?? 'src/main/java') + '/' + this.options.package.replaceAll('.', '/') + '/' + name + '.java',
      generated: 'package ' + this.options.package + ';\n\n' + text + '\n', artifacts };
  }
  files(): JavaFile[] {
    const result: JavaFile[] = [], inspection = this.current.specification.inspection;
    for (const root of inspection.roots()) {
      if (root.origin.kind !== 'source' || !this.workspace.has(root.origin.module)) continue;
      if (root.kind === 'opaque-type-declaration') { this.reference(root); continue; }
      if (!['class', 'concept', 'component', 'interface', 'record-type-declaration'].includes(root.kind)) continue;
      this.generics = 'typeParameters' in root ? root.typeParameters : []; this.distinct(this.generics); this.signatures = new Map();
      const name = this.name(root), type = this.options.package + '.' + name;
      const path = (this.options.directory ?? 'src/main/java') + '/' + type.replaceAll('.', '/') + '.java';
      const artifacts: ArtifactAssociation[] = [];
      const associate: Associate = (node, member, parameter) => artifacts.push({ specId: this.current.id(node.id), locator: {
        outputId: 'java', format: 'java-symbol-1', value: { file: path, type, ...(member ? { member } : {}), ...(parameter === undefined ? {} : { parameter }) } as ArtifactAssociation['locator']['value'],
      } });
      associate(root);
      let text = '';
      if (root.kind === 'record-type-declaration') {
        const fields = root.fields.map(field => field.kind === 'local' ? field.declaration : field).filter((field): field is Item<'field'> => field.kind === 'field');
        this.distinct(fields);
        const parameters = fields.map(field => this.type(field.declaredType) + ' ' + this.name(field));
        for (const [index, field] of fields.entries()) {
          associate(field, { kind: 'field', name: this.name(field) });
          associate(field, { kind: 'method', name: this.name(field), parameters: [], static: false });
          associate(field, { kind: 'constructor', parameters: fields.map(item => this.types.erased(this.types.known(this.current.specification.types.typeOf(item.declaredType.id)), item.declaredType)) }, index);
        }
        const generic = root.typeParameters.length ? '<' + root.typeParameters.map(parameter => this.name(parameter)).join(', ') + '>' : '';
        const validation = fields.map(field => this.name(field) + ' = ' + this.types.value(this.types.known(this.current.specification.types.typeOf(field.declaredType.id)), this.name(field), JSON.stringify(field.name)) + ';');
        text = 'public record ' + name + generic + '(' + parameters.join(', ') + ') {\n    public ' + name + ' {\n'
          + validation.map(line => '        ' + line).join('\n') + '\n    }\n}';
        if (root.error) {
          const data = name + (root.typeParameters.length ? '<' + root.typeParameters.map(() => '?').join(', ') + '>' : '');
          const companion = name + 'Exception';
          result.push(this.file(companion, 'public final class ' + companion + ' extends java.lang.RuntimeException {\n'
            + '    private final ' + data + ' details;\n    public ' + companion + '(' + data + ' details) { super(ExpecData.required(details, "details").code()); this.details = details; }\n'
            + '    public ' + data + ' details() { return details; }\n}', [{ specId: this.current.id(root.id), locator: { outputId: 'java', format: 'java-symbol-1',
              value: { file: (this.options.directory ?? 'src/main/java') + '/' + this.options.package.replaceAll('.', '/') + '/' + companion + '.java', type: this.options.package + '.' + companion } } }]));
        }
      } else if (root.kind === 'class' || root.kind === 'component' || root.kind === 'concept' || root.kind === 'interface') {
        const publicMembers = new Set(root.members.flatMap(member => member.kind === 'public'
          ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
        const methods = root.members.flatMap(member => {
          if (member.kind === 'construction') {
            if (root.kind !== 'interface') return this.construction(root, member, associate);
            this.problem('unsupported-native-construction', 'Java interfaces cannot declare constructors; no factory API is inferred.', member); return [];
          }
          if (member.kind !== 'capability' && member.kind !== 'function') return [];
          return this.callable(member, root.kind === 'interface' || publicMembers.has(member.id), root.kind === 'interface', false, associate);
        });
        text = 'public ' + (root.kind === 'interface' ? 'interface' : 'class') + ' ' + name + ' {\n'
          + methods.map(method => '    ' + method).join('\n') + '\n}';
      }
      result.push({ path, generated: 'package ' + this.options.package + ';\n\n' + text + '\n', artifacts });
    }
    const functions = [...inspection.roots()].filter((node): node is Item<'function'> => node.kind === 'function' && node.origin.kind === 'source' && this.workspace.has(node.origin.module));
    this.generics = []; this.signatures = new Map();
    if (functions.length) {
      const name = this.options.functionsClass ?? 'Functions', artifacts: ArtifactAssociation[] = [], file = this.file(name, '', artifacts);
      const associate: Associate = (node, member, parameter) => artifacts.push({ specId: this.current.id(node.id), locator: { outputId: 'java', format: 'java-symbol-1',
        value: { file: file.path, type: this.options.package + '.' + name, ...(member ? { member } : {}), ...(parameter === undefined ? {} : { parameter }) } as ArtifactAssociation['locator']['value'] } });
      const methods = functions.flatMap(fn => this.callable(fn, true, false, true, associate));
      result.push(this.file(name, 'public final class ' + name + ' {\n    private ' + name + '() {}\n'
        + methods.map(method => method.split('\n').map(line => '    ' + line).join('\n')).join('\n') + '\n}', artifacts));
    }
    const aliases = [...inspection.roots()].filter((node): node is Item<'alias-type-declaration'> => node.kind === 'alias-type-declaration' && node.origin.kind === 'source' && this.workspace.has(node.origin.module));
    if (aliases.length) {
      let generated = '/**\n'; const artifacts: ArtifactAssociation[] = [];
      const path = (this.options.directory ?? 'src/main/java') + '/' + this.options.package.replaceAll('.', '/') + '/package-info.java';
      for (const alias of aliases) {
        const text = (alias.name + ' = ' + this.type(alias.targetType)).replaceAll('*/', '* /');
        generated += ' * '; const start = generated.length; generated += text + '\n';
        artifacts.push({ specId: this.current.id(alias.id), locator: { outputId: 'java', format: 'java-alias-1', value: { file: path, alias: this.current.id(alias.id), start, length: text.length } } });
      }
      result.push({ path, generated: generated + ' */\npackage ' + this.options.package + ';\n', artifacts });
    }
    if (result.length) for (const support of this.types.support()) result.push({
      path: (this.options.directory ?? 'src/main/java') + '/' + this.options.package.replaceAll('.', '/') + '/' + support.name + '.java',
      generated: 'package ' + this.options.package + ';\n\n' + support.text + '\n', artifacts: [],
    });
    const paths = new Map<string, JavaFile>();
    for (const file of result) {
      const key = process.platform === 'win32' ? file.path.toLowerCase() : file.path, previous = paths.get(key);
      if (previous) {
        const id = previous.artifacts[0]?.specId ?? file.artifacts[0]?.specId;
        if (id) this.problem('native-name-conflict', 'Native filename collides with another declaration or required support type: ' + file.path, inspection.read(this.current.node(id)));
      }
      paths.set(key, file);
    }
    return result;
  }
}
