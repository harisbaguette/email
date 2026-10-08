export const SEARCH_LIMIT = 500;
export const searchTokens = (query: string) => query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

export function validSearchDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftSearchDate(value: string, days: number) {
  if (!validSearchDate(value)) return '';
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  return validSearchDate(result) ? result : '';
}

export function searchFields(query: string) {
  const fields = { text: '', from: '', to: '', after: '', through: '', attachment: false };
  const rest: string[] = [];
  for (const token of searchTokens(query)) {
    const match = token.match(/^(from|to|after|before|has):(.+)$/i);
    const key = match?.[1].toLowerCase();
    const value = match?.[2].replace(/^"|"$/g, '') || '';
    if ((key === 'from' || key === 'to') && !fields[key]) fields[key] = value;
    else if (key === 'after' && !fields.after && validSearchDate(value)) fields.after = value;
    else if (key === 'before' && !fields.through && shiftSearchDate(value, -1)) fields.through = shiftSearchDate(value, -1);
    else if (key === 'has' && value === 'attachment' && !fields.attachment) fields.attachment = true;
    else rest.push(token);
  }
  fields.text = rest.join(' ');
  return fields;
}

export function searchQuery(fields: ReturnType<typeof searchFields>) {
  const quote = (value: string) => `"${value.trim().replaceAll('"', '')}"`;
  return [fields.text.trim(), fields.from.trim() && `from:${quote(fields.from)}`, fields.to.trim() && `to:${quote(fields.to)}`,
    fields.after && `after:${fields.after}`, fields.through && `before:${shiftSearchDate(fields.through, 1)}`, fields.attachment && 'has:attachment'].filter(Boolean).join(' ');
}
