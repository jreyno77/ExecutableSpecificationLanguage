import { it } from 'vitest';
import { SyntaxHighlighting } from '../../dsl/language/syntax-highlighting.js';

it('highlights a declared call using the language-generated syntax asset', async () => {
  const highlighting = new SyntaxHighlighting();
  await highlighting.read(`component Calculator {
  capability add() returns Number {
    calls Transformer.transform
  }
}`);
  highlighting.expectScope(3, 5, 'keyword.control.expec');
  highlighting.expectScope(3, 11, 'entity.name.expec');
});
