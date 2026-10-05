/** Replaces only exact generated lines inside an already identified native KDoc range. */
export function kotlinDocumentation(before: string, current: string, after: string): { start: number; end: number; text: string } | undefined {
  if (current === before) return { start: 0, end: current.length, text: after };
  const interior = (text: string) => {
    const start = text.indexOf('\n') + 1, end = text.lastIndexOf('\n');
    return text.startsWith('/**') && text.endsWith('*/') && start > 0 && end >= start ? { start, end, text: text.slice(start, end) } : undefined;
  };
  const actual = interior(current), prior = before && interior(before), next = after && interior(after);
  if (!actual || before && !prior || after && !next) return;
  if (!before) return { start: actual.end, end: actual.end, text: '\n' + (next ? next.text : '') };
  if (!prior) return;
  const needle = '\n' + prior.text + '\n', start = current.indexOf(needle);
  if (start < 0 || current.indexOf(needle, start + 1) >= 0) return;
  return { start: start + 1, end: start + 1 + prior.text.length, text: next ? next.text : '' };
}
