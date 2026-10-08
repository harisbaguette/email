import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, MoreHorizontal, X } from 'lucide-react';
import { Button, IconButton } from './controls';

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    const position = () => {
      const trigger = ref.current?.querySelector('summary');
      const menu = ref.current?.querySelector<HTMLElement>('.menu-list');
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const above = rect.top - 12;
      const below = innerHeight - rect.bottom - 12;
      const side = below < menu.scrollHeight && above > below ? 'top' : 'bottom';
      menu.dataset.side = side;
      menu.style.maxHeight = `${Math.max(44, (side === 'top' ? above : below) - 4)}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);
  return (
    <details
      className="action-menu"
      ref={ref}
      data-ui="action-menu"
      onToggle={() => {
        setOpen(Boolean(ref.current?.open));
        if (ref.current?.open)
          document.querySelectorAll<HTMLDetailsElement>('.action-menu[open]').forEach((menu) => {
            if (menu !== ref.current) menu.open = false;
          });
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          ref.current?.removeAttribute('open');
      }}
      onKeyDown={(event) => {
        const menu = ref.current!;
        if (event.key === 'Escape' && menu.open) {
          event.preventDefault();
          event.stopPropagation();
          menu.open = false;
          menu.querySelector('summary')?.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        menu.open = true;
        const items = [...menu.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'Home' || (index < 0 && event.key === 'ArrowDown')
            ? 0
            : event.key === 'End' || index < 0
              ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      <summary className="icon-button" aria-label={label} title={label}>
        <MoreHorizontal size={20} aria-hidden="true" />
      </summary>
      <div
        className="menu-list"
        onClick={(event) => {
          if (!(event.target as Element).closest('.menu-item:not(:disabled)')) return;
          // Restore focus before the action opens a dialog so its return target is visible.
          ref.current!.open = false;
          ref.current?.querySelector('summary')?.focus();
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function Modal({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdropPress = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus();
    return () => {
      dialog.close();
      if (trigger?.isConnected && !trigger.closest('[hidden]'))
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-ui="modal"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (!busy && backdropPress.current && event.target === event.currentTarget) onClose();
        backdropPress.current = false;
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="닫기" onClick={onClose} disabled={busy}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function Toast({
  text,
  undo,
  error,
  onDismiss,
}: {
  text: string;
  undo?: () => void;
  error?: boolean;
  onDismiss?: () => void;
}) {
  return (
    <div className="toast" role={error ? 'alert' : 'status'} data-ui="toast">
      {error ? (
        <CircleAlert size={18} aria-hidden="true" />
      ) : (
        <Check size={18} aria-hidden="true" />
      )}
      <span>{text}</span>
      {undo && (
        <Button variant="ghost" onClick={undo}>
          되돌리기
        </Button>
      )}
      {onDismiss && (
        <IconButton label="알림 닫기" onClick={onDismiss}>
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}
