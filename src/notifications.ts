import { api } from './api';
export type PushMode = 'verification' | 'inbox';
export interface PushDevice { id: string; mode: PushMode; preview: number }
export interface PushStatus { configured: boolean; publicKey: string; devices: PushDevice[] }
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const needsHomeScreen = () => (/iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  && !matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone;
export function pushId() { try { return localStorage.getItem('bluekite-push-id') || ''; } catch { return ''; } }
export function rememberPush(id: string) { try { if (id) localStorage.setItem('bluekite-push-id', id); else localStorage.removeItem('bluekite-push-id'); } catch {} }
export async function subscriptionId(subscription: PushSubscription) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function applicationKey(raw: string) { return Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)); }
export async function enablePush(publicKey: string, mode: PushMode, preview: boolean) {
  // Request permission directly from the click, before awaiting network or the worker.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? '브라우저에서 알림이 차단되었습니다. 사이트 설정에서 허용해 주세요.' : '알림 허용을 선택하면 연결할 수 있습니다.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const created = !subscription;
  if (!subscription) {
    try { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey) }); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('알림을 연결하지 못했습니다. 시크릿 창이라면 일반 창에서 다시 시도해 주세요.');
      throw new Error('알림 서비스에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    }
  }
  try {
    const result = await api<{ id: string }>('/api/push', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON(), mode, preview }) });
    rememberPush(result.id); return { id: result.id, mode, preview: Number(preview) };
  } catch (error) { if (created) await subscription.unsubscribe().catch(() => {}); throw error; }
}
export async function disablePush(id: string) {
  await api(`/api/push/${id}`, { method: 'DELETE' });
  rememberPush('');
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
}
export async function logout() {
  await api('/api/logout', { method: 'POST', body: JSON.stringify({ pushId: pushId() }) });
  rememberPush('');
  try { const registration = await navigator.serviceWorker.getRegistration(); await (await registration?.pushManager.getSubscription())?.unsubscribe(); } catch {}
}
