import { it } from 'vitest';
import { MarkdownWikiExamples } from '../../../dsl/project/output/markdown-wiki.js';

it('links a capability\'s declared calls within its single source document', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('relay.expec', `component Courier {
  public ship
  capability ship() returns Nothing
}
component ResultsRelay {
  capability export() returns Nothing { calls Courier.ship, Courier.ship }
}`);
  await docs.generateFrom('relay.expec');
  docs.expectDeclaredCalls('ResultsRelay.export', ['Courier.ship']);
  docs.expectDeclarationLink('ResultsRelay.export', 'Courier.ship', { relativePath: '', anchorOf: 'Courier.ship' });
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/relay.md']);
  docs.expectAllGeneratedLinksResolve();
});

it('links calls to the target operation on another source page', async () => {
  const docs = new MarkdownWikiExamples();
  docs.sourceFile('relay.expec', `use Courier from "./courier.expec"
component ResultsRelay { capability export() returns Nothing { calls Courier.ship } }`);
  docs.sourceFile('courier.expec', `component Courier {
  public ship
  capability ship() returns Nothing
}`);
  await docs.generateFrom('relay.expec');
  docs.expectDeclaredCalls('ResultsRelay.export', ['Courier.ship']);
  docs.expectDeclarationLink('ResultsRelay.export', 'Courier.ship', { relativePath: 'courier.md', anchorOf: 'Courier.ship' });
  docs.expectHomeLinks(['pages/courier.md', 'pages/relay.md']);
  docs.expectAllGeneratedLinksResolve();
});

it('uses plain declaration text when an external target has no source page', async () => {
  const docs = new MarkdownWikiExamples();
  docs.externalFunction('vendor:convert', 'convert', [], 'Number', { body: 'unavailable' });
  docs.sourceFile('relay.expec', `use convert from "vendor:convert"
function add() returns Number { calls convert }`);
  await docs.generateFrom('relay.expec');
  docs.expectDeclaredCalls('add', ['convert']);
  docs.expectFiles(['docs/specification/Home.md', 'docs/specification/pages/relay.md']);
  docs.expectAllGeneratedLinksResolve();
});
