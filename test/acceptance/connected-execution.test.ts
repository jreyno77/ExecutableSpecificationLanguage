import { afterAll, beforeAll, describe, it } from 'vitest';
import { ConnectedExecution } from '../dsl/connected-execution.js';

describe('the connected test command executes authored scenarios', () => {
  const project = new ConnectedExecution();
  beforeAll(async () => { await ConnectedExecution.prepare(); await project.prepareShopping(); }, 300_000);
  afterAll(() => project.dispose());
  it('runs the generated Dune scenario against real application state', async () => {
    await project.freshShopping();
    await project.run();
    project.expectExit(0);
    project.expectNativePassed('a shopper can add an available book');
    await project.expectActualQuantity('Dune', 1);
    await project.expectServerClosed();
  }, 100_000);
  it('the same generated scenario fails when the real add endpoint is a no-op', async () => {
    await project.freshShopping(); await project.configureShop({ addBook: 'no-op' });
    await project.run(); project.expectExit(1);
    project.expectNativeState('a shopper can add an available book', 'failed');
    project.expectNativeFailure(1, 0); await project.expectActualQuantity('Dune', 0);
    await project.expectServerClosed(); await project.expectGeneratedUnchanged();
  }, 100_000);
  it('preserves both the actual assertion and native cleanup failures', async () => {
    await project.freshShopping(); await project.configureShop({ addBook: 'no-op', closeFailure: 'Catalog cleanup failed' });
    await project.run(); project.expectExit(1); project.expectNativeFailure(1, 0);
    project.expectNativeMessage('Catalog cleanup failed'); await project.expectServerClosed();
  }, 100_000);
  it('executes an edited handwritten implementation without another build', async () => {
    await project.freshShopping();
    await project.edit('test/driver/http-shopping.ts', "await this.request('/add', { title });", "await this.request('/add', { title }); console.log('handwritten add was executed');");
    await project.run(); project.expectExit(0);
    project.expectNativePassed('a shopper can add an available book'); project.expectStderr('handwritten add was executed');
    await project.expectActualQuantity('Dune', 1); await project.expectGeneratedUnchanged();
  }, 100_000);
  it('refuses an edited generated assertion even when it would pass the wrong application', async () => {
    await project.freshShopping(); await project.configureShop({ addBook: 'no-op' });
    await project.edit('test/acceptance/shopping.test.ts', 'expectBookQuantity("Dune", 1)', 'expectBookQuantity("Dune", 0)');
    await project.run(); project.expectExit(1); project.expectProblem('generated-test-drift');
    project.expectNoNativeAttempt(); await project.expectNoRequests();
  }, 100_000);
  it('requires generation after an authored source change', async () => {
    await project.freshShopping(); await project.editSource('expectBookQuantity("Dune", 1)', 'expectBookQuantity("Dune", 2)');
    await project.run(); project.expectExit(1); project.expectProblem('generation-required');
    project.expectNoNativeAttempt(); await project.expectNoRequests();
  }, 100_000);
  it('does not call an empty native collection verified', async () => {
    await project.freshShopping(); await project.configureNative({ include: ['not-generated/**/*.test.ts'], passWithNoTests: true });
    await project.run(); project.expectExit(1); project.expectProblem('generated-tests-not-executed');
    await project.expectNoRequests();
  }, 100_000);
  it('does not execute a similarly named neighboring test file', async () => {
    await project.freshShopping();
    await project.file('test/acceptance/shopping.test.ts.extra.test.ts', `import { writeFileSync } from 'node:fs'; import { test } from 'vitest';
writeFileSync('unexpected-neighbor-executed.txt', 'module was executed');
test('an unrelated neighbor', () => { throw Error('not selected'); });`);
    await project.run(); project.expectExit(0); project.expectNativePassed('a shopper can add an available book');
    await project.expectNoFile('unexpected-neighbor-executed.txt');
  }, 100_000);
  it('reports a selected scenario as skipped instead of treating it as passed', async () => {
    await project.freshShopping(); await project.configureNative({ include: ['test/acceptance/*.test.ts'], testNamePattern: 'this title does not exist', passWithNoTests: true });
    await project.run(); project.expectExit(1); project.expectProblem('generated-tests-not-executed');
    project.expectNativeState('a shopper can add an available book', 'skipped'); await project.expectNoRequests();
  }, 100_000);
  it('keeps native application stdout separate from the JSON result', async () => {
    await project.freshShopping();
    await project.file('native-log.ts', 'process.stdout.write(JSON.stringify({success:false,message:"application log"}) + String.fromCharCode(10));');
    await project.configureNative({ include: ['test/acceptance/*.test.ts'], setupFiles: ['./native-log.ts'] });
    await project.run(); project.expectExit(0); project.expectSingleJson(); project.expectStderr('application log');
    project.expectNativePassed('a shopper can add an available book');
  }, 100_000);
  it('reports a missing local runner without installation or fallback', async () => {
    await project.freshShopping(); await project.runnerUnavailable();
    await project.run(); project.expectExit(1); project.expectProblem('runner-unavailable');
    project.expectNoNativeAttempt(); await project.expectNoRequests();
  }, 100_000);

});
