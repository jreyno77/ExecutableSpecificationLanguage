grammar Expec;

// Layout is grammatical: newlines are significant except inside collections.
// Passing a layout flag keeps comparison '<' distinct from type argument '<'.
source: BOM? NL* (topLevel NL*)* EOF;
topLevel: useDeclaration | includeDeclaration | examplesAttachment
        | conceptDeclaration | typeDeclaration | opaqueTypeDeclaration
        | functionDeclaration | extensionDeclaration | examplesDeclaration
        | interactionDeclaration;

useDeclaration: 'use' importedName (',' importedName)* 'from' STRING terminator;
importedName: qualifiedName[false] ('as' name)?;
includeDeclaration: 'include' STRING terminator;
examplesAttachment: 'examples' 'for' qualifiedName[false] 'from' STRING terminator;
conceptDeclaration: conceptKind name conceptBody terminator;
conceptKind: 'concept' | 'component' | 'class' | 'interface';
conceptBody: '{' NL* (conceptMember NL*)* '}';
conceptMember: dependencyDeclaration | packageRequirement | publicDeclaration
             | constructionDeclaration | capabilityDeclaration | localDeclaration
             | inlineExamples | interactionDeclaration;
dependencyDeclaration: 'depends' 'on' qualifiedName[false] (',' qualifiedName[false])* terminator;
packageRequirement: 'requires' 'package' STRING ('for' packagePhase)? terminator;
packagePhase: 'build' | 'runtime' | 'test';
publicDeclaration: 'public' name (',' name)* terminator;
constructionDeclaration: 'construction' parameterList terminator;
capabilityDeclaration: 'capability' name parameterList returnType? contractBody? terminator;
functionDeclaration: 'function' name parameterList returnType? contractBody? terminator;
returnType: 'returns' typeExpression[false];
parameterList: '(' NL* (parameter (NL* ',' NL* parameter)* (NL* ',')?)? NL* ')';
parameter: name NL* ':' NL* typeExpression[true] (NL* '=' NL* expression[true])?;
contractBody: '{' NL* (contractClause NL*)* '}';
contractClause: ('promises' STRING | 'requires' expression[false] | 'ensures' expression[false]) terminator;
localDeclaration: 'local' (conceptDeclaration | typeDeclaration | opaqueTypeDeclaration);
extensionDeclaration: 'extend' qualifiedName[false] conceptBody terminator;
typeDeclaration: 'type' name typeParameters? ('=' typeExpression[false] | fieldBody) terminator;
opaqueTypeDeclaration: 'opaque' 'type' name typeParameters? terminator;
typeParameters: '<' NL* name (NL* ',' NL* name)* (NL* ',')? NL* '>';
fieldBody: '{' NL* (fieldDeclaration NL*)* '}';
fieldDeclaration: name ':' typeExpression[false] ('=' expression[false])? terminator;
typeExpression[ml: boolean]: optionalType[$ml] (gap[$ml] '|' gap[$ml] optionalType[$ml])*;
optionalType[ml: boolean]: primaryType[$ml] (gap[$ml] '?')?;
primaryType[ml: boolean]: namedType[$ml] | tupleType | typeLiteral[$ml]
                       | '(' NL* typeExpression[true] NL* ')';
namedType[ml: boolean]: qualifiedName[$ml] (gap[$ml] typeArguments)?;
typeArguments: '<' NL* typeExpression[true] (NL* ',' NL* typeExpression[true])* (NL* ',')? NL* '>';
tupleType: '[' NL* typeExpression[true] (NL* ',' NL* typeExpression[true])* (NL* ',')? NL* ']';
typeLiteral[ml: boolean]: STRING | ('-' gap[$ml])? NUMBER | booleanLiteral;

examplesDeclaration: 'examples' ('for' qualifiedName[false])? examplesBody terminator;
inlineExamples: 'examples' examplesBody terminator;
examplesBody: '{' NL* (exampleMember NL*)* '}';
exampleMember: fixtureDeclaration | helperDeclaration | checkDeclaration | scenarioDeclaration | shortExample;
fixtureDeclaration: 'fixture' name ':' typeExpression[false] '=' expression[false] terminator;
helperDeclaration: helperKind name parameterList returnType? helperBody? terminator;
helperKind: 'setup' | 'action' | 'observation';
helperBody: '{' NL* (helperStatement NL*)* '}';
helperStatement: letStatement | doStatement | returnStatement;
letStatement: 'let' name '=' expression[false] terminator;
doStatement: 'do' callExpression[false] terminator;
returnStatement: 'return' expression[false] terminator;
checkDeclaration: 'check' name parameterList checkBody? terminator;
checkBody: '{' NL* (checkStatement NL*)* '}';
checkStatement: helperStatement | assertStatement;
assertStatement: 'assert' expression[false] terminator;
scenarioDeclaration: 'scenario' STRING scenarioBody terminator;
scenarioBody: '{' NL* (givenStep NL*)* (whenStep NL*)+ (thenStep NL*)+ '}';
givenStep: 'given' (name '=')? callExpression[false] terminator;
whenStep: 'when' (name '=')? callExpression[false] terminator;
thenStep: 'then' (expression[false] | proseExpectation) terminator;
shortExample: 'example' STRING ':' expression[false] '=>' (expression[false] | proseExpectation) terminator;
proseExpectation: 'satisfies' STRING;

interactionDeclaration: 'interaction' STRING parameterList interactionBody terminator;
interactionBody: '{' NL* (interactionMember NL*)* '}';
interactionMember: participantDeclaration | messageDeclaration;
participantDeclaration: 'participant' name ':' typeExpression[false] terminator;
messageDeclaration: 'message' qualifiedName[false] '->' qualifiedName[false] '.' name arguments ('as' name)? terminator;

expression[ml: boolean]: orExpression[$ml];
orExpression[ml: boolean]: andExpression[$ml] (gap[$ml] 'or' gap[$ml] andExpression[$ml])*;
andExpression[ml: boolean]: comparisonExpression[$ml] (gap[$ml] 'and' gap[$ml] comparisonExpression[$ml])*;
comparisonExpression[ml: boolean]: additiveExpression[$ml] (gap[$ml] comparisonOperator gap[$ml] additiveExpression[$ml])?;
comparisonOperator: '==' | '!=' | '<' | '<=' | '>' | '>=';
additiveExpression[ml: boolean]: multiplicativeExpression[$ml] (gap[$ml] ('+' | '-') gap[$ml] multiplicativeExpression[$ml])*;
multiplicativeExpression[ml: boolean]: unaryExpression[$ml] (gap[$ml] ('*' | '/' | '%') gap[$ml] unaryExpression[$ml])*;
unaryExpression[ml: boolean]: ('+' | '-' | 'not') gap[$ml] unaryExpression[$ml] | postfixExpression[$ml];
postfixExpression[ml: boolean]: primaryExpression[$ml] (gap[$ml] (memberSuffix[$ml] | callSuffix))*;
memberSuffix[ml: boolean]: '.' gap[$ml] name;
callSuffix: arguments;
callExpression[ml: boolean]: primaryExpression[$ml] (gap[$ml] (memberSuffix[$ml] | callSuffix))* gap[$ml] callSuffix;
arguments: '(' NL* (expression[true] (NL* ',' NL* expression[true])* (NL* ',')?)? NL* ')';
primaryExpression[ml: boolean]: NUMBER | STRING | booleanLiteral | recordExpression[$ml] | name
                             | listExpression | '(' NL* expression[true] NL* ')';
booleanLiteral: 'true' | 'false';
listExpression: '[' NL* (expression[true] (NL* ',' NL* expression[true])* (NL* ',')?)? NL* ']';
recordExpression[ml: boolean]: (namedType[$ml] gap[$ml])? '{' NL* (recordEntry (NL* ',' NL* recordEntry)* (NL* ',')?)? NL* '}';
recordEntry: name NL* ':' NL* expression[true];
qualifiedName[ml: boolean]: name (gap[$ml] '.' gap[$ml] name)*;
name: IDENTIFIER | QUOTED_IDENTIFIER;
gap[ml: boolean]: {$ml}? NL* | ;
terminator: NL | {this.tokenStream.LT(1)?.text === "}" || this.tokenStream.LA(1) === -1}?;

// String escape validation is done by the reader before adaptation. Keeping a
// complete token gives malformed escapes their original, useful source ranges.
STRING: '"' ('\\' ~[\r\n] | ~["\\\r\n])* '"';
QUOTED_IDENTIFIER: '`' ('\\' ~[\r\n] | ~[`\\\r\n])* '`';
UNTERMINATED_STRING: '"' ('\\' ~[\r\n] | ~["\\\r\n])*;
UNTERMINATED_NAME: '`' ('\\' ~[\r\n] | ~[`\\\r\n])*;
NUMBER: [0-9]+ ('.' [0-9]+)? ([eE] [+-]? [0-9]+)?;
IDENTIFIER: [A-Za-z_] [A-Za-z_0-9]*;
NL: '\r'? '\n';
BOM: '\uFEFF';
COMMENT: '//' ~[\r\n]* -> channel(HIDDEN);
WS: [ \t]+ -> channel(HIDDEN);
INVALID_CHARACTER: .;
