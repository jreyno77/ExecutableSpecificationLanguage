/** Native document identity is separate from persistent specification subjects. */
export interface MarkdownPageMetadata {
  readonly outputId: string;
  readonly kind: 'home' | 'source';
  readonly key: string;
}

export const pageStart = (metadata: MarkdownPageMetadata): string =>
  '<!-- expec-page:' + Buffer.from(JSON.stringify({ outputId: metadata.outputId, kind: metadata.kind, key: metadata.key })).toString('hex') + ' -->';
export const pageEnd = (key: string): string => '<!-- expec-page-end:' + Buffer.from(key).toString('hex') + ' -->';
export const navigationStart = '<!-- expec-navigation -->';
export const navigationEnd = '<!-- expec-navigation-end -->';

/** A matching but malformed native marker is an error, never ordinary prose. */
export function readPageMetadata(text: string): MarkdownPageMetadata | undefined {
  const match = /^<!-- expec-page:([a-f0-9]+) -->$/.exec(text);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1]!, 'hex'), json = bytes.toString('utf8');
  if (bytes.toString('hex') !== match[1] || !Buffer.from(json).equals(bytes)) throw new Error('Invalid native page encoding.');
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native page metadata.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'key,kind,outputId'
    || typeof data.outputId !== 'string' || !data.outputId.trim()
    || data.kind !== 'home' && data.kind !== 'source'
    || typeof data.key !== 'string' || !data.key.trim()
    || data.kind === 'home' && data.key !== 'Home') throw new Error('Invalid native page metadata.');
  return { outputId: data.outputId, kind: data.kind, key: data.key };
}
