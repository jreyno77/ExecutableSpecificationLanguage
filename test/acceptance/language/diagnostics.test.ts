import { describe, it } from 'vitest';
import { SourceReading } from '../../dsl/language/source-reading.js';
import { CompilationExamples } from '../../dsl/compiler/compiler-composition.js';

const relaySource = `type ResultPayload {
    result: Text
    cancelled: Boolean
}
opaque type URL
error type ResultRelayDownloadError {
    code: "persistance-issue" | "invalid-payload"
}
error type ResultRelayExportError {
    code: "targetLocation-dne" | "invalid-payload" | "delivery-issue" | "partial-cleanup" | "unable-to-cleanup"
}
concept ResultsRelay {
    depends on URL
    capability download(result: ResultPayload) retrns Nothing fails with ResultRelayDownloadError {
        promises "The result is persisted in memory"
        promises "Can support large results"
        promises "Can be cancelled"
    }

    capability export(result: ResultPayload, targetLocation: URL) returns Nothing fails with ResultRelayExportError {
        promises "The result has been sent to a provided target"
        promises "Creates a temporary backing file"
        promises "Can support large results"
        promises "Can be cancelled"
        promises "Cleanup"
    }
}`;

it('locates the misspelled return keyword inside the actual ResultsRelay declaration', () => {
    const language = new SourceReading();
    language.sourceIs(relaySource);
    language.readSource();
    language.expectFirstSyntaxProblemAt('retrns', { line: 14, column: 48 });
});

it('accepts the same relay after correcting only the return keyword', () => {
    const language = new SourceReading();
    language.sourceIs(relaySource);
    language.readSource();
    language.expectFirstSyntaxProblemAt('retrns', { line: 14, column: 48 });
    language.sourceIs(relaySource.replace('retrns', 'returns'));
    language.readSource();
    language.expectConceptNamed('ResultsRelay', { quoted: false, at: { line: 12, column: 9 } });
    language.expectOriginalSourcePreserved();
});

it('locates a missing field colon after an earlier valid declaration', () => {
    const language = new SourceReading();
    language.sourceIs('type Marker {}\ntype Book {\n title Text\n}');
    language.readSource();
    language.expectFirstSyntaxProblemAt('Text', { line: 3, column: 8 });
});

it('locates a malformed second capability parameter', () => {
    const language = new SourceReading();
    language.sourceIs('concept Library {\n capability first() returns Nothing\n capability second(value Text) returns Nothing\n}');
    language.readSource();
    language.expectFirstSyntaxProblemAt('Text', { line: 3, column: 26 });
});

it('locates a malformed later promise at its actual value', () => {
    const language = new SourceReading();
    language.sourceIs('type Marker {}\nconcept Library {\n capability save() {\n promises "first"\n promises true\n }\n}');
    language.readSource();
    language.expectFirstSyntaxProblemAt('true', { line: 5, column: 11 });
});

it('retains two independent missing-colon diagnostics', () => {
    const language = new SourceReading();
    language.sourceIs('type A {\n first Text\n}\ntype B {\n second Number\n}');
    language.readSource();
    language.expectSyntaxProblemTokens(['Text', 'Number']);
});
it('compiles the corrected relay without unresolved prerequisites', () => {
    const language = new CompilationExamples();
    language.source(relaySource.replace('retrns', 'returns'));
    language.compile();
    language.expectChecked();
});
