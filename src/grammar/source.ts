// Public source data contracts. IDs and ranges retain the authored source snapshot.
export interface SourceDocument {
  sourceId: string
  text: string
}
export interface SourcePosition {
  offset: number
  line: number
  column: number
}
export interface SourceRange {
  sourceId: string
  start: SourcePosition
  end: SourcePosition
}
export interface SourceNodeId {
  sourceId: string
  ordinal: number
}
export interface SourceDescription {
  sourceId: string
  roots: Array<SourceNodeId>
  nodes: Array<SourceNode>
}
export interface SourceNode {
  id: SourceNodeId
  range: SourceRange
  payload: SourcePayload
}
export type SourcePayload = NameNode | ReferenceNode | DirectiveNode | DeclarationNode | TypeNode | ExpressionNode | ImportItemNode | ParameterNode | BodyNode | ContractClauseNode | RecordEntryNode | ScenarioNode | ScenarioStepNode | ShortExampleNode | ProseExpectationNode | StatementNode | ParticipantNode | MessageNode
export type DirectiveNode = UseNode | IncludeNode | ExamplesAttachmentNode
export type DeclarationNode = ConceptNode | RecordTypeDeclarationNode | AliasTypeDeclarationNode | OpaqueTypeDeclarationNode | FieldNode | LocalDeclarationNode | ExtensionNode | DependenciesNode | PackageRequirementNode | PublicNode | ConstructionNode | CallableNode | ExamplesNode | FixtureNode | InteractionNode
export type TypeNode = NamedTypeNode | TupleTypeNode | OptionalTypeNode | UnionTypeNode | LiteralTypeNode | GroupedTypeNode
export type ExpressionNode = StringLiteralNode | NumberLiteralNode | BooleanLiteralNode | NameExpressionNode | MemberExpressionNode | CallExpressionNode | RecordExpressionNode | ListExpressionNode | UnaryExpressionNode | BinaryExpressionNode | GroupedExpressionNode
export type StatementNode = LetNode | ExpressionStatementNode
export interface NameNode {
  kind: "name"
  decoded: string
  quoted: boolean
}
export interface ReferenceNode {
  kind: "reference"
  segments: Array<SourceNodeId>
}
export interface UseNode {
  kind: "use"
  imports: Array<SourceNodeId>
  locator: SourceNodeId
}
export interface ImportItemNode {
  kind: "import-item"
  imported: SourceNodeId
  alias?: SourceNodeId
}
export interface IncludeNode {
  kind: "include"
  locator: SourceNodeId
}
export interface ExamplesAttachmentNode {
  kind: "examples-attachment"
  subject: SourceNodeId
  locator: SourceNodeId
}
export interface ConceptNode {
  kind: "concept" | "component" | "class" | "interface"
  name: SourceNodeId
  members: Array<SourceNodeId>
}
export interface RecordTypeDeclarationNode {
  kind: "record-type-declaration"
  name: SourceNodeId
  typeParameters: Array<SourceNodeId>
  fields: Array<SourceNodeId>
}
export interface AliasTypeDeclarationNode {
  kind: "alias-type-declaration"
  name: SourceNodeId
  typeParameters: Array<SourceNodeId>
  targetType: SourceNodeId
}
export interface OpaqueTypeDeclarationNode {
  kind: "opaque-type-declaration"
  name: SourceNodeId
  typeParameters: Array<SourceNodeId>
}
export interface FieldNode {
  kind: "field"
  name: SourceNodeId
  declaredType: SourceNodeId
  defaultValue?: SourceNodeId
}
export interface LocalDeclarationNode {
  kind: "local"
  declaration: SourceNodeId
}
export interface ExtensionNode {
  kind: "extend"
  target: SourceNodeId
  members: Array<SourceNodeId>
}
export interface DependenciesNode {
  kind: "depends-on"
  references: Array<SourceNodeId>
}
export interface PackageRequirementNode {
  kind: "requires-package"
  locator: SourceNodeId
  phase?: ("build" | "runtime" | "test")
}
export interface PublicNode {
  kind: "public"
  references: Array<SourceNodeId>
}
export interface ConstructionNode {
  kind: "construction"
  parameters: Array<SourceNodeId>
}
export interface CallableNode {
  kind: "capability" | "function" | "setup" | "action" | "observation" | "check"
  name: SourceNodeId
  parameters: Array<SourceNodeId>
  returnType?: SourceNodeId
  body?: SourceNodeId
}
export interface ParameterNode {
  kind: "parameter"
  name: SourceNodeId
  declaredType: SourceNodeId
  defaultValue?: SourceNodeId
}
export interface BodyNode {
  kind: "contract-body" | "helper-body" | "check-body"
  members: Array<SourceNodeId>
}
export interface ContractClauseNode {
  kind: "promises" | "requires" | "ensures"
  content: SourceNodeId
}
export interface ExamplesNode {
  kind: "examples"
  subject?: SourceNodeId
  members: Array<SourceNodeId>
}
export interface FixtureNode {
  kind: "fixture"
  name: SourceNodeId
  declaredType: SourceNodeId
  value: SourceNodeId
}
export interface LetNode {
  kind: "let"
  name: SourceNodeId
  value: SourceNodeId
}
export interface ExpressionStatementNode {
  kind: "do" | "return" | "assert"
  expression: SourceNodeId
}
export interface ScenarioNode {
  kind: "scenario"
  title: SourceNodeId
  steps: Array<SourceNodeId>
}
export interface ScenarioStepNode {
  kind: "given" | "when" | "then"
  capture?: SourceNodeId
  content: SourceNodeId
}
export interface ShortExampleNode {
  kind: "example"
  title: SourceNodeId
  actual: SourceNodeId
  expected: SourceNodeId
}
export interface ProseExpectationNode {
  kind: "prose-expectation"
  text: SourceNodeId
}
export interface InteractionNode {
  kind: "interaction"
  title: SourceNodeId
  parameters: Array<SourceNodeId>
  members: Array<SourceNodeId>
}
export interface ParticipantNode {
  kind: "participant"
  name: SourceNodeId
  declaredType: SourceNodeId
}
export interface MessageNode {
  kind: "message"
  sender: SourceNodeId
  receiver: SourceNodeId
  operation: SourceNodeId
  arguments: Array<SourceNodeId>
  capture?: SourceNodeId
}
export interface NamedTypeNode {
  kind: "named-type"
  reference: SourceNodeId
  arguments: Array<SourceNodeId>
}
export interface TupleTypeNode {
  kind: "tuple-type"
  elements: Array<SourceNodeId>
}
export interface OptionalTypeNode {
  kind: "optional-type"
  inner: SourceNodeId
}
export interface UnionTypeNode {
  kind: "union-type"
  alternatives: Array<SourceNodeId>
}
export interface LiteralTypeNode {
  kind: "literal-type"
  value: SourceNodeId
  negative: boolean
}
export interface GroupedTypeNode {
  kind: "grouped-type"
  inner: SourceNodeId
}
export interface StringLiteralNode {
  kind: "string-literal"
  value: string
}
export interface NumberLiteralNode {
  kind: "number-literal"
  token: string
}
export interface BooleanLiteralNode {
  kind: "boolean-literal"
  value: boolean
}
export interface NameExpressionNode {
  kind: "name-expression"
  reference: SourceNodeId
}
export interface MemberExpressionNode {
  kind: "member-expression"
  receiver: SourceNodeId
  member: SourceNodeId
}
export interface CallExpressionNode {
  kind: "call-expression"
  callee: SourceNodeId
  arguments: Array<SourceNodeId>
}
export interface RecordExpressionNode {
  kind: "record-expression"
  declaredType?: SourceNodeId
  entries: Array<SourceNodeId>
}
export interface RecordEntryNode {
  kind: "record-entry"
  name: SourceNodeId
  value: SourceNodeId
}
export interface ListExpressionNode {
  kind: "list-expression"
  elements: Array<SourceNodeId>
}
export interface UnaryExpressionNode {
  kind: "unary-expression"
  operator: "+" | "-" | "not"
  operatorRange: SourceRange
  operand: SourceNodeId
}
export interface BinaryExpressionNode {
  kind: "binary-expression"
  operator: "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or"
  operatorRange: SourceRange
  left: SourceNodeId
  right: SourceNodeId
}
export interface GroupedExpressionNode {
  kind: "grouped-expression"
  inner: SourceNodeId
}
export interface SyntaxDiagnostic {
  category: "unexpected-token" | "expected-token" | "unterminated-string" | "unterminated-name" | "invalid-escape" | "invalid-character"
  explanation: string
  primaryRange: SourceRange
  relatedRanges: Array<SourceRange>
}
export interface AcceptedSource {
  status: "accepted"
  grammarVersion: "candidate-0.1"
  document: SourceDocument
  description: SourceDescription
}
export interface RejectedSource {
  status: "rejected"
  grammarVersion: "candidate-0.1"
  document: SourceDocument
  diagnostics: Array<SyntaxDiagnostic>
}
export type ReadResult = AcceptedSource | RejectedSource
export interface SyntaxReader { read(source: SourceDocument): ReadResult }
