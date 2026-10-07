/** Offer a shortcut only when a mail explicitly labels one unambiguous numeric code. */
export function verificationCode(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`.replace(/https?:\/\/\S+/gi, '');
  const labels = '(?:認証コード|確認コード|認証番号|인증\\s*(?:번호|코드)|확인\\s*(?:번호|코드)|보안\\s*코드|verification\\s+code|security\\s+code|confirmation\\s+code|one[- ]time\\s+(?:code|password|passcode)|OTP)';
  const forward = new RegExp(`${labels}\\s*(?:(?:는|은|は|is)\\s*)?[:：=\\-]?\\s*([0-9]{4,8})(?![A-Za-z0-9]|[-/.][0-9])`, 'gi');
  const reverse = new RegExp(`(?:^|\\s)([0-9]{4,8})\\s+is\\s+your\\s+${labels}`, 'gi');
  const codes = new Set([...text.matchAll(forward), ...text.matchAll(reverse)].map(match => match[1]));
  return codes.size === 1 ? [...codes][0] : null;
}
