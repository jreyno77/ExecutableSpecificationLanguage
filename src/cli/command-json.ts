const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function privateBodyFacts(value: unknown, observation = false): unknown {
  if (!record(value) || (value.path !== '.expec/build-transition.json' && value.path !== '.expec/build-pending.json')
    || !(value.bytes instanceof Uint8Array) || !(observation ? value.state === 'file' && typeof value.version === 'string' : value.kind === 'write')) return value;
  const facts = { ...value }; delete facts.bytes; return facts;
}
function receiptFacts(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.outcomes)) return value;
  return { ...value, outcomes: value.outcomes.map(outcome => !record(outcome) ? outcome : { ...outcome,
    change: privateBodyFacts(outcome.change),
    before: Array.isArray(outcome.before) ? outcome.before.map(item => privateBodyFacts(item, true)) : outcome.before,
    after: Array.isArray(outcome.after) ? outcome.after.map(item => privateBodyFacts(item, true)) : outcome.after,
  }) };
}

export function commandJson(value: unknown): string {
  const facts = !record(value) || !Array.isArray(value.stages) ? value : { ...value, stages: value.stages.map(stage => !record(stage) ? stage : {
    ...stage, receipt: receiptFacts(stage.receipt), journal: receiptFacts(stage.journal), write: receiptFacts(stage.write),
    initialization: record(stage.initialization) ? { ...stage.initialization, write: receiptFacts(stage.initialization.write) } : stage.initialization,
  }) };
  return JSON.stringify(facts, function (key, value: unknown) {
    const original = key ? this[key] as unknown : value;
    return original instanceof Uint8Array ? { encoding: 'base64', data: Buffer.from(original).toString('base64') } : value;
  });
}
