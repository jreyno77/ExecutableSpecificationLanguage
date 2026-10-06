import {describe,it} from 'vitest';
import {FailureExamples} from '../../dsl/compiler/domain-failures.js';

describe('declared domain failures', () => {
  it('describes an account error beside an unchanged successful result', () => {
    const language = new FailureExamples();
    language.source(`type Account { id: Text }
error type AccountError {
  code: "duplicate-account" | "invalid-account"
  email: Text
  explanation: Text?
}
function createAccount(email: Text) returns Account fails with AccountError`);
    language.compile();
    language.expectAcceptedSpecification();
    language.expectSuccessfulResult('createAccount', 'Account');
    language.expectDeclaredFailures('createAccount', ['AccountError']);
    language.expectErrorCodes('AccountError', ['duplicate-account', 'invalid-account']);
    language.expectErrorFields('AccountError', ['code', 'email: Text', 'explanation: Text?']);
    language.expectNoCompilerProblems();
  });

  it('exposes one error identity to independent code and documentation consumers', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: "duplicate-account" }\nfunction createAccount() returns Nothing fails with AccountError');
    language.compile();
    language.collectFailuresForCode('createAccount');
    language.collectFailuresForDocumentation('createAccount');
    language.expectBothConsumersToRead('AccountError', ['duplicate-account']);
    language.expectBothConsumersToUseTheInspectedDeclaration('AccountError');
    language.expectFailureFieldSlotsToMatchRecordFields('AccountError');
  });

  it('keeps error data construction separate from raising it', () => {
    const language = new FailureExamples();
    language.source(`error type AccountError { code: "duplicate-account" }
examples { fixture duplicate: AccountError = AccountError { code: "duplicate-account" } }`);
    language.compile();
    language.expectAcceptedSpecification();
    language.expectFixtureType('duplicate', 'AccountError');
    language.expectNoGeneratedOrExecutedApplication();
  });

  it('rejects a misspelled error code in reusable data', () => {
    const language = new FailureExamples();
    language.source(`error type AccountError { code: "duplicate-account" }
examples { fixture duplicate: AccountError = AccountError { code: "duplciate-account" } }`);
    language.compile();
    language.expectProblemAt('incompatible-type', '"duplciate-account"');
    language.expectNoAcceptedSpecification();
  });

  it('requires error payload data to match its declared fields', () => {
    const language = new FailureExamples();
    language.source(`error type AccountError {
  code: "duplicate-account"
  email: Text
}
examples { fixture duplicate: AccountError = AccountError { code: "duplicate-account", email: 17 } }`);
    language.compile();
    language.expectProblemAt('incompatible-type', '17');
    language.expectNoAcceptedSpecification();
  });

  it('does not invent an undeclared failure family', () => {
    const language = new FailureExamples();
    language.source('function createAccount() returns Nothing fails with AccountErorr');
    language.compile();
    language.expectProblemAt('unresolved-reference', 'AccountErorr');
    language.expectNoAcceptedSpecification();
  });

  it('does not treat an ordinary record as an exceptional contract', () => {
    const language = new FailureExamples();
    language.source('type AccountError { code: "duplicate-account" }\nfunction createAccount() returns Nothing fails with AccountError');
    language.compile();
    language.expectProblemAt('invalid-failure-type', 'AccountError', 'fails with AccountError');
    language.expectNoAcceptedSpecification();
  });

  it('requires a closed set of error codes even when the family is unused', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: Text }');
    language.compile();
    language.expectProblemAt('invalid-error-code', 'Text');
    language.expectNoAcceptedSpecification();
  });

  it('requires an explicit code field', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { reason: Text }');
    language.compile();
    language.expectProblemAt('invalid-error-code', 'AccountError');
    language.expectNoAcceptedSpecification();
  });

  it('does not silently choose the code through a default', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: "duplicate-account" = "duplicate-account" }');
    language.compile();
    language.expectProblemAt('invalid-error-code', 'code');
    language.expectNoAcceptedSpecification();
  });

  it('rejects repeated decoded codes in one family', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: "duplicate-account" | "duplicate-account" }');
    language.compile();
    language.expectProblemAtOccurrence('invalid-error-code', '"duplicate-account"', 2);
    language.expectRelatedCodeOccurrence('"duplicate-account"', 1);
  });

  it('uses existing imports and aliases for error names and code sets', () => {
    const language = new FailureExamples();
    language.module('accounts', `type AccountCode = "duplicate-account" | "invalid-account"
error type AccountError { code: AccountCode }`);
    language.source('use AccountError as Rejection from "accounts"\nfunction createAccount() returns Nothing fails with Rejection');
    language.compile();
    language.expectAcceptedSpecification();
    language.expectDeclaredFailureOrigin('createAccount', 'accounts', 'AccountError');
    language.expectErrorCodes('Rejection', ['duplicate-account', 'invalid-account']);
  });

  it('substitutes generic payload data through the existing type catalog', () => {
    const language = new FailureExamples();
    language.source(`error type Rejected<T> {
  code: "rejected"
  value: T
}
function accept(value: Text) returns Nothing fails with Rejected<Text>`);
    language.compile();
    language.expectDeclaredFailures('accept', ['Rejected<Text>']);
    language.expectFailurePayloadType('accept', 'Rejected<Text>', 'value', 'Text');
    language.expectErrorCodes('Rejected<Text>', ['rejected']);
  });

  it('keeps distinct applications and families in the authored failure order', () => {
    const language = new FailureExamples();
    language.source(`error type Rejected<T> { code: "rejected"\nvalue: T }
error type OtherRejection { code: "rejected" }
type TextRejection = Rejected<Text>
function accept() returns Nothing fails with TextRejection, Rejected<Number>, OtherRejection`);
    language.compile();
    language.expectAcceptedSpecification();
    language.expectDeclaredFailures('accept', ['TextRejection', 'Rejected<Number>', 'OtherRejection']);
    language.expectFailurePayloadType('accept', 'TextRejection', 'value', 'Text');
    language.expectFailurePayloadType('accept', 'Rejected<Number>', 'value', 'Number');
    language.expectFailureOrigins('accept', ['TextRejection', 'Rejected<Number>', 'OtherRejection']);
    language.expectNoProblem('duplicate-failure');
  });

  it('rejects duplicate equivalent failures through a type alias', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: "duplicate-account" }\ntype Alias = AccountError\nfunction createAccount() returns Nothing fails with AccountError, Alias');
    language.compile();
    language.expectProblemAt('duplicate-failure', 'Alias', 'fails with AccountError, Alias');
    language.expectRelatedFailure('AccountError', 'fails with AccountError, Alias');
  });

  it('does not expose a local error through a public capability', () => {
    const language = new FailureExamples();
    language.source(`concept Accounts {
  local error type Rejection { code: "rejected" }
  public create
  capability create() returns Nothing fails with Rejection
}`);
    language.compile();
    language.expectProblemAt('private-type-exposure', 'Rejection', 'fails with Rejection');
    language.expectNoAcceptedSpecification();
  });

  it('reads source-free error metadata through the same public queries', () => {
    const language = new FailureExamples();
    language.externalModule('accounts', [
      { kind: 'record-type', name: 'AccountError', error: true, fields: [
        { kind: 'field', name: 'code', type: { kind: 'literal', value: { kind: 'text', value: 'duplicate-account' } } },
      ] },
      { kind: 'function', name: 'createAccount', parameters: [], result: { kind: 'builtin', name: 'Nothing' },
        failures: [{ kind: 'named', path: ['AccountError'] }] },
    ]);
    language.source('use createAccount from "accounts"');
    language.compile();
    language.expectDeclaredFailures('createAccount', ['AccountError']);
    language.expectErrorCodes('AccountError', ['duplicate-account']);
    language.expectFailureOriginKind('createAccount', 'external');
    language.expectNoSyntheticSourceText();
  });

  it('keeps a returned error value distinct from a raised failure', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: "rejected" }\nfunction describeRejection() returns AccountError\nfunction createAccount() returns Nothing fails with AccountError');
    language.compile();
    language.expectSuccessfulResult('describeRejection', 'AccountError');
    language.expectDeclaredFailures('describeRejection', []);
    language.expectSuccessfulResult('createAccount', 'Nothing');
    language.expectDeclaredFailures('createAccount', ['AccountError']);
  });

  it('keeps existing declarations unchanged in the identity comparison', () => {
    const language = new FailureExamples();
    language.loadBaselineFromReleaseBeforeDomainFailures();
    language.source('type Account { id: Text }\nfunction findAccount(id: Text) returns Account');
    language.compileAndAssociateExistingIds();
    language.compareWithLoadedBaseline();
    language.expectNoSpecificationChanges();
  });

  it('records adding a domain failure as a contract change', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: "rejected" }\nfunction createAccount() returns Nothing');
    language.compileAndRememberIdentity();
    language.revise('error type AccountError { code: "rejected" }\nfunction createAccount() returns Nothing fails with AccountError');
    language.compileAndCompare();
    language.expectSameIdentifier('createAccount');
    language.expectContractUpdated('createAccount');
    language.expectDeclaredReference('createAccount', 'AccountError');
  });

  it('retains invalid payload slots inside a known family description without certifying the failure', () => {
    const language = new FailureExamples();
    language.source('error type Rejected { code: "rejected"\nvalue: MissingPayload }\nfunction accept() returns Number fails with Rejected');
    language.describeTypes();
    language.expectErrorDescriptionStatus('Rejected', 'known');
    language.expectErrorCodes('Rejected', ['rejected']);
    language.expectErrorFieldStatus('Rejected', 'value', 'invalid');
    language.expectErrorFieldCause('Rejected', 'value', 'unresolved-reference', 'MissingPayload');
    language.expectFailureStatus('accept', 0, 'invalid');
    language.expectFailureCause('accept', 0, 'unresolved-reference', 'MissingPayload');
    language.expectSuccessfulResult('accept', 'Number');
    language.compile();
    language.expectProblemAt('unresolved-reference', 'MissingPayload');
    language.expectNoAcceptedSpecification();
  });

  it('keeps independent invalid code, payload and result facts visible and leaves earlier reports unchanged', () => {
    const language = new FailureExamples();
    language.source('error type AccountError { code: Text\npayload: MissingPayload }\nfunction createAccount() returns MissingResult fails with AccountError');
    language.describeTypes();
    language.rememberAnalysis();
    language.queryErrorRepeatedly('AccountError');
    language.expectErrorDescriptionStatus('AccountError', 'invalid');
    language.expectErrorCause('AccountError', 'invalid-error-code', 'Text');
    language.expectErrorCause('AccountError', 'unresolved-reference', 'MissingPayload');
    language.expectFailureStatus('createAccount', 0, 'invalid');
    language.expectFailureCause('createAccount', 0, 'invalid-error-code', 'Text');
    language.expectFailureCause('createAccount', 0, 'unresolved-reference', 'MissingPayload');
    language.expectResultStatus('createAccount', 'invalid');
    language.expectEarlierAnalysisUnchanged();
    language.compile();
    language.expectProblemAt('invalid-error-code', 'Text');
    language.expectProblemAt('unresolved-reference', 'MissingPayload');
    language.expectProblemAt('unresolved-reference', 'MissingResult');
    language.expectNoAcceptedSpecification();
  });

  it('retains a deferred failure independently of an invalid successful result', () => {
    const language = new FailureExamples();
    language.source('include "later"\nfunction accept() returns List fails with LaterError');
    language.describeTypes();
    language.expectResultStatus('accept', 'invalid');
    language.expectResultCause('accept', 'wrong-type-argument-count', 'List');
    language.expectFailureStatus('accept', 0, 'deferred');
    language.expectFailureRequirement('accept', 0, 'composition', 'LaterError');
    language.compile();
    language.expectProblemAt('wrong-type-argument-count', 'List');
    language.expectRequirementAt('composition', 'LaterError');
    language.expectNoAcceptedSpecification();
  });

});
