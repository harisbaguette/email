import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

type Option<T extends string> = { value: T; label: string; icon?: ReactNode; separator?: boolean };

export function Select<T extends string>({ id, label, value, options, onChange, disabled, autoFocus, variant = 'field' }: {
  id?: string;
  label?: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  variant?: 'field' | 'folder';
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Native dialogs occupy the top layer. Keep their menus inside that layer.
  const [container, setContainer] = useState<HTMLElement | undefined>();
  useLayoutEffect(() => {
    if (!open || container) return;
    // Radix traps focus and hides the app from screen readers. Also make the
    // background inert so hidden controls cannot receive programmatic focus.
    const root = trigger.current?.closest<HTMLElement>('#root');
    if (!root) return;
    const wasInert = root.inert; root.inert = true;
    return () => { root.inert = wasInert; };
  }, [open, container]);
  const selected = options.find(option => option.value === value);
  return <SelectPrimitive.Root value={value} onValueChange={next => onChange(next as T)} disabled={disabled} open={open} onOpenChange={next => {
    if (next) setContainer(trigger.current?.closest('dialog') || undefined);
    setOpen(next);
  }}>
    <SelectPrimitive.Trigger ref={trigger} id={id} aria-label={label} autoFocus={autoFocus} data-dialog-autofocus={autoFocus || undefined} className={`select-trigger ${variant === 'folder' ? 'folder-picker' : ''}`}>
      {variant === 'folder' && <span className="select-value-icon" aria-hidden="true">{selected?.icon}</span>}
      <SelectPrimitive.Value />
      <SelectPrimitive.Icon className="select-chevron"><ChevronDown size={16} aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content className={`select-menu ${variant === 'folder' ? 'folder-menu' : ''}`} position="popper" sideOffset={8} collisionPadding={12} collisionBoundary={container} onEscapeKeyDown={event => {
        event.preventDefault(); event.stopPropagation(); setOpen(false);
      }}>
        <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp size={16} /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="select-options">
          {options.map(option => <Fragment key={option.value}>
            {option.separator && <SelectPrimitive.Separator className="select-separator" />}
            <SelectPrimitive.Item value={option.value} textValue={option.label} className="select-option">
              {option.icon && <span className="select-option-icon" aria-hidden="true">{option.icon}</span>}
              <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator className="select-check"><Check size={15} strokeWidth={2.5} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>
          </Fragment>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown size={16} /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
