import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { IGrammar, IOnigLib, IToken } from 'vscode-textmate';

const require = createRequire(import.meta.url);
const { INITIAL, Registry, parseRawGrammar } = require('vscode-textmate') as typeof import('vscode-textmate');
const oniguruma = require('vscode-oniguruma');
const syntaxSubpath = 'executable-specification-language/syntax/expec.tmLanguage.json';

export interface AvailableSyntaxArtifact {
  readonly status: 'available';
  readonly language: string | undefined;
  readonly scopeName: string;
  readonly fileTypes: readonly string[] | undefined;
}

type SyntaxArtifact = AvailableSyntaxArtifact | { readonly status: 'unavailable'; readonly reason: string };
type LoadedSyntax = { artifact: SyntaxArtifact; grammar?: IGrammar };
let packagedSyntax: Promise<LoadedSyntax> | undefined;

async function loadPackagedSyntax(): Promise<LoadedSyntax> {
  let path: string, content: string;
  try {
    path = require.resolve(syntaxSubpath);
    content = await readFile(path, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'MODULE_NOT_FOUND' || code === 'ENOENT') {
      return { artifact: { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) } };
    }
    throw error;
  }

  const raw = parseRawGrammar(content, path);
  const wasm = await readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm);
  const onigLib: IOnigLib = {
    createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
    createOnigString: source => new oniguruma.OnigString(source),
  };
  const registry = new Registry({
    onigLib: Promise.resolve(onigLib),
    loadGrammar: async scopeName => scopeName === raw.scopeName ? raw : null,
  });
  const grammar = await registry.loadGrammar(raw.scopeName);
  if (!grammar) throw new Error('TextMate could not load the packaged syntax grammar.');
  const artifact: AvailableSyntaxArtifact = Object.freeze({
    status: 'available', language: raw.name, scopeName: raw.scopeName,
    fileTypes: raw.fileTypes ? Object.freeze([...raw.fileTypes]) : undefined,
  });
  return { artifact, grammar };
}

export class SyntaxHighlightingDriver {
  artifact: SyntaxArtifact | undefined;
  private grammar: IGrammar | undefined;
  private lines: readonly (readonly IToken[])[] | undefined;

  async loadPackagedSyntax(): Promise<void> {
    const loaded = await (packagedSyntax ??= loadPackagedSyntax());
    this.artifact = loaded.artifact;
    this.grammar = loaded.grammar;
  }

  async read(source: string): Promise<void> {
    this.lines = undefined;
    await this.loadPackagedSyntax();
    if (this.artifact?.status === 'unavailable') return;
    if (!this.grammar) throw new Error('Load the packaged syntax grammar before reading source.');
    let state = INITIAL;
    this.lines = source.split(/\r?\n/).map(line => {
      const result = this.grammar!.tokenizeLine(line, state);
      if (result.stoppedEarly) throw new Error('TextMate stopped before highlighting the complete source line.');
      state = result.ruleStack;
      return result.tokens;
    });
  }

  scopeAt(line: number, column: number): string | undefined {
    const offset = column - 1;
    return this.lines?.[line - 1]?.find(token => token.startIndex <= offset && offset < token.endIndex)?.scopes.at(-1);
  }
}
