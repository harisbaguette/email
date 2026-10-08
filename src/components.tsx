import { Field, Button, IconButton, Notice, TextInput, EmptyState as UIEmptyState } from './ui';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Fingerprint } from 'lucide-react';
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { supportsPasskeys, passkeyError } from './passkey-client';
import { ApiError, api, errorMessage } from './api';
import { normalizeAuthCode } from '../shared/auth-code';

export function Brand() {
  return (
    <div className="brand" aria-label="Mailroom">
      <img className="brand-symbol" src="/brand/symbol.svg" alt="" width="42" height="42" />
      <span className="brand-wordmark">mailroom</span>
    </div>
  );
}

export function Login({
  onLogin,
  initialError,
  passkeysAvailable,
}: {
  onLogin: () => void;
  initialError?: string;
  passkeysAvailable?: boolean;
}) {
  const canPasskey = Boolean(passkeysAvailable && supportsPasskeys());
  const [passwordOpen, setPasswordOpen] = useState(!canPasskey);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [code, setCode] = useState('');
  const [secondFactor, setSecondFactor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');
  async function signInWithPasskey() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>(
        '/api/passkeys/login/options',
        { method: 'POST', body: '{}' },
      );
      const credential = await startAuthentication({ optionsJSON });
      await api('/api/passkeys/login/verify', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });
      onLogin();
    } catch (error) {
      setError(passkeyError(error));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, code }),
      });
      onLogin();
    } catch (error) {
      if (error instanceof ApiError && error.status === 428) {
        setSecondFactor(true);
        setError('');
      } else {
        setError(errorMessage(error));
        if (secondFactor) {
          setCode('');
          requestAnimationFrame(() => document.getElementById('login-code')?.focus());
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <Brand />
        <h1>로그인</h1>
        {canPasskey && (
          <div className="passkey-login">
            <Button
              variant={passwordOpen ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => void signInWithPasskey()}
            >
              <Fingerprint size={20} />
              {busy ? '기기 확인 중…' : '기기 잠금으로 로그인'}
            </Button>
            {!passwordOpen && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPasswordOpen(true);
                  setError('');
                }}
              >
                비밀번호로 로그인
              </Button>
            )}
          </div>
        )}
        {!passwordOpen && error && <Notice tone="error">{error}</Notice>}
        {passwordOpen && (
          <form onSubmit={submit}>
            <Field label="아이디" id="username">
              <TextInput
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                maxLength={64}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label="비밀번호" id="password">
              <div className="password-field">
                <TextInput
                  id="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <IconButton
                  type="button"
                  onClick={() => setVisible((value) => !value)}
                  label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </div>
            </Field>
            {secondFactor && (
              <>
                <Field label="인증 앱 코드 또는 복구 코드" id="login-code">
                  <TextInput
                    id="login-code"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(normalizeAuthCode(event.target.value))}
                    required
                    maxLength={64}
                  />
                </Field>
              </>
            )}
            {error && (
              <Notice tone="error" id="login-error">
                {error}
              </Notice>
            )}
            <Button type="submit" variant="primary" className="login-submit" disabled={busy}>
              {busy ? '확인 중…' : '로그인'}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmptyState({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <UIEmptyState
      title={query ? '검색 결과가 없습니다' : '메일이 없습니다'}
      icon={<img src="/brand/symbol.svg" alt="" width="40" height="40" />}
      action={
        onClear && (
          <Button variant="ghost" onClick={onClear}>
            검색 지우기
          </Button>
        )
      }
    />
  );
}
