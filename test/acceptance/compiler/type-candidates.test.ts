import { describe, it } from 'vitest';
import { ContextualTypeCandidates } from '../../dsl/compiler/type-candidates.js';

describe('an author asks which type names belong at a captured reference', () => {
  it('offers Book at an unresolved partial type token and omits functions', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Book {}\nfunction helper() returns Nothing\nfunction read(value: Bo)');
    types.resolveDeclarations(); types.askAtType(['Bo']);
    types.expectNames(['Book', 'Boolean', 'List', 'Nothing', 'Number', 'Text']);
    types.expectCandidate('Book', 'Book', { module: 'entry', name: 'Book', kind: 'record-type-declaration', nameAt: [1, 6] });
    types.expectQueryFindings([], []);
    types.expectOriginalProblemCodes(['unresolved-reference']);
  });

  it('keeps an owner-local type available inside and inaccessible outside its owner', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('component Library {\n local type Book {}\n capability read(value: Bo)\n}\nfunction outside(value: Library.Bo)');
    types.resolveDeclarations(); types.askAtType(['Bo']);
    types.expectCandidate('Book', 'Book', { module: 'entry', name: 'Book', kind: 'record-type-declaration', nameAt: [2, 13] });
    types.askAtType(['Library', 'Bo']); types.expectNames([]);
    types.expectQueryFindings([], []);
  });

  it('selects the nearer type identity rather than the same-spelled outer declaration', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Book {}\ncomponent Library {\n local type Book {}\n capability read(value: Book)\n}');
    types.resolveDeclarations(); types.askAtType(['Book']);
    types.expectCandidate('Book', 'Book', { module: 'entry', name: 'Book', kind: 'record-type-declaration', nameAt: [3, 13] });
    types.expectCandidateCount('Book', 1); types.expectQueryFindings([], []);
  });

  it('does not bypass a nearer value that hides an outer type', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Book {}\nfunction read(Book: Text, value: Book)');
    types.resolveDeclarations(); types.askAtType(['Book']);
    types.expectNames(['Boolean', 'List', 'Nothing', 'Number', 'Text']);
    types.expectOriginalProblemCodes(['wrong-reference-kind']);
  });

  it('offers both lexical aliases while retaining their one actual source declaration', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Cart as Basket, Cart as SavedBasket from "shopping"\nfunction read(value: Bas)');
    types.sourceModuleIs('shopping', 'type Cart {}');
    types.resolveDeclarations(); types.askAtType(['Bas']);
    types.expectNames(['Basket', 'Boolean', 'List', 'Nothing', 'Number', 'SavedBasket', 'Text']);
    types.expectCandidate('Basket', 'Basket', { module: 'shopping', name: 'Cart', kind: 'record-type-declaration', nameAt: [1, 6] });
    types.expectCandidate('SavedBasket', 'SavedBasket', { module: 'shopping', name: 'Cart', kind: 'record-type-declaration', nameAt: [1, 6] });
    types.expectSameTarget('Basket', 'SavedBasket'); types.expectQueryFindings([], []);
  });

  it('derives qualified eligibility from the captured preceding reference segment', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('component Library {\n local type Book {}\n local type Journal {}\n capability read(value: Library.Bo)\n}');
    types.resolveDeclarations(); types.askAtType(['Library', 'Bo']);
    types.expectNames(['Book', 'Journal']);
    types.expectCandidate('Book', 'Book', { module: 'entry', name: 'Book', kind: 'record-type-declaration', nameAt: [2, 13] });
    types.expectInsertedNameResolves('Book'); types.expectQueryFindings([], []);
  });

  it('omits an ambiguous spelling while retaining an independent Book candidate', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Cart from "one"\nuse Cart from "two"\ntype Book {}\nfunction read(value: Cart)');
    types.sourceModuleIs('one', 'type Cart {}'); types.sourceModuleIs('two', 'type Cart {}');
    types.resolveDeclarations(); types.askAtType(['Cart'], 2);
    types.expectNames(['Book', 'Boolean', 'List', 'Nothing', 'Number', 'Text']);
    types.expectQueryFindings(['ambiguous-reference'], []);
    types.expectRelatedIntroductionModules('ambiguous-reference', ['entry', 'entry']);
  });

  it('refuses an ambiguous qualifier instead of choosing either Library', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Library from "one"\nuse Library from "two"\nfunction read(value: Library.Bo)');
    types.sourceModuleIs('one', 'component Library { local type Book {} }');
    types.sourceModuleIs('two', 'component Library { local type Magazine {} }');
    types.resolveDeclarations(); types.askAtType(['Library', 'Bo']);
    types.expectNoValue(); types.expectQueryFindings(['ambiguous-reference'], []);
  });

  it('refuses a missing qualifier with the actual located query reference', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Book {}\nfunction read(value: Missing.Bo)');
    types.resolveDeclarations(); types.askAtType(['Missing', 'Bo']);
    types.expectNoValue(); types.expectQueryFindings(['unresolved-reference'], []);
    types.expectQueryProblemAt('unresolved-reference', 'entry', [2, 22]);
  });

  it('keeps an invalid imported spelling explicit without suppressing available names', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Cart as Basket from "missing"\ntype Book {}\nfunction read(value: Bo)');
    types.resolveDeclarations(); types.askAtType(['Bo']);
    types.expectNames(['Book', 'Boolean', 'List', 'Nothing', 'Number', 'Text']);
    types.expectQueryFindings(['unavailable-module'], []);
  });

  it('does not claim a complete list while a missing included source leaves composition deferred', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('include "./missing.expec"\ntype Basket { book: Boo }');
    types.composeSources(); // actual public SourceComposer with unavailable included source
    types.askAtType(['Boo']); types.expectNoValue();
    types.expectQueryFindings([], ['composition']);
    types.expectSameDeferredOccurrenceAsReference();
    types.expectOriginalProblemCodes(['unavailable-module', 'composition-required']);
  });

  it('does not let an unrelated compiler error erase an eligible current name', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Book {}\nfunction broken(value: Missing)\nfunction read(value: Bo)');
    types.resolveDeclarations(); types.compileResolvedSource(); types.askAtType(['Bo']);
    types.expectCompilationValueAbsent();
    types.expectCandidate('Book', 'Book', { module: 'entry', name: 'Book', kind: 'record-type-declaration', nameAt: [1, 6] });
    types.expectQueryFindings([], []); types.expectOriginalProblemCodes(['unresolved-reference', 'unresolved-reference']);
  });

  it('selects the generic parameter of this owner and keeps builtins eligible', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Box<T> { value: T }\ntype Page<T> { value: T }');
    types.resolveDeclarations(); types.askAtType(['T'], 0);
    types.expectCandidate('T', 'T', { module: 'entry', name: 'T', kind: 'type-parameter', nameAt: [1, 10] });
    types.expectCandidate('Text', 'Text', { name: 'Text', kind: 'builtin-type', builtin: true });
    types.expectCandidateCount('T', 1); types.expectQueryFindings([], []);
  });

  it('retains an external target without substituting a source-only declaration list', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Cart as Basket from "shopping"\nfunction read(value: Bas)');
    types.externalModuleIs('shopping', [{ kind: 'record-type', name: 'Cart', fields: [] }]);
    types.resolveDeclarations(); types.askAtType(['Bas']);
    types.expectCandidate('Basket', 'Basket', { module: 'shopping', name: 'Cart', kind: 'record-type-declaration', externalPath: [0] });
    types.expectInsertedNameResolves('Basket'); types.expectQueryFindings([], []);
  });

  it('owns valid insertion text for Unicode, keywords, escaped names and quoted aliases', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Cart as `my basket` from "shopping"\ntype `📚Book` {}\ntype `class` {}\ntype `Tick\\`Book` {}\nfunction read(value: Boo)');
    types.sourceModuleIs('shopping', 'type Cart {}');
    types.resolveDeclarations(); types.askAtType(['Boo']);
    types.expectInsertion('📚Book', '`📚Book`');
    types.expectInsertion('class', '`class`');
    types.expectInsertion('Tick`Book', '`Tick\\`Book`');
    types.expectInsertion('my basket', '`my basket`');
    types.expectInsertedNameResolves('📚Book'); types.expectInsertedNameResolves('class');
    types.expectInsertedNameResolves('Tick`Book'); types.expectInsertedNameResolves('my basket');
  });

  it('reuses detached captured facts and keeps repeated replies independent', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('type Book {}\nfunction read(value: Bo)');
    types.resolveDeclarations(); types.forbidFurtherInputModelReads();
    types.askAtType(['Bo']); types.rememberReply('first'); types.attemptCandidateMutation('Book');
    types.askAtType(['Bo']); types.expectInsertion('Book', 'Book');
    types.expectSameTargetAsReply('Book', 'first'); types.expectNoInputModelReads();
    types.expectOriginalProblemCodes(['unresolved-reference']); types.expectCapturedModelUnchanged();
  });

  it('retains each real workspace entry scope through the SourceComposer array result', () => {
    const types = new ContextualTypeCandidates();
    types.composeEntries([
      { locator: 'first', text: 'type Book {}\nfunction read(value: Bo)' },
      { locator: 'second', text: 'type Other {}' },
    ]); // public compose([{entry,dependencies}, ...]), not its single-entry overload
    types.askAtTypeIn('first', ['Bo']);
    types.expectNames(['Book', 'Boolean', 'List', 'Nothing', 'Number', 'Text']);
    types.expectCandidate('Book', 'Book', { module: 'first', name: 'Book', kind: 'record-type-declaration', nameAt: [1, 6] });
    types.useSameModelReportWithPublicFindings([], []); types.askAtTypeIn('first', ['Bo']);
    types.expectSameCapturedModel();
    types.expectNames(['Book', 'Boolean', 'List', 'Nothing', 'Number', 'Text']);
  });

  it('keeps captured ambiguity after a same-model report copy clears public findings', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('use Cart from "one"\nuse Cart from "two"\ntype Book {}\nfunction read(value: Cart)');
    types.sourceModuleIs('one', 'type Cart {}'); types.sourceModuleIs('two', 'type Cart {}');
    types.resolveDeclarations(); types.askAtType(['Cart'], 2); types.rememberReply('ambiguous');
    types.useSameModelReportWithPublicFindings([], []); types.askAtType(['Cart'], 2);
    types.expectSameCapturedModel(); types.expectNames(['Book', 'Boolean', 'List', 'Nothing', 'Number', 'Text']);
    types.expectQueryFindings(['ambiguous-reference'], []);
    types.expectSameQueryFindingsAsReply('ambiguous');
  });

  it('keeps captured deferral after a same-model report copy clears public findings', () => {
    const types = new ContextualTypeCandidates();
    types.sourceIs('include "./missing.expec"\ntype Basket { book: Boo }');
    types.composeSources(); types.askAtType(['Boo']); types.rememberReply('deferred');
    types.useSameModelReportWithPublicFindings([], []); types.askAtType(['Boo']);
    types.expectSameCapturedModel(); types.expectNoValue(); types.expectQueryFindings([], ['composition']);
    types.expectSameQueryFindingsAsReply('deferred'); types.expectSameDeferredOccurrenceAsReference();
  });
});
