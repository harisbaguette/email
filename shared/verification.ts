const labels = '(?:認証コード|確認コード|認証番号|인증\\s*(?:번호|코드)|확인\\s*(?:번호|코드)|보안\\s*코드|로그인\\s*(?:번호|코드)|(?:verification|security|confirmation|login|log-in|authentication|sign-in)\\s+code|one[- ]time\\s+(?:code|password|passcode)|OTP)';

/** Only explicitly labelled, unambiguous codes become a one-tap shortcut. */
export function verificationCode(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`.normalize('NFKC').replace(/https?:\/\/\S+/gi, '').replace(/[\u200b-\u200d\ufeff]/g, '');

  const token = '(?:[0-9]{2,4}[- ][0-9]{2,4}|[A-Z0-9]{2,4}-[A-Z0-9]{2,4}|[0-9](?:[ \\t][0-9]){3,7}|[A-Z0-9]{4,8})';
  const boundary = '(?![A-Za-z0-9]|[-/.][0-9])';
  const forward = new RegExp(`${labels}\\s*(?:(?:는|은|は|is)\\s*)?[:：=\\-]?\\s*(${token})${boundary}`, 'gi');
  const reverse = new RegExp(`(?:^|\\s)(${token})\\s+(?:is\\s+your\\s+${labels}|(?:인증\\s*(?:번호|코드)|認証コード))`, 'gi');
  const codes = new Set<string>();
  for (const match of [...text.matchAll(forward), ...text.matchAll(reverse)]) {
    const code = match[1].replace(/[ \t-]/g, '');
    if (code.length < 4 || code.length > 8 || !/\d/.test(code)) continue;
    if (/^\d{4}-\d{2}/.test(match[1])) continue;
    codes.add(code);
  }
  return codes.size === 1 ? [...codes][0] : null;
}

export function hasVerificationLabel(subject: string, body: string) {
  return new RegExp(labels, 'i').test(`${subject}\n${body}`.normalize('NFKC'));
}
