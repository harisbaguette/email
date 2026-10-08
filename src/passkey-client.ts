import { browserSupportsWebAuthn } from '@simplewebauthn/browser';

export function supportsPasskeys() {
  return (
    window.isSecureContext &&
    !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(window.location.hostname) &&
    browserSupportsWebAuthn()
  );
}
export function passkeyError(error: unknown) {
  if (error instanceof Error) {
    const name = error.cause instanceof Error ? error.cause.name : error.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return '';
    if (name === 'InvalidStateError') return '이 기기의 패스키가 이미 등록돼 있습니다.';
    if (name === 'NotSupportedError' || name === 'ConstraintError')
      return '이 기기에서는 패스키를 사용할 수 없습니다. 비밀번호로 로그인해 주세요.';
    // Browser errors may include implementation details or credential information.
    if (error.name !== 'ApiError' && error.name !== 'Error')
      return '기기 확인을 완료하지 못했습니다. 다시 시도해 주세요.';
    return error.message;
  }
  return '기기 확인을 완료하지 못했습니다. 다시 시도해 주세요.';
}
