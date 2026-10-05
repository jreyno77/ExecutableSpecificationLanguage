import { afterEach, describe, it } from 'vitest';
import { JavaExamples } from '../dsl/java-output.js';
import { JavaAcceptance } from '../dsl/java-acceptance.js';

afterEach(() => JavaExamples.dispose());

describe('Java output reports unresolved contracts and native naming conflicts', { timeout: 180_000 }, () => {
  it('reports callable literal constraints that javac cannot establish', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Title = "Dune" | "Foundation"\nfunction save(title: "Dune") returns Nothing\nfunction title() returns "Dune"\nfunction shelf(titles: List<Title>) returns Nothing');
    await p.planContracts({ package: 'store' });
    p.expectPlannedObligations([
      ['verification-required', 'save.title', '"Dune"', '"Dune") returns Nothing'],
      ['verification-required', 'title result', '"Dune"', '"Dune"\nfunction shelf'],
      ['verification-required', 'shelf.titles', 'List<Title>', 'List<Title>'],
    ]);
    await p.createContracts({ package: 'store' }); p.expectContractsWritten(); p.expectWrittenObligationsMatchPlan();
    await p.javac('class Consumer { void acceptsNativeTypes() { store.Functions.save("Other"); String value = store.Functions.title(); store.Functions.shelf(java.util.List.of("Other")); } }');
    p.expectNativeCompilationPassed();
  });

  it('reports authored contract obligations through planning, writing and unchanged generation', async () => {
    const p = await JavaExamples.connect(); await p.installNativeProfile();
    p.source('type Book { title: Text }\nerror type Rejected<T> { code: "rejected"\npayload: T }\nfunction save(book: Book, copies: Number = 1) returns Book fails with Rejected<Book> { requires copies > 0\nensures true\npromises "Saved to disk" }\nfunction discover()');
    await p.planContracts({ package: 'store' });
    p.expectPlannedObligations([
      ['default-verification-required', 'copies', '1', 'copies: Number = 1'],
      ['failure-verification-required', 'save', 'Rejected<Book>', 'Rejected<Book>'],
      ['verification-required', 'save', 'requires copies > 0', 'requires copies > 0'],
      ['verification-required', 'save', 'ensures true', 'ensures true'],
      ['verification-required', 'save', 'Saved to disk', 'promises "Saved to disk"'],
      ['unspecified-result', 'discover', 'unspecified', 'function discover()'],
    ]);
    await p.createContracts({ package: 'store' }); p.expectContractsWritten(); p.expectWrittenObligationsMatchPlan();
    await p.createContracts({ package: 'store' }); p.expectContractsUnchanged(); p.expectWrittenObligationsMatchPlan();
    await p.expectMethod('store.Functions', 'save', ['store.Book', 'double'], 'store.Book');
  });

  it('refuses a domain that would replace its required comparison support', async () => {
    const p = await JavaAcceptance.connect();
    p.source('examples { action begin() {}\nscenario "Dune" { when begin()\nthen true } }');
    await p.rememberFiles(); await p.planGeneration({ domain: 'expecChecks' });
    p.expectNoPlanAt('native-name-conflict', 'domain');
    await p.generate({ domain: 'expecChecks' }); p.expectRefusedOption('native-name-conflict', 'domain');
    await p.expectFilesUnchanged();
  });
});
