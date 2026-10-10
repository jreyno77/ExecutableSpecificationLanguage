const keywords = new Set('use from include concept component class interface depends on requires package for build runtime test public construction capability function returns local extend type opaque examples fixture setup action observation check scenario given when then example satisfies interaction participant message as let do return assert promises ensures or and not true false'.split(' '));

/** The language's ordinary or quoted spelling for one decoded name. */
export function nameText(value: string): string {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(value) && !keywords.has(value) ? value : '`' + value.replace(/[\\`]/g, '\\$&') + '`';
}
