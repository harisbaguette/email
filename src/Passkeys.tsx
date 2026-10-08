import { useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Trash2 } from 'lucide-react';
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { Button, Field, IconButton, Modal, Notice, TextInput } from './ui';
import { ApiError, api, errorMessage } from './api';
import { normalizeAuthCode } from '../shared/auth-code';
import { supportsPasskeys, passkeyError } from './passkey-client';

interface Passkey {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}
interface Status {
  passkeys: Passkey[];
  reauthenticationRequired: boolean;
}

export function Passkeys({ active, twoFactor }: { active: boolean; twoFactor: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [dialog, setDialog] = useState<'add' | Passkey | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const supported = supportsPasskeys();
  async function load() {
    try {
      setStatus(await api<Status>('/api/passkeys'));
      setError('');
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  useEffect(() => {
    if (active) void load();
  }, [active]);
  function close() {
    setDialog(null);
    setPassword('');
    setCode('');
    setError('');
  }
  async function add() {
    if (busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
        '/api/passkeys/register/options',
        {
          method: 'POST',
          body: JSON.stringify({ password, code }),
        },
      );
      const credential = await startRegistration({ optionsJSON });
      await api('/api/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });
      close();
      await load();
      setFeedback('등록됐습니다. 다음부터 기기 잠금으로 로그인하세요.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 428) {
        setReauthenticate(true);
        setDialog('add');
      } else setError(passkeyError(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!dialog || dialog === 'add' || busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api('/api/passkeys/' + dialog.id, {
        method: 'DELETE',
        body: JSON.stringify({ password, code }),
      });
      close();
      await load();
      setFeedback('패스키를 삭제했습니다. 다른 기기는 로그아웃됐습니다.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 428) setReauthenticate(true);
      else setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="passkeys" aria-label="패스키">
      <div className="preference-row">
        <div>
          <strong>기기 잠금으로 로그인</strong>
          <p>
            {supported
              ? '지문·얼굴·PIN으로 빠르게. 인증 앱은 필요 없습니다.'
              : '지원하는 브라우저에서 패스키를 추가할 수 있습니다.'}
          </p>
        </div>
        <Button
          variant={status?.passkeys.length ? 'secondary' : 'primary'}
          disabled={!status || !supported || busy}
          onClick={() => {
            setError('');
            setFeedback('');
            if (status?.reauthenticationRequired) {
              setReauthenticate(true);
              setDialog('add');
            } else void add();
          }}
        >
          <Fingerprint size={18} />
          {busy && !dialog ? '기기 확인 중…' : '패스키 추가'}
        </Button>
      </div>
      {!!status?.passkeys.length && (
        <ul className="passkey-list">
          {status.passkeys.map((key) => (
            <li key={key.id}>
              <KeyRound size={18} aria-hidden="true" />
              <div>
                <strong>{key.name}</strong>
                <span>{new Date(key.created_at).toLocaleDateString('ko-KR')} 등록</span>
              </div>
              <IconButton
                label={`${key.name} 패스키 삭제`}
                tone="danger"
                disabled={busy}
                onClick={() => {
                  setDialog(key);
                  setReauthenticate(Boolean(status.reauthenticationRequired));
                  setError('');
                  setPassword('');
                  setCode('');
                }}
              >
                <Trash2 size={17} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {error && !dialog && (
        <Notice tone="error">
          {error}
          {!status && (
            <Button variant="ghost" onClick={() => void load()}>
              다시 시도
            </Button>
          )}
        </Notice>
      )}
      {feedback && <Notice tone="success">{feedback}</Notice>}
      {dialog && (
        <Modal
          title={dialog === 'add' ? '패스키 추가' : '패스키를 삭제할까요?'}
          busy={busy}
          onClose={close}
        >
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              void (dialog === 'add' ? add() : remove());
            }}
          >
            {dialog !== 'add' && (
              <p>이 패스키로 로그인할 수 없게 되며 다른 기기는 로그아웃됩니다.</p>
            )}
            {reauthenticate && (
              <>
                <Field label="현재 비밀번호" id="passkey-password">
                  <TextInput
                    id="passkey-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                {twoFactor && (
                  <Field label="인증 앱 코드 또는 복구 코드" id="passkey-otp">
                    <TextInput
                      id="passkey-otp"
                      autoComplete="one-time-code"
                      maxLength={64}
                      required
                      value={code}
                      onChange={(e) => setCode(normalizeAuthCode(e.target.value))}
                    />
                  </Field>
                )}
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <div className="modal-actions">
              <Button
                variant="secondary"
                disabled={busy}
                data-dialog-autofocus={dialog !== 'add' && !reauthenticate ? true : undefined}
                onClick={close}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant={dialog === 'add' ? 'primary' : 'danger'}
                disabled={busy}
              >
                {busy ? '확인 중…' : dialog === 'add' ? '기기 확인' : '삭제'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
