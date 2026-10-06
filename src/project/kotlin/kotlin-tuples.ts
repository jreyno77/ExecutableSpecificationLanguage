/** The same ordinary tuple carrier is emitted by contracts and standalone test data. */
export function kotlinTuple(packageName: string, arity: number): string {
  const indices = Array.from({ length: arity }, (_, index) => index + 1);
  return 'package ' + packageName + '\n\n/**\n * Number profile: finite binary64 (Kotlin Double).\n */\ndata class Tuple' + arity
    + '<' + indices.map(index => 'T' + index).join(', ') + '>(' + indices.map(index => 'var item' + index + ': T' + index).join(', ') + ')\n';
}
