import {
  BaseErrorListener, CharStream, CommonTokenStream, ParserRuleContext, TerminalNode, Token,
  type ATNSimulator, type RecognitionException, type Recognizer,
} from 'antlr4ng';
import { ExpecLexer } from './generated/ExpecLexer.js';
import { ExpecParser } from './generated/ExpecParser.js';
import type {
  ReadResult, SourceDescription, SourceDocument, SourceNode, SourceNodeId,
  SourcePayload, SourcePosition, SourceRange, SyntaxDiagnostic, SyntaxReader,
} from '../model/source.js';

const grammarVersion = 'candidate-0.1' as const;

/** No source discovery, name resolution, execution, or project writes happen here. */
export class AntlrSyntaxReader implements SyntaxReader {
  read(document: SourceDocument): ReadResult {
    const coordinates = new Coordinates(document);
    const diagnostics: SyntaxDiagnostic[] = [];
    const lexer = new ExpecLexer(CharStream.fromString(document.text));
    lexer.removeErrorListeners();
    lexer.addErrorListener(new SyntaxErrors(coordinates, diagnostics));
    const tokens = new CommonTokenStream(lexer);
    tokens.fill();
    validateLexicalTokens(tokens.getTokens(), coordinates, diagnostics);
    if (diagnostics.length > 0) return { status: 'rejected', grammarVersion, document, diagnostics };

    const parser = new ExpecParser(tokens);
    parser.removeErrorListeners();
    parser.addErrorListener(new SyntaxErrors(coordinates, diagnostics, tokens.getTokens()));
    const tree = parser.source();
    if (diagnostics.length > 0) return { status: 'rejected', grammarVersion, document, diagnostics };
    const description = new SourceAdapter(coordinates, tokens).adapt(tree);
    return { status: 'accepted', grammarVersion, document, description };
  }
}

class Coordinates {
  readonly scalars: string[];
  readonly positions: SourcePosition[] = [];
  constructor(readonly document: SourceDocument) {
    this.scalars = Array.from(document.text);
    let line = 1;
    let column = 1;
    for (let offset = 0; offset <= this.scalars.length; offset++) {
      this.positions.push({ offset, line, column });
      if (this.scalars[offset] === '\n') { line++; column = 1; }
      else column++;
    }
  }
  range(start: number, end: number): SourceRange {
    const safeStart = Math.max(0, Math.min(start, this.scalars.length));
    const safeEnd = Math.max(safeStart, Math.min(end, this.scalars.length));
    return { sourceId: this.document.sourceId, start: { ...this.positions[safeStart]! }, end: { ...this.positions[safeEnd]! } };
  }
  token(token: Token): SourceRange {
    return this.range(token.start, token.type === Token.EOF ? token.start : token.stop + 1);
  }
}

class SyntaxErrors extends BaseErrorListener {
  constructor(
    private readonly coordinates: Coordinates,
    private readonly diagnostics: SyntaxDiagnostic[],
    private readonly tokens: Token[] = [],
  ) { super(); }

  override syntaxError<S extends Token, T extends ATNSimulator>(
    _recognizer: Recognizer<T>, offending: S | null, _line: number, _column: number,
    explanation: string, _exception: RecognitionException | null,
  ): void {
    const primaryRange = offending ? this.coordinates.token(offending) : this.coordinates.range(0, 0);
    const relatedRanges: SourceRange[] = [];
    if (offending?.type === Token.EOF) {
      const open: Token[] = [];
      for (const token of this.tokens) {
        if (token.channel !== Token.DEFAULT_CHANNEL) continue;
        if (['{', '(', '['].includes(token.text ?? '')) open.push(token);
        else if (['}', ')', ']'].includes(token.text ?? '')) open.pop();
      }
      if (open.length) relatedRanges.push(this.coordinates.token(open.at(-1)!));
    }
    this.diagnostics.push({
      category: explanation.startsWith('missing ') ? 'expected-token' : 'unexpected-token',
      explanation, primaryRange, relatedRanges,
    });
  }
}

function validateLexicalTokens(tokens: Token[], coordinates: Coordinates, diagnostics: SyntaxDiagnostic[]): void {
  const report = (token: Token, category: SyntaxDiagnostic['category'], explanation: string) => {
    diagnostics.push({ category, explanation, primaryRange: coordinates.token(token), relatedRanges: [] });
  };
  for (const token of tokens) {
    switch (token.type) {
      case ExpecLexer.UNTERMINATED_STRING:
        report(token, 'unterminated-string', 'A double-quoted string must end before the line ends.'); break;
      case ExpecLexer.UNTERMINATED_NAME:
        report(token, 'unterminated-name', 'A quoted name must end before the line ends.'); break;
      case ExpecLexer.INVALID_CHARACTER:
        report(token, 'invalid-character', 'This character is not part of the candidate language.'); break;
      case ExpecLexer.STRING:
      case ExpecLexer.QUOTED_IDENTIFIER: {
        const text = token.text!;
        const quotedName = token.type === ExpecLexer.QUOTED_IDENTIFIER;
        const content = text.slice(1, -1);
        if (quotedName && content.length === 0) {
          report(token, 'invalid-character', 'A quoted name cannot be empty.'); break;
        }
        if (/[\u0000-\u001f\u007f-\u009f]/u.test(content)) {
          report(token, 'invalid-character', 'Raw control characters are forbidden in strings and quoted names.'); break;
        }
        const allowedEscape = quotedName ? /\\[`\\]/gu : /\\(?:["\\nrt]|u[0-9a-fA-F]{4})/gu;
        if (content.replace(allowedEscape, '').includes('\\')) {
          report(token, 'invalid-escape', 'The escape is not supported by this literal form.'); break;
        }
        const decoded = quotedName ? decodeName(text) : JSON.parse(text) as string;
        if (hasUnpairedSurrogate(decoded)) report(token, 'invalid-escape', 'Unicode surrogate escapes must form a valid pair.');
        break;
      }
    }
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return true;
  }
  return false;
}
function decodeName(text: string): string {
  return text.startsWith('`') ? text.slice(1, -1).replace(/\\([`\\])/gu, '$1') : text;
}

// Temporary trees are private adapter data. The public result is a flat,
// ordered forest with concrete SourcePayload variants and snapshot-local IDs.
interface Draft {
  range: SourceRange;
  payload: Record<string, unknown> & { kind: SourcePayload['kind'] };
}
function isDraft(value: unknown): value is Draft {
  return typeof value === 'object' && value !== null && 'payload' in value && 'range' in value;
}

class SourceAdapter {
  constructor(private readonly coordinates: Coordinates, private readonly tokens: CommonTokenStream) {}

  adapt(tree: ParserRuleContext): SourceDescription {
    const roots = this.children(tree, 'topLevel').map(child => this.build(child));
    const nodes: SourceNode[] = [];
    const visit = (draft: Draft): SourceNodeId => {
      const id = { sourceId: this.coordinates.document.sourceId, ordinal: nodes.length };
      const node = { id, range: draft.range, payload: {} as SourcePayload };
      nodes.push(node);
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft.payload)) {
        payload[key] = isDraft(value) ? visit(value)
          : Array.isArray(value) ? value.map(item => isDraft(item) ? visit(item) : item) : value;
      }
      node.payload = payload as unknown as SourcePayload;
      return id;
    };
    return { sourceId: this.coordinates.document.sourceId, roots: roots.map(visit), nodes };
  }

  private rule(context: ParserRuleContext): string { return ExpecParser.ruleNames[context.ruleIndex]!; }
  private children(context: ParserRuleContext, rule?: string): ParserRuleContext[] {
    return context.children.filter((child): child is ParserRuleContext => child instanceof ParserRuleContext)
      .filter(child => rule === undefined || this.rule(child) === rule);
  }
  private child(context: ParserRuleContext, rule: string): ParserRuleContext {
    const child = this.children(context, rule)[0];
    if (!child) throw new Error(`Source adapter expected ${rule} in ${this.rule(context)}`);
    return child;
  }
  private maybe(context: ParserRuleContext, rule: string): Draft | undefined {
    const child = this.children(context, rule)[0];
    return child ? this.build(child) : undefined;
  }
  private many(context: ParserRuleContext, rule: string): Draft[] { return this.children(context, rule).map(child => this.build(child)); }
  private terminals(context: ParserRuleContext): Token[] {
    return context.children.filter((child): child is TerminalNode => child instanceof TerminalNode).map(child => child.symbol);
  }
  private token(context: ParserRuleContext, type: number): Token {
    const token = this.terminals(context).find(token => token.type === type);
    if (!token) throw new Error(`Source adapter expected token ${type} in ${this.rule(context)}`);
    return token;
  }
  private range(context: ParserRuleContext): SourceRange {
    const meaningful = this.tokens.getTokens(context.start!.tokenIndex, context.stop!.tokenIndex)
      .filter(token => token.channel === Token.DEFAULT_CHANNEL && ![ExpecLexer.NL, ExpecLexer.BOM, Token.EOF].includes(token.type));
    if (!meaningful.length) return this.coordinates.range(context.start!.start, context.start!.start);
    return this.coordinates.range(meaningful[0]!.start, meaningful.at(-1)!.stop + 1);
  }
  private make(context: ParserRuleContext | SourceRange, kind: SourcePayload['kind'], fields: Record<string, unknown> = {}): Draft {
    const payload: Draft['payload'] = { kind };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) payload[key] = value;
    return { range: context instanceof ParserRuleContext ? this.range(context) : context, payload };
  }
  private literal(token: Token): Draft {
    const range = this.coordinates.token(token);
    if (token.type === ExpecLexer.STRING) return this.make(range, 'string-literal', { value: JSON.parse(token.text!) as string });
    if (token.type === ExpecLexer.NUMBER) return this.make(range, 'number-literal', { token: token.text! });
    return this.make(range, 'boolean-literal', { value: token.text === 'true' });
  }
  private reference(name: Draft): Draft { return this.make(name.range, 'reference', { segments: [name] }); }
  private unionRange(left: Draft, right: Draft): SourceRange {
    return { sourceId: left.range.sourceId, start: left.range.start, end: right.range.end };
  }
  private parameters(context: ParserRuleContext): Draft[] { return this.many(this.child(context, 'parameterList'), 'parameter'); }
  private members(context: ParserRuleContext, body: string, member: string): Draft[] { return this.many(this.child(context, body), member); }

  private build(context: ParserRuleContext): Draft {
    const rule = this.rule(context);
    switch (rule) {
      case 'topLevel': case 'conceptMember': case 'exampleMember': case 'interactionMember':
      case 'helperStatement': case 'checkStatement': case 'expression': case 'returnType':
        return this.build(this.children(context)[0]!);
      case 'name': {
        const text = context.getText();
        return this.make(context, 'name', { decoded: decodeName(text), quoted: text.startsWith('`') });
      }
      case 'qualifiedName': return this.make(context, 'reference', { segments: this.many(context, 'name') });
      case 'useDeclaration': return this.make(context, 'use', { imports: this.many(context, 'importedName'), locator: this.literal(this.token(context, ExpecLexer.STRING)) });
      case 'importedName': return this.make(context, 'import-item', { imported: this.build(this.child(context, 'qualifiedName')), alias: this.maybe(context, 'name') });
      case 'includeDeclaration': return this.make(context, 'include', { locator: this.literal(this.token(context, ExpecLexer.STRING)) });
      case 'examplesAttachment': return this.make(context, 'examples-attachment', { subject: this.build(this.child(context, 'qualifiedName')), locator: this.literal(this.token(context, ExpecLexer.STRING)) });
      case 'conceptDeclaration': return this.make(context, this.child(context, 'conceptKind').getText() as 'concept' | 'component' | 'class' | 'interface', { name: this.build(this.child(context, 'name')), members: this.members(context, 'conceptBody', 'conceptMember') });
      case 'dependencyDeclaration': return this.make(context, 'depends-on', { references: this.many(context, 'qualifiedName') });
      case 'packageRequirement': return this.make(context, 'requires-package', { locator: this.literal(this.token(context, ExpecLexer.STRING)), phase: this.children(context, 'packagePhase')[0]?.getText() });
      case 'publicDeclaration': return this.make(context, 'public', { references: this.many(context, 'name').map(name => this.reference(name)) });
      case 'constructionDeclaration': return this.make(context, 'construction', { parameters: this.parameters(context) });
      case 'capabilityDeclaration': case 'functionDeclaration': case 'helperDeclaration': case 'checkDeclaration': {
        const kind = rule === 'helperDeclaration' ? this.child(context, 'helperKind').getText() : rule.replace('Declaration', '');
        return this.make(context, kind as 'capability' | 'function' | 'setup' | 'action' | 'observation' | 'check', {
          name: this.build(this.child(context, 'name')), parameters: this.parameters(context),
          returnType: this.maybe(context, 'returnType'),
          body: this.maybe(context, 'contractBody') ?? this.maybe(context, 'helperBody') ?? this.maybe(context, 'checkBody'),
        });
      }
      case 'parameter': case 'fieldDeclaration': return this.make(context, rule === 'parameter' ? 'parameter' : 'field', {
        name: this.build(this.child(context, 'name')), declaredType: this.build(this.child(context, 'typeExpression')), defaultValue: this.maybe(context, 'expression'),
      });
      case 'contractBody': return this.make(context, 'contract-body', { members: this.many(context, 'contractClause') });
      case 'helperBody': return this.make(context, 'helper-body', { members: this.many(context, 'helperStatement') });
      case 'checkBody': return this.make(context, 'check-body', { members: this.many(context, 'checkStatement') });
      case 'contractClause': return this.make(context, context.start!.text as 'promises' | 'requires' | 'ensures', {
        content: this.maybe(context, 'expression') ?? this.literal(this.token(context, ExpecLexer.STRING)),
      });
      case 'localDeclaration': return this.make(context, 'local', { declaration: this.build(this.children(context)[0]!) });
      case 'extensionDeclaration': return this.make(context, 'extend', { target: this.build(this.child(context, 'qualifiedName')), members: this.members(context, 'conceptBody', 'conceptMember') });
      case 'typeDeclaration': case 'opaqueTypeDeclaration': {
        const name = this.build(this.child(context, 'name'));
        const parameters = this.children(context, 'typeParameters')[0];
        const typeParameters = parameters ? this.many(parameters, 'name') : [];
        if (rule === 'opaqueTypeDeclaration') return this.make(context, 'opaque-type-declaration', { name, typeParameters });
        const targetType = this.maybe(context, 'typeExpression');
        return targetType ? this.make(context, 'alias-type-declaration', { name, typeParameters, targetType })
          : this.make(context, 'record-type-declaration', { name, typeParameters, fields: this.members(context, 'fieldBody', 'fieldDeclaration') });
      }
      case 'typeExpression': {
        const alternatives = this.many(context, 'optionalType');
        return alternatives.length === 1 ? alternatives[0]! : this.make(context, 'union-type', { alternatives });
      }
      case 'optionalType': {
        const inner = this.build(this.child(context, 'primaryType'));
        return this.terminals(context).some(token => token.text === '?') ? this.make(context, 'optional-type', { inner }) : inner;
      }
      case 'primaryType': {
        const inner = this.children(context).find(child => this.rule(child) !== 'gap')!;
        return this.rule(inner) === 'typeExpression' ? this.make(context, 'grouped-type', { inner: this.build(inner) }) : this.build(inner);
      }
      case 'namedType': {
        const args = this.children(context, 'typeArguments')[0];
        return this.make(context, 'named-type', { reference: this.build(this.child(context, 'qualifiedName')), arguments: args ? this.many(args, 'typeExpression') : [] });
      }
      case 'tupleType': return this.make(context, 'tuple-type', { elements: this.many(context, 'typeExpression') });
      case 'typeLiteral': return this.make(context, 'literal-type', {
        value: this.children(context, 'booleanLiteral')[0] ? this.build(this.child(context, 'booleanLiteral'))
          : this.literal(this.terminals(context).find(token => [ExpecLexer.STRING, ExpecLexer.NUMBER].includes(token.type))!),
        negative: this.terminals(context).some(token => token.text === '-'),
      });
      case 'examplesDeclaration': case 'inlineExamples': return this.make(context, 'examples', { subject: this.maybe(context, 'qualifiedName'), members: this.members(context, 'examplesBody', 'exampleMember') });
      case 'fixtureDeclaration': return this.make(context, 'fixture', { name: this.build(this.child(context, 'name')), declaredType: this.build(this.child(context, 'typeExpression')), value: this.build(this.child(context, 'expression')) });
      case 'letStatement': return this.make(context, 'let', { name: this.build(this.child(context, 'name')), value: this.build(this.child(context, 'expression')) });
      case 'doStatement': case 'returnStatement': case 'assertStatement': return this.make(context, rule.replace('Statement', '') as 'do' | 'return' | 'assert', { expression: this.build(this.child(context, rule === 'doStatement' ? 'callExpression' : 'expression')) });
      case 'scenarioDeclaration': return this.make(context, 'scenario', { title: this.literal(this.token(context, ExpecLexer.STRING)), steps: this.children(this.child(context, 'scenarioBody')).map(child => this.build(child)) });
      case 'givenStep': case 'whenStep': case 'thenStep': return this.make(context, rule.replace('Step', '') as 'given' | 'when' | 'then', {
        capture: this.maybe(context, 'name'), content: this.maybe(context, 'callExpression') ?? this.maybe(context, 'expression') ?? this.build(this.child(context, 'proseExpectation')),
      });
      case 'shortExample': {
        const expressions = this.many(context, 'expression');
        return this.make(context, 'example', { title: this.literal(this.token(context, ExpecLexer.STRING)), actual: expressions[0]!, expected: expressions[1] ?? this.build(this.child(context, 'proseExpectation')) });
      }
      case 'proseExpectation': return this.make(context, 'prose-expectation', { text: this.literal(this.token(context, ExpecLexer.STRING)) });
      case 'interactionDeclaration': return this.make(context, 'interaction', { title: this.literal(this.token(context, ExpecLexer.STRING)), parameters: this.parameters(context), members: this.members(context, 'interactionBody', 'interactionMember') });
      case 'participantDeclaration': return this.make(context, 'participant', { name: this.build(this.child(context, 'name')), declaredType: this.build(this.child(context, 'typeExpression')) });
      case 'messageDeclaration': {
        const references = this.many(context, 'qualifiedName');
        const names = this.many(context, 'name');
        return this.make(context, 'message', { sender: references[0]!, receiver: references[1]!, operation: this.reference(names[0]!), arguments: this.many(this.child(context, 'arguments'), 'expression'), capture: names[1] });
      }
      case 'orExpression': case 'andExpression': case 'comparisonExpression': case 'additiveExpression': case 'multiplicativeExpression':
        return this.binary(context);
      case 'unaryExpression': {
        const unary = this.children(context, 'unaryExpression')[0];
        if (!unary) return this.build(this.child(context, 'postfixExpression'));
        const operator = this.terminals(context)[0]!;
        return this.make(context, 'unary-expression', { operator: operator.text!, operatorRange: this.coordinates.token(operator), operand: this.build(unary) });
      }
      case 'postfixExpression': case 'callExpression': {
        let receiver = this.build(this.child(context, 'primaryExpression'));
        for (const suffix of this.children(context).filter(child => ['memberSuffix', 'callSuffix'].includes(this.rule(child)))) {
          const range = { sourceId: receiver.range.sourceId, start: receiver.range.start, end: this.range(suffix).end };
          if (this.rule(suffix) === 'memberSuffix') receiver = this.make(range, 'member-expression', { receiver, member: this.reference(this.build(this.child(suffix, 'name'))) });
          else receiver = this.make(range, 'call-expression', { callee: receiver, arguments: this.many(this.child(suffix, 'arguments'), 'expression') });
        }
        return receiver;
      }
      case 'primaryExpression': {
        const child = this.children(context).find(child => this.rule(child) !== 'gap');
        if (!child) return this.literal(this.terminals(context)[0]!);
        if (this.rule(child) === 'expression') return this.make(context, 'grouped-expression', { inner: this.build(child) });
        if (this.rule(child) === 'name') return this.make(context, 'name-expression', { reference: this.reference(this.build(child)) });
        return this.build(child);
      }
      case 'booleanLiteral': return this.literal(this.terminals(context)[0]!);
      case 'listExpression': return this.make(context, 'list-expression', { elements: this.many(context, 'expression') });
      case 'recordExpression': return this.make(context, 'record-expression', { declaredType: this.maybe(context, 'namedType'), entries: this.many(context, 'recordEntry') });
      case 'recordEntry': return this.make(context, 'record-entry', { name: this.build(this.child(context, 'name')), value: this.build(this.child(context, 'expression')) });
      default: throw new Error(`Source adapter does not implement grammar rule ${rule}`);
    }
  }

  private binary(context: ParserRuleContext): Draft {
    const operands = this.children(context).filter(child => !['gap', 'comparisonOperator'].includes(this.rule(child)));
    let left = this.build(operands[0]!);
    const operators: Token[] = [];
    for (const child of context.children) {
      if (child instanceof TerminalNode) operators.push(child.symbol);
      else if (child instanceof ParserRuleContext && this.rule(child) === 'comparisonOperator') operators.push(child.start!);
    }
    for (let index = 1; index < operands.length; index++) {
      const right = this.build(operands[index]!);
      const operator = operators[index - 1]!;
      left = this.make(this.unionRange(left, right), 'binary-expression', { operator: operator.text!, operatorRange: this.coordinates.token(operator), left, right });
    }
    return left;
  }
}
