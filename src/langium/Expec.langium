grammar Expec

// Statement boundaries belong to their containing list. A final newline before
// a closing brace or the end of the document is optional, but siblings need one.
entry Source:
    BOM? NL* (roots+=TopLevel (NL+ roots+=TopLevel)* NL*)?;
TopLevel:
    Use | Include | ExamplesAttachment | Concept | TypeDeclaration
    | OpaqueTypeDeclaration | Function | Extend | Examples | Interaction;
Use: 'use' imports+=ImportItem (',' imports+=ImportItem)* 'from' locator=StringLiteral;
ImportItem: imported=Reference<false> ('as' alias=Name)?;
Include: 'include' locator=StringLiteral;
ExamplesAttachment: 'examples' 'for' subject=Reference<false> 'from' locator=StringLiteral;
Concept: kind=('concept' | 'component' | 'class' | 'interface') name=Name ConceptBody;
fragment ConceptBody:
    '{' NL* (members+=ConceptMember (NL+ members+=ConceptMember)* NL*)? '}';
ConceptMember:
    DependsOn | RequiresPackage | Public | Construction | Capability | Local | InlineExamples | Interaction;
DependsOn: 'depends' 'on' references+=Reference<false> (',' references+=Reference<false>)*;
RequiresPackage: 'requires' 'package' locator=StringLiteral ('for' phase=('build' | 'runtime' | 'test'))?;
Public: 'public' references+=SingleReference (',' references+=SingleReference)*;
Construction: 'construction' Parameters;
Capability infers Callable: kind='capability' name=Name Parameters ('returns' returnType=TypeExpression<false>)? body=ContractBody?;
Function infers Callable: kind='function' name=Name Parameters ('returns' returnType=TypeExpression<false>)? body=ContractBody?;
fragment Parameters:
    '(' NL* (parameters+=Parameter (NL* ',' NL* parameters+=Parameter)* (NL* ',')? NL*)? ')';
Parameter: name=Name NL* ':' NL* declaredType=TypeExpression<true> (NL* '=' NL* defaultValue=Expression<true>)?;
ContractBody: '{' NL* (members+=ContractClause (NL+ members+=ContractClause)* NL*)? '}';
ContractClause: Promises | Requires | Ensures;
Promises: 'promises' content=StringLiteral;
Requires: 'requires' content=Expression<false>;
Ensures: 'ensures' content=Expression<false>;
Local: 'local' declaration=(Concept | TypeDeclaration | OpaqueTypeDeclaration);
Extend: 'extend' target=Reference<false> ConceptBody;
TypeDeclaration: RecordTypeDeclaration | AliasTypeDeclaration;
RecordTypeDeclaration: 'type' name=Name TypeParameters? '{' NL* (fields+=Field (NL+ fields+=Field)* NL*)? '}';
AliasTypeDeclaration: 'type' name=Name TypeParameters? '=' targetType=TypeExpression<false>;
OpaqueTypeDeclaration: 'opaque' 'type' name=Name TypeParameters?;
fragment TypeParameters:
    '<' NL* typeParameters+=TypeParameter (NL* ',' NL* typeParameters+=TypeParameter)* (NL* ',')? NL* '>';
TypeParameter: name=Name;
Field: name=Name ':' declaredType=TypeExpression<false> ('=' defaultValue=Expression<false>)?;

TypeExpression<ml>:
    MaybeOptionalType<ml> ((<ml> NL+)? {infer UnionType.alternatives+=current} '|' (<ml> NL+)? alternatives+=MaybeOptionalType<ml>
    ((<ml> NL+)? '|' (<ml> NL+)? alternatives+=MaybeOptionalType<ml>)*)?;
MaybeOptionalType<ml>: PrimaryType<ml> ((<ml> NL+)? {infer OptionalType.inner=current} '?')?;
PrimaryType<ml>: NamedType<ml> | TupleType | LiteralType<ml> | GroupedType;
NamedType<ml>: reference=Reference<ml> ((<ml> NL+)? TypeArguments)?;
fragment TypeArguments: '<' NL* arguments+=TypeExpression<true> (NL* ',' NL* arguments+=TypeExpression<true>)* (NL* ',')? NL* '>';
TupleType: '[' NL* elements+=TypeExpression<true> (NL* ',' NL* elements+=TypeExpression<true>)* (NL* ',')? NL* ']';
LiteralType<ml>: value=StringLiteral | (negative?='-' (<ml> NL+)?)? value=NumberLiteral | value=BooleanLiteral;
GroupedType: '(' NL* inner=TypeExpression<true> NL* ')';

Examples: 'examples' ('for' subject=Reference<false>)? ExamplesBody;
InlineExamples infers Examples: 'examples' ExamplesBody;
fragment ExamplesBody: '{' NL* (members+=ExampleMember (NL+ members+=ExampleMember)* NL*)? '}';
ExampleMember: Fixture | Helper | Check | Scenario | Example;
Fixture: 'fixture' name=Name ':' declaredType=TypeExpression<false> '=' value=Expression<false>;
Helper infers Callable: kind=('setup' | 'action' | 'observation') name=Name Parameters ('returns' returnType=TypeExpression<false>)? body=HelperBody?;
HelperBody: '{' NL* (members+=HelperStatement (NL+ members+=HelperStatement)* NL*)? '}';
HelperStatement: Let | Do | Return;
Let: 'let' name=Name '=' value=Expression<false>;
Do: 'do' expression=PostfixExpression<false>;
Return: 'return' expression=Expression<false>;
Check infers Callable: kind='check' name=Name Parameters body=CheckBody?;
CheckBody: '{' NL* (members+=CheckStatement (NL+ members+=CheckStatement)* NL*)? '}';
CheckStatement: HelperStatement | Assert;
Assert: 'assert' expression=Expression<false>;
Scenario: 'scenario' title=StringLiteral '{' NL*
    (steps+=Given NL+)* steps+=When (NL+ steps+=When)* NL+ steps+=Then (NL+ steps+=Then)* NL* '}';
Given: 'given' (capture=Name '=')? content=PostfixExpression<false>;
When: 'when' (capture=Name '=')? content=PostfixExpression<false>;
Then: 'then' content=(Expression<false> | ProseExpectation);
Example: 'example' title=StringLiteral ':' actual=Expression<false> '=>' expected=(Expression<false> | ProseExpectation);
ProseExpectation: 'satisfies' text=StringLiteral;

Interaction: 'interaction' title=StringLiteral Parameters '{' NL* (members+=InteractionMember (NL+ members+=InteractionMember)* NL*)? '}';
InteractionMember: Participant | Message;
Participant: 'participant' name=Name ':' declaredType=TypeExpression<false>;
interface Message {
    sender: Reference; receiver: Reference; operation: Reference; arguments: Expression[]; capture?: Name;
}
Message returns Message: 'message' sender=Reference<false> '->' receiver=MessageReceiver operation=SingleReference Arguments ('as' capture=Name)?;

MessageReceiver infers Reference: segments+=Name '.' (segments+=Name '.')*;

Expression<ml>: OrExpression<ml>;
OrExpression<ml>: AndExpression<ml> ((<ml> NL+)? {infer BinaryExpression.left=current} operator='or' (<ml> NL+)? right=AndExpression<ml>)*;
AndExpression<ml>: ComparisonExpression<ml> ((<ml> NL+)? {infer BinaryExpression.left=current} operator='and' (<ml> NL+)? right=ComparisonExpression<ml>)*;
ComparisonExpression<ml>: AdditiveExpression<ml> ((<ml> NL+)? {infer BinaryExpression.left=current} operator=('=='|'!='|'<'|'<='|'>'|'>=') (<ml> NL+)? right=AdditiveExpression<ml>)?;
AdditiveExpression<ml>: MultiplicativeExpression<ml> ((<ml> NL+)? {infer BinaryExpression.left=current} operator=('+'|'-') (<ml> NL+)? right=MultiplicativeExpression<ml>)*;
MultiplicativeExpression<ml>: PrefixExpression<ml> ((<ml> NL+)? {infer BinaryExpression.left=current} operator=('*'|'/'|'%') (<ml> NL+)? right=PrefixExpression<ml>)*;
PrefixExpression<ml>: {infer UnaryExpression} operator=('+'|'-'|'not') (<ml> NL+)? operand=PrefixExpression<ml> | PostfixExpression<ml>;
PostfixExpression<ml>: PrimaryExpression<ml> ((<ml> NL+)?
    ({infer MemberExpression.receiver=current} '.' (<ml> NL+)? member=SingleReference
    | {infer CallExpression.callee=current} Arguments))*;
fragment Arguments: '(' NL* (arguments+=Expression<true> (NL* ',' NL* arguments+=Expression<true>)* (NL* ',')? NL*)? ')';
PrimaryExpression<ml>: NumberLiteral | StringLiteral | BooleanLiteral | RecordExpression<ml> | NameExpression | ListExpression | GroupedExpression;
NameExpression: reference=SingleReference;
RecordExpression<ml>: (declaredType=NamedType<ml> (<ml> NL+)?)? '{' NL* (entries+=RecordEntry (NL* ',' NL* entries+=RecordEntry)* (NL* ',')? NL*)? '}';
RecordEntry: name=Name NL* ':' NL* value=Expression<true>;
ListExpression: '[' NL* (elements+=Expression<true> (NL* ',' NL* elements+=Expression<true>)* (NL* ',')? NL*)? ']';
GroupedExpression: '(' NL* inner=Expression<true> NL* ')';
Reference<ml>: segments+=Name ((<ml> NL+)? '.' (<ml> NL+)? segments+=Name)*;
SingleReference infers Reference: segments+=Name;
interface Name { decoded: string; quoted: boolean; }
Name returns Name: decoded=(ID | QUOTED_NAME);
StringLiteral: value=STRING;
NumberLiteral: token=NUMBER;
BooleanLiteral: value?='true' | 'false';

terminal STRING: /"(\\[^\r\n]|[^"\\\r\n])*"/;
terminal QUOTED_NAME: /`(\\[^\r\n]|[^`\\\r\n])*`/;
terminal NUMBER: /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/;
terminal ID: /[A-Za-z_][A-Za-z_0-9]*/;
terminal NL: /\r?\n/;
terminal BOM: /\uFEFF/;
hidden terminal COMMENT: /\/\/[^\r\n]*/;
hidden terminal WS: /[ \t]+/;
