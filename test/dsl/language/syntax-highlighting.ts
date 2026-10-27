import { expect } from 'vitest';
import { SyntaxHighlightingDriver, type AvailableSyntaxArtifact } from '../../driver/language/syntax-highlighting.js';

export class SyntaxHighlighting {
  private readonly driver = new SyntaxHighlightingDriver();

  async loadPackagedSyntax(): Promise<void> { await this.driver.loadPackagedSyntax(); }
  async read(source: string): Promise<void> { await this.driver.read(source); }

  expectLanguage(language: string, scopeName: string, fileTypes: readonly string[]): void {
    const artifact = this.availableArtifact();
    expect({ language: artifact.language, scopeName: artifact.scopeName, fileTypes: artifact.fileTypes })
      .toEqual({ language, scopeName, fileTypes });
  }

  expectScope(line: number, column: number, scope: string): void {
    this.availableArtifact();
    expect(this.driver.scopeAt(line, column), `the innermost scope at line ${line}, column ${column}`).toBe(scope);
  }

  private availableArtifact(): AvailableSyntaxArtifact {
    const artifact = this.driver.artifact;
    const reason = artifact?.status === 'unavailable' ? ': ' + artifact.reason : '';
    expect(artifact?.status, 'an editor build can resolve the packaged syntax asset' + reason).toBe('available');
    if (artifact?.status !== 'available') throw new Error('Expected an available packaged syntax asset.');
    return artifact;
  }
}
