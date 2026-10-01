import {
  createDefaultCoreModule, createDefaultSharedCoreModule, DefaultValueConverter,
  EmptyFileSystem, inject, type CstNode, type GrammarAST,
} from 'langium';
import { ExpecGeneratedModule, ExpecGeneratedSharedModule } from './generated/module.js';

class LiteralConverter extends DefaultValueConverter {
  protected override runConverter(rule: GrammarAST.AbstractRule, input: string, node: CstNode) {
    if (rule.name === 'STRING') return JSON.parse(input) as string;
    if (rule.name === 'QUOTED_NAME') return input.slice(1, -1).replace(/\\([`\\])/gu, '$1');
    return super.runConverter(rule, input, node);
  }
}

/** Only parsing is assembled. The compiler's resolver owns binding and scopes. */
export function createExpecServices() {
  const shared = inject(createDefaultSharedCoreModule(EmptyFileSystem), ExpecGeneratedSharedModule);
  return inject(createDefaultCoreModule({ shared }), ExpecGeneratedModule, {
    parser: { ValueConverter: () => new LiteralConverter() },
  });
}
