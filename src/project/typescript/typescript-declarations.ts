import ts from 'typescript';
import { z } from 'zod';
import type { Item } from '../../model/inspection-item.js';
import type { NodeId } from '../../model/model.js';
import type { ArtifactAssociation, IdentifiedSpecification } from '../../model/specification-identity.js';
import type { OutputContext } from '../output/output.js';
import type { Diagnostic } from '../../compiler/checking.js';
import type { TypeFact, TypeId } from '../../compiler/type-description.js';
import { literal } from '../connection/project-files.js';
import { language } from '../../language/language-text.js';
import { decimal } from '../../compiler/decimal.js';

const f = ts.factory, exported = [f.createModifier(ts.SyntaxKind.ExportKeyword)];
const path = z.array(z.string().min(1)).min(1), name = z.string().min(1);
export const typescriptOptions = z.strictObject({
  directory: z.string().refine(value => literal(value) && !/[\\:*?<>|\[\]{}]/.test(value) && !value.split('/').some(part => part.toLowerCase() === '.expec')),
  concepts: z.enum(['class', 'interface']).default('class'),
  adoptExisting: z.boolean().default(false),
  configFile: z.string().refine(value => literal(value) && !value.includes('\\')).optional(),
  names: z.array(z.strictObject({ declaration: path, name, module: name.optional() })).default([]),
  imports: z.array(z.strictObject({ module: name, declaration: path, name, from: name.optional(), as: name.optional() })
    .refine(value => !value.as || !!value.from, { message: 'A global mapping cannot have an import alias.' })).default([]),
});
export type TypeScriptOptions = z.infer<typeof typescriptOptions>;
export interface NativeContainer { readonly role: 'dsl' | 'driver'; readonly declaration: readonly import('./typescript-symbols.js').Selector[] }
export interface NativeFile { readonly id: string; readonly path: string; readonly text: string; readonly artifacts: readonly ArtifactAssociation[]; readonly container?: NativeContainer }
type Import = TypeScriptOptions['imports'][number];
type Concept = Item<'concept' | 'component' | 'class' | 'interface'>;
const rootKinds = new Set(['concept', 'component', 'class', 'interface', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'function']);
const nativeDeclarations = new Set([...rootKinds, 'capability', 'field', 'construction', 'parameter', 'type-parameter']);
const reserved = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield any boolean constructor declare get module require number set string symbol type from of async await unknown never undefined').split(' '));
const identifier = (text: string): boolean => /^[A-Za-z_$][\w$]*$/.test(text) && !reserved.has(text);
export { identifier as nativeIdentifier };
const property = (text: string): ts.PropertyName => identifier(text) ? f.createIdentifier(text) : f.createStringLiteral(text);
const unwrap = (item: Item): Item => item.kind === 'local' ? item.declaration : item;

/** Maps shared checked declarations to native factory nodes, retaining source identities. */
export class TypeScriptDeclarations {
  readonly problems: Diagnostic[] = [];
  private readonly inspection;
  private readonly catalog;
  private readonly names = new Map<NodeId, string>();
  private readonly mappings = new Map<NodeId, Import>();
  private readonly roots: Item[];
  private readonly eligible = new Set<NodeId>();
  private readonly owner = new Map<NodeId, Item>();
  private readonly modules: Set<string>;
  private imports = new Map<string, Import>();
  private bindings = new Map<string, NodeId>();
  private required = new Set<string>();
  private scopes: { names: string[]; kind: 'type' | 'value' }[] = [];
  private artifacts: ArtifactAssociation[] = [];
  private file = '';
  private root!: Item;
  private number = false;
  constructor(private readonly current: IdentifiedSpecification, private readonly options: TypeScriptOptions, context?: OutputContext) {
    this.inspection = current.specification.inspection; this.catalog = current.specification.types;
    this.modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
    this.roots = [...this.inspection.roots()].filter(item => rootKinds.has(item.kind) && item.origin.kind === 'source' && this.modules.has(item.origin.module));
    const collect = (item: Item, root: Item): void => {
      if (item.kind === 'examples' || item.kind === 'interaction') return;
      if (nativeDeclarations.has(item.kind)
        && (item.origin.kind !== 'source' || !this.modules.has(item.origin.module))) {
        this.problem('unsupported-augmentation', item, 'Provider contribution cannot be emitted under a workspace owner: ' + this.authored(item));
      }
      this.eligible.add(item.id); this.owner.set(item.id, root);
      for (const child of this.inspection.children(item.id)) collect(child, root);
    };
    for (const root of this.roots) collect(root, root);
    for (const rule of options.names) {
      const matches = this.select(rule.declaration, rule.module).filter(item => this.eligible.has(item.id));
      if (matches.length !== 1) this.problem('invalid-native-mapping', matches[0], 'Name selector must select one eligible declaration: ' + rule.declaration.join('.'));
      else if (this.names.has(matches[0]!.id) || !identifier(rule.name)) this.problem('invalid-native-name', matches[0], 'Conflicting or invalid native name: ' + rule.name);
      else this.names.set(matches[0]!.id, rule.name);
    }
    for (const rule of options.imports) {
      const matches = this.select(rule.declaration, rule.module).filter(item => !this.eligible.has(item.id) || item.kind === 'opaque-type-declaration');
      if (matches.length !== 1 || !identifier(rule.name) || rule.as && !identifier(rule.as)) this.problem('invalid-native-mapping', matches[0], 'Import selector/name must select one non-generated declaration: ' + rule.declaration.join('.'));
      else if (this.mappings.has(matches[0]!.id)) this.problem('invalid-native-mapping', matches[0], 'Duplicate native mapping: ' + rule.declaration.join('.'));
      else this.mappings.set(matches[0]!.id, rule);
    }
    const checkProvider = (item: Item): void => {
      if (item.kind === 'examples' || item.kind === 'interaction') return;
      if (nativeDeclarations.has(item.kind) && item.origin.kind === 'source' && this.modules.has(item.origin.module)) {
        this.problem('unsupported-augmentation', item, 'Workspace contribution cannot generate provider parent: ' + this.authored(item));
      }
      for (const child of this.inspection.children(item.id)) checkProvider(child);
    };
    for (const root of this.inspection.roots()) if (rootKinds.has(root.kind) && !this.eligible.has(root.id)) checkProvider(root);
  }
  private select(path: string[], module?: string): Item[] {
    return this.current.baseline.elements.filter(record => (module === undefined || record.address.module === module)
      && JSON.stringify(this.path(record.id)) === JSON.stringify(path)).map(record => this.inspection.read(this.current.node(record.id)));
  }
  private path(id: string): string[] { const record = this.current.baseline.elements.find(record => record.id === id)!;
    return [...record.address.owner ? this.path(record.address.owner) : [], record.address.name ?? record.address.kind]; }
  private authored(item: Item): string { return this.path(this.current.id(item.id)).join('.'); }
  private problem(code: string, item: Item | undefined, message: string): void {
    this.problems.push({ code, message, at: item?.origin ?? { kind: 'dependency', path: ['outputs', 'typescript', 'options'] }, related: [] });
  }
  private known<T>(fact: TypeFact<T>, at: Item): T {
    if (fact.status === 'known') return fact.value;
    this.problem('unsupported-output', at, 'Shared checked facts are unavailable for ' + at.kind + '.'); throw new UnavailableType();
  }
  private name(item: Item): string {
    const explicit = this.names.get(item.id); if (explicit) return explicit;
    let value = 'name' in item ? item.name : item.kind;
    const root = this.owner.get(item.id);
    if (root && root !== item && rootKinds.has(item.kind)) {
      let parent = this.inspection.parent(item.id);
      while (parent && !rootKinds.has(parent.kind)) parent = this.inspection.parent(parent.id);
      value = this.name(parent ?? root) + '_' + value;
    }
    if (!identifier(value) && !['field', 'capability'].includes(item.kind)) this.problem('invalid-native-name', item, 'Provide an explicit native name for ' + value + '.');
    return value;
  }
  private shadows(name: string, item: Item, imported = false): boolean {
    return imported || (name === 'Error' ? ['class', 'function'].includes(item.kind)
      || ['concept', 'component'].includes(item.kind) && this.options.concepts === 'class' : item.kind !== 'function');
  }
  private bind(name: string, item: Item, imported = false): void {
    const before = this.bindings.get(name);
    if (before && before !== item.id || this.required.has(name) && this.shadows(name, item, imported)) this.problem('native-name-conflict', item, 'Native name conflicts in this file: ' + name);
    this.bindings.set(name, item.id);
  }
  private require(name: string, item: Item): void {
    const bound = this.bindings.get(name);
    if (bound && this.shadows(name, this.inspection.read(bound), this.imports.has(name))
      || this.scopes.some(scope => scope.kind === (name === 'Error' ? 'value' : 'type') && scope.names.includes(name))) this.problem('native-name-conflict', item, 'Native lexical dependency is shadowed: ' + name);
    this.required.add(name);
  }
  private distinct(items: readonly Item[]): void {
    const names = new Set<string>();
    for (const item of items) { const name = this.name(item);
      if (names.has(name)) this.problem('native-name-conflict', item, 'Native name conflicts in this scope: ' + name); names.add(name);
    }
  }
  private reference(item: Item): string {
    const selected = this.mappings.get(item.id), name = selected?.as ?? selected?.name ?? this.name(item);
    if (this.scopes.some(scope => scope.kind === 'type' && scope.names.includes(name))) this.problem('native-name-conflict', item, 'A generic parameter hides the referenced native type: ' + name);
    const mapping = this.mappings.get(item.id);
    if (mapping) {
      this.bind(name, item, !!mapping.from);
      if (mapping.from) this.imports.set(name, mapping); return name;
    }
    const root = this.owner.get(item.id);
    if (!root || item.kind === 'opaque-type-declaration') {
      this.problem('missing-native-mapping', item, 'No explicit native mapping for ' + ('name' in item ? item.name : item.kind)); return '__unmapped';
    }
    if (root !== this.root) { this.bind(name, item, true); this.imports.set(name, { module: '', declaration: [], name, from: './' + this.name(root) + '.js' }); }
    return name;
  }
  private type(id: TypeId): ts.TypeNode {
    const meaning = this.catalog.describe(id);
    if (meaning.kind === 'parameter') return f.createTypeReferenceNode(this.name(this.inspection.read(meaning.declaration)));
    if (meaning.kind === 'builtin' || meaning.kind === 'declared' || meaning.kind === 'alias') {
      const node = this.inspection.read(meaning.declaration);
      if (meaning.kind !== 'builtin') return f.createTypeReferenceNode(this.reference(node), meaning.arguments.map(type => this.type(type)));
      const name = this.inspection.read(meaning.declaration, 'builtin-type').name;
      if (name === 'List') { this.require('Array', node); return f.createTypeReferenceNode('Array', meaning.arguments.map(type => this.type(type))); }
      if (name === 'Number') this.number = true;
      return f.createKeywordTypeNode(({ Text: ts.SyntaxKind.StringKeyword, Number: ts.SyntaxKind.NumberKeyword, Boolean: ts.SyntaxKind.BooleanKeyword, Nothing: ts.SyntaxKind.VoidKeyword } as const)[name as 'Text']);
    }
    if (meaning.kind === 'tuple') return ts.setEmitFlags(f.createTupleTypeNode(meaning.elements.map(type => this.type(type))), ts.EmitFlags.SingleLine);
    if (meaning.kind === 'union') return f.createUnionTypeNode(meaning.alternatives.map(type => this.type(type)));
    if (meaning.kind === 'optional') return f.createUnionTypeNode([this.type(meaning.inner), f.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)]);
    if (meaning.kind !== 'literal') throw new UnavailableType();
    const literal = this.inspection.read(meaning.expression, 'literal-type'), value = literal.value;
    if (value.kind === 'string-literal') return f.createLiteralTypeNode(f.createStringLiteral(value.value));
    if (value.kind === 'boolean-literal') return f.createLiteralTypeNode(value.value ? f.createTrue() : f.createFalse());
    const token = (literal.negative ? '-' : '') + value.token, number = Number(token); this.number = true;
    if (!Number.isFinite(number) || decimal(token) !== decimal(String(number))) this.problem('unsupported-number', literal, 'JavaScript Number cannot preserve ' + token + '.');
    return f.createLiteralTypeNode(number < 0 ? f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(Math.abs(number))) : f.createNumericLiteral(Number.isFinite(number) ? number : 0));
  }
  private optional(id: TypeId): boolean { let description = this.catalog.describe(id); while (description.kind === 'alias') description = this.catalog.describe(this.known(description.target, this.inspection.read(description.declaration))); return description.kind === 'optional'; }
  private typeParameters(item: Item): ts.TypeParameterDeclaration[] {
    if (!('typeParameters' in item)) return []; this.distinct(item.typeParameters);
    return item.typeParameters.map(parameter => f.createTypeParameterDeclaration(undefined, this.name(parameter)));
  }
  private docs<T extends ts.Node>(node: T, lines: string[]): T {
    if (lines.length) ts.addSyntheticLeadingComment(node, ts.SyntaxKind.MultiLineCommentTrivia, '*\n * Unverified implementation obligation.\n' + lines.map(line => ' * ' + line.replaceAll('*/', '* /')).join('\n') + '\n ', true); return node;
  }
  private associate(item: Item, declaration: { kind: string; name: string; static?: boolean }[]): void {
    this.artifacts.push({ specId: this.current.id(item.id), locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: this.file, declaration } } });
  }
  private parameters(items: readonly Item<'parameter'>[]): ts.ParameterDeclaration[] {
    this.distinct(items);
    return items.map(item => this.docs(f.createParameterDeclaration(undefined, undefined, this.name(item), item.hasDefault ? f.createToken(ts.SyntaxKind.QuestionToken) : undefined,
      this.type(this.known(this.catalog.typeOf(item.declaredType.id), item)), undefined), item.defaultValue ? ['@default ' + language(item.defaultValue)] : []));
  }
  private body(item: Item): ts.Block {
    this.require('Error', item);
    return f.createBlock([f.createThrowStatement(f.createNewExpression(f.createIdentifier('Error'), undefined, [f.createStringLiteral('Not implemented: ' + this.authored(item))]))], true);
  }
  private callable(item: Item<'capability' | 'function'>, signature: boolean, private_: boolean, owner = this.root): ts.MethodDeclaration | ts.MethodSignature | ts.FunctionDeclaration {
    const facts = this.catalog.callable(item.id), result = this.known(facts.result, item);
    this.scopes.push({ names: item.parameters.map(parameter => this.name(parameter)), kind: 'value' });
    const parameters = this.parameters(item.parameters), type = result.kind === 'value' ? this.type(result.type)
      : f.createKeywordTypeNode(result.kind === 'none' ? ts.SyntaxKind.VoidKeyword : ts.SyntaxKind.UnknownKeyword);
    const body = signature ? undefined : this.body(item), docs = result.kind === 'unspecified' ? ['Result unspecified in .expec; unknown is a scaffold placeholder.'] : [];
    if (item.body.kind === 'available') docs.push(...item.body.content.members.map(member => member.kind === 'promises' ? member.text : language(member)));
    for (const failure of facts.failures) {
      const type = this.known(failure, item), error = this.known(this.catalog.error(type), item), declaration = this.inspection.read(error.declaration);
      docs.push('@throws ' + language(item.failures[facts.failures.indexOf(failure)]!) + ' (' + this.reference(declaration)
        + (this.eligible.has(declaration.id) ? 'Error' : '') + '): implementation obligation.');
    }
    this.scopes.pop();
    if (item === this.root) { this.associate(item, [{ kind: 'function', name: this.name(item) }]); return this.docs(f.createFunctionDeclaration(exported, undefined, this.name(item), undefined, parameters, type, body), docs); }
    if (!signature && this.name(item) === 'constructor') this.problem('native-name-conflict', item, 'Capability constructor needs an explicit different native name.');
    this.associate(item, [{ kind: signature ? 'interface' : 'class', name: this.name(owner) }, { kind: 'method', name: this.name(item), ...signature ? {} : { static: false } }]);
    return this.docs(signature ? f.createMethodSignature(undefined, property(this.name(item)), undefined, undefined, parameters, type)
      : f.createMethodDeclaration(private_ ? [f.createModifier(ts.SyntaxKind.PrivateKeyword)] : undefined, undefined, property(this.name(item)), undefined, undefined, parameters, type, body), docs);
  }
  private field(item: Item<'field'>, owner: Item, kind: 'type' | 'interface' | 'class'): ts.PropertySignature | ts.PropertyDeclaration {
    const type = this.known(this.catalog.typeOf(item.declaredType.id), item), optional = this.optional(type) ? f.createToken(ts.SyntaxKind.QuestionToken) : undefined;
    const field = kind === 'class' ? f.createPropertyDeclaration(undefined, property(this.name(item)), optional ?? f.createToken(ts.SyntaxKind.ExclamationToken), this.type(type), undefined)
      : f.createPropertySignature(undefined, property(this.name(item)), optional, this.type(type));
    this.associate(item, [{ kind, name: this.name(owner) }, { kind: 'property', name: this.name(item), ...kind === 'class' ? { static: false } : {} }]);
    return this.docs(field, item.defaultValue ? ['@default ' + language(item.defaultValue)] : []);
  }
  private declare(item: Item, public_: boolean): ts.Statement[] {
    const name = this.name(item), modifiers = public_ ? exported : undefined, params = this.typeParameters(item);
    this.scopes.push({ names: params.map(parameter => parameter.name.text), kind: 'type' });
    let statements: ts.Statement[];
    if (item.kind === 'function') statements = [this.callable(item, false, false) as ts.FunctionDeclaration];
    else if (item.kind === 'alias-type-declaration') {
      this.associate(item, [{ kind: 'type', name }]);
      statements = [f.createTypeAliasDeclaration(modifiers, name, params, this.type(this.known(this.catalog.typeOf(item.targetType.id), item)))];
    } else if (item.kind === 'record-type-declaration') {
      this.distinct(item.fields.map(unwrap));
      this.associate(item, [{ kind: 'type', name }]);
      statements = [f.createTypeAliasDeclaration(modifiers, name, params, f.createTypeLiteralNode(item.fields.map(unwrap).filter((field): field is Item<'field'> => field.kind === 'field').map(field => this.field(field, item, 'type') as ts.PropertySignature)))];
      if (item.error) {
        this.require('Error', item); const companion = name + 'Error'; this.bind(companion, item);
        const details = f.createPropertyAccessExpression(f.createIdentifier('details'), 'code');
        statements.push(f.createClassDeclaration(modifiers, companion, params, [f.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [f.createExpressionWithTypeArguments(f.createIdentifier('Error'), undefined)])], [
          f.createConstructorDeclaration(undefined, [f.createParameterDeclaration([f.createModifier(ts.SyntaxKind.ReadonlyKeyword)], undefined, 'details', undefined,
            f.createTypeReferenceNode(name, params.map(parameter => f.createTypeReferenceNode(parameter.name))), undefined)], f.createBlock([
              f.createExpressionStatement(f.createCallExpression(f.createSuper(), undefined, [details])),
              f.createExpressionStatement(f.createBinaryExpression(f.createPropertyAccessExpression(f.createThis(), 'name'), ts.SyntaxKind.EqualsToken, f.createStringLiteral(companion))),
            ], true)),
        ])); this.associate(item, [{ kind: 'class', name: companion }]);
      }
    } else if (['concept', 'component', 'class', 'interface'].includes(item.kind)) statements = this.concept(item as Concept, public_);
    else { this.problem('unsupported-output', item, 'Unsupported native declaration: ' + item.kind); statements = []; }
    this.scopes.pop(); return statements;
  }
  private concept(item: Concept, public_: boolean): ts.Statement[] {
    const name = this.name(item), kind = item.kind === 'class' || item.kind === 'interface' ? item.kind : this.options.concepts;
    const signature = kind === 'interface', native: (ts.ClassElement | ts.TypeElement)[] = [], statements: ts.Statement[] = [], docs: string[] = [];
    const publicIds = new Set(item.members.flatMap(member => member.kind === 'public' ? member.references.flatMap(reference => reference.resolution.status === 'bound' ? [reference.resolution.target] : []) : []));
    this.distinct(item.members.map(unwrap).filter(member => ['capability', 'function', 'field'].includes(member.kind) && (!signature || member.kind === 'field' || publicIds.has(member.id))));
    this.associate(item, [{ kind, name }]);
    for (const wrapped of item.members) {
      const member = unwrap(wrapped);
      if (member.kind === 'capability' || member.kind === 'function') { if (!signature || publicIds.has(member.id)) native.push(this.callable(member, signature, !publicIds.has(member.id), item) as ts.MethodDeclaration); }
      else if (member.kind === 'field') native.push(this.field(member, item, kind));
      else if (member.kind === 'construction') {
        this.scopes.push({ names: member.parameters.map(parameter => this.name(parameter)), kind: 'value' });
        const parameters = this.parameters(member.parameters);
        if (signature) {
          const companion = name + 'Constructor'; this.bind(companion, item);
          statements.push(f.createInterfaceDeclaration(public_ ? exported : undefined, companion, undefined, undefined,
            [f.createConstructSignature(undefined, parameters, f.createTypeReferenceNode(name))]));
          this.associate(member, [{ kind: 'interface', name: companion }]);
        } else {
          native.push(f.createConstructorDeclaration(undefined, parameters, this.body(member)));
          this.associate(member, [{ kind: 'class', name }, { kind: 'constructor', name: 'constructor' }]);
        }
        this.scopes.pop();
      } else if (member.kind === 'depends-on') for (const reference of member.references) {
        if (reference.resolution.status !== 'bound') throw new UnavailableType();
        docs.push('Depends on: ' + this.reference(this.inspection.read(reference.resolution.target)));
      } else if (member.kind === 'requires-package') docs.push('Requires package: ' + member.locator.value + ' (' + (member.phase ?? 'runtime') + ')');
      else if (rootKinds.has(member.kind)) { this.bind(this.name(member), member); statements.push(...this.declare(member, false)); }
    }
    return [this.docs(signature ? f.createInterfaceDeclaration(public_ ? exported : undefined, name, undefined, undefined, native as ts.TypeElement[])
      : f.createClassDeclaration(public_ ? exported : undefined, name, undefined, undefined, native as ts.ClassElement[]), docs), ...statements];
  }
  render(): NativeFile[] {
    const files: NativeFile[] = [], paths = new Map<string, Item>();
    for (const root of this.roots) {
      if (root.kind === 'opaque-type-declaration') { if (!this.mappings.has(root.id)) this.problem('missing-native-mapping', root, 'No explicit native mapping for ' + root.name); continue; }
      this.root = root; this.file = this.options.directory + '/' + this.name(root) + '.ts';
      const key = process.platform === 'win32' ? this.file.toLowerCase() : this.file;
      if (paths.has(key)) this.problem('native-name-conflict', root, 'Generated filename collides: ' + this.name(root)); paths.set(key, root);
      this.imports = new Map(); this.bindings = new Map(); this.required = new Set(); this.scopes = []; this.artifacts = []; this.number = false;
      this.bind(this.name(root), root);
      for (const item of this.current.baseline.elements.filter(record => this.eligible.has(this.current.node(record.id)))) {
        const node = this.inspection.read(this.current.node(item.id));
        if (this.owner.get(node.id) === root && node.id !== root.id && rootKinds.has(node.kind)) this.bind(this.name(node), node);
      }
      try {
        const statements = this.declare(root, true), imports = [...this.imports.values()].map(rule => f.createImportDeclaration(undefined,
          f.createImportClause(true, undefined, f.createNamedImports([f.createImportSpecifier(false, rule.as ? f.createIdentifier(rule.name) : undefined, f.createIdentifier(rule.as ?? rule.name))])), f.createStringLiteral(rule.from!), undefined));
        const source = f.createSourceFile([...imports, ...statements], f.createToken(ts.SyntaxKind.EndOfFileToken), ts.NodeFlags.None);
        const text = (this.number ? '/** Number profile: JavaScript binary64. */\n' : '') + ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(source);
        files.push({ id: this.current.id(root.id), path: this.file, text, artifacts: this.artifacts });
      } catch (error) { if (!(error instanceof UnavailableType)) throw error; }
    }
    // Companions live beside data but must not hide a separately generated authored name.
    const declarations = new Map<string, string>();
    for (const file of files) for (const association of file.artifacts) {
      const parts = (association.locator.value as { declaration: { name: string }[] }).declaration;
      if (parts.length !== 1) continue; const name = parts[0]!.name, previous = declarations.get(name);
      if (previous && previous !== association.specId) this.problem('native-name-conflict', this.inspection.read(this.current.node(association.specId)), 'Native declaration or companion collides: ' + name);
      declarations.set(name, association.specId);
    }
    return files;
  }
}
class UnavailableType extends Error {}
