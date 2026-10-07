import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
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

export function InstallApp() {
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
  return <><button className="text-button install-login" onClick={() => void install()} disabled={busy}>
    <Download size={17} /><span>{busy ? '설치 준비 중' : '앱 설치'}</span></button>
    {dialog && <Modal title="앱 설치" onClose={() => setDialog(false)}>
      <ol className="install-steps">{ios ? <><li>Safari의 <strong>공유</strong> 메뉴를 엽니다.</li><li><strong>홈 화면에 추가</strong>를 선택합니다.</li></> : <><li>Chrome 메뉴를 엽니다.</li><li><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택합니다.</li></>}</ol>
      <div className="modal-actions"><button className="primary-button" onClick={() => setDialog(false)}>확인</button></div>
    </Modal>}
  </>;
}
