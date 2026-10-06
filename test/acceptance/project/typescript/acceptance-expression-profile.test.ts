import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';

describe('checked values remain actual native expressions', () => {
  it('uses an omitted authored default before evaluating unary arithmetic', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`examples {
      observation negate(count: Number = 2) returns Number { return -count }
      example "default quantity": negate() => -2
      example "Boolean negation": not false => true
    }`);
    await project.generate({ domain: 'numbers' }); await project.runGeneratedVitest();
    project.expectTestsPassed(['default quantity', 'Boolean negation']);
  }, 60_000);
  it('uses a quoted parameter through its explicit native name', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { observation title(`book name`: Text) returns Text { return `book name` }\nexample "quoted title": title("Dune") => "Dune" }');
    await project.generate({ domain: 'books', names: [{ declaration: ['title', 'book name'], name: 'bookName' }] });
    await project.runGeneratedVitest(); project.expectTestsPassed(['quoted title']);
  }, 60_000);
  it('reads a mapped native global through checked member access', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`type Address { href: Text }
      function address() returns Address
      examples { observation location(address: Address) returns Text { return address.href }
      example "actual address": location(address()) => "https://example.com/books" }`);
    await project.file('address.ts', 'export function address(): URL { return new URL("https://example.com/books"); }');
    await project.mapApplicationFunction('address', 'address.ts', 'address');
    await project.generate({ domain: 'addresses', imports: [{ module: 'shopping', declaration: ['Address'], name: 'URL' }] });
    await project.runGeneratedVitest(); project.expectTestsPassed(['actual address']);
  }, 60_000);
});
