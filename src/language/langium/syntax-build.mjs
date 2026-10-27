import { readFile, writeFile } from 'node:fs/promises';
import { GrammarAST, GrammarUtils } from 'langium';
import { ExpecGrammar } from './generated/grammar.ts';

const path = new URL('../../../dist/syntax/expec.tmLanguage.json', import.meta.url);
const syntax = JSON.parse(await readFile(path, 'utf8'));
const grammar = ExpecGrammar();
const namePattern = name => {
  const terminal = grammar.rules.find(rule => GrammarAST.isTerminalRule(rule) && rule.name === name);
  if (!terminal) throw new Error(`Missing ${name} terminal in the .expec grammar.`);
  return { name: 'entity.name.expec', match: GrammarUtils.terminalRegex(terminal).source };
};

syntax.patterns.unshift(namePattern('QUOTED_NAME'));
syntax.patterns.push(namePattern('ID'));
await writeFile(path, JSON.stringify(syntax, null, 2) + '\n');
