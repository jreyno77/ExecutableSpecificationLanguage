import { describe, it } from 'vitest';
import { SyntaxHighlighting } from '../../dsl/language/syntax-highlighting.js';

describe('an author reads highlighted specification source', () => {
  it('an editor build can consume the packaged syntax asset', async () => {
    const highlighting = new SyntaxHighlighting();
    await highlighting.loadPackagedSyntax();

    highlighting.expectLanguage('expec', 'source.expec', ['.expec']);
  });

  it('an author can distinguish keywords and declared names', async () => {
    const highlighting = new SyntaxHighlighting();
    await highlighting.read('type Book { title: Text }');

    highlighting.expectScope(1, 1, 'keyword.control.expec');
    highlighting.expectScope(1, 6, 'entity.name.expec');
  });

  it('string contents remain text when they contain language syntax', async () => {
    const highlighting = new SyntaxHighlighting();
    await highlighting.read('component Store { capability save() { promises "type // Book" } }');

    highlighting.expectScope(1, 49, 'string.quoted.double.expec');
    highlighting.expectScope(1, 56, 'string.quoted.double.expec');
  });

  it('a line comment ends before the next declaration', async () => {
    const highlighting = new SyntaxHighlighting();
    await highlighting.read('// type Book {}\nconcept Store {}');

    highlighting.expectScope(1, 4, 'comment.line.expec');
    highlighting.expectScope(2, 1, 'keyword.control.expec');
  });

  it('a quoted name protects keyword and comment text', async () => {
    const highlighting = new SyntaxHighlighting();
    await highlighting.read('concept `type // Book` {}');

    highlighting.expectScope(1, 10, 'entity.name.expec');
    highlighting.expectScope(1, 15, 'entity.name.expec');
  });

  it('an escaped backtick stays inside the quoted name', async () => {
    const highlighting = new SyntaxHighlighting();
    await highlighting.read('concept `a\\` // Book` {}\nconcept Store {}');

    highlighting.expectScope(1, 16, 'entity.name.expec');
    highlighting.expectScope(2, 1, 'keyword.control.expec');
  });
});
