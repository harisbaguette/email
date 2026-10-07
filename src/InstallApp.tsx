import { useEffect, useState } from 'react';
import { Check, Download, Share, Smartphone } from 'lucide-react';
import { Modal } from './components';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let pendingPrompt: InstallPrompt | null = null;
const subscribers = new Set<() => void>();
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); pendingPrompt = event as InstallPrompt;
  subscribers.forEach(update => update());
});
window.addEventListener('appinstalled', () => { pendingPrompt = null; subscribers.forEach(update => update()); });

export function InstallApp({ compact = false }: { compact?: boolean }) {
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, update] = useState(0);
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  useEffect(() => {
    const refresh = () => update(v => v + 1);
    const installed = () => { setInstalled(true); setDialog(false); };
    subscribers.add(refresh); window.addEventListener('appinstalled', installed);
    return () => { subscribers.delete(refresh); window.removeEventListener('appinstalled', installed); };
  }, []);
  async function install() {
    if (!pendingPrompt) { setDialog(true); return; }
    setBusy(true);
    try {
      const prompt = pendingPrompt;
      await prompt.prompt();
      const result = await prompt.userChoice;
      pendingPrompt = null;
      if (result.outcome === 'accepted') setInstalled(true);
    } catch { setDialog(true); }
    finally { setBusy(false); }
  }
  if (installed) return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <><button className={compact ? 'install-button' : 'text-button install-login'} onClick={() => void install()} disabled={busy}>
    <Download size={17} /><span>{busy ? '설치 준비 중' : '앱 설치'}</span>{compact && <span className="install-caption">모바일과 PC</span>}</button>
    {dialog && <Modal title="Bluekite를 앱으로 설치" onClose={() => setDialog(false)}>
      <div className="install-preview"><img src="/brand/icon-192.png" alt="" width="58" height="58" /><div><strong>Bluekite Mail</strong><span>홈 화면에서 바로 여는 내 수신함</span></div></div>
      <ol className="install-steps">{ios ? <><li><Share size={18} /><span>Safari에서 이 사이트를 열고 <strong>공유</strong>를 누릅니다.</span></li><li><Smartphone size={18} /><span><strong>홈 화면에 추가</strong>를 선택합니다.</span></li></> : <><li><Download size={18} /><span>Chrome 주소창의 설치 아이콘이나 브라우저 메뉴를 엽니다.</span></li><li><Smartphone size={18} /><span><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택합니다.</span></li></>}
        <li><Check size={18} /><span>추가된 Bluekite 아이콘으로 수신함을 엽니다.</span></li></ol>
      <p className="field-hint">메일 확인에는 인터넷 연결이 필요합니다.</p>
      <div className="modal-actions"><button className="primary-button" onClick={() => setDialog(false)}>확인</button></div>
    </Modal>}
  </>;
}
