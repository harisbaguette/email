import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

const cx = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(' ');
export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'row' | 'navigation';
const buttonClasses: Record<ButtonVariant, string> = {
  primary: 'primary-button',
  secondary: 'secondary-button',
  ghost: 'text-button',
  danger: 'danger-button',
  'danger-ghost': 'text-button danger-text',
  row: 'row-button',
  navigation: 'navigation-button',
};
type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant; busy?: boolean };

/** Submit actions must explicitly set type="submit". */
export function Button({
  variant = 'secondary',
  type = 'button',
  busy,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      data-dialog-autofocus={props.autoFocus || undefined}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        props.onClick?.(event);
      }}
      data-ui="button"
      className={cx('ui-button', buttonClasses[variant], className)}
    />
  );
}

export function IconButton({
  label,
  tone,
  busy,
  disabled,
  className,
  type = 'button',
  ...props
}: Omit<ButtonProps, 'variant' | 'aria-label'> & { label: string; tone?: 'danger' }) {
  return (
    <button
      {...props}
      type={type}
      title={props.title ?? label}
      aria-label={label}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        props.onClick?.(event);
      }}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-ui="icon-button"
      className={cx('icon-button', tone === 'danger' && 'danger-hover', className)}
    />
  );
}

export function ButtonLink({
  variant = 'secondary',
  className,
  ...props
}: ComponentProps<'a'> & { variant?: ButtonVariant }) {
  return (
    <a
      {...props}
      data-ui="button-link"
      className={cx('ui-button', buttonClasses[variant], className)}
    />
  );
}

const FieldContext = createContext<{ id: string; describedBy?: string; invalid?: boolean } | null>(
  null,
);
export function Field({
  label,
  hint,
  error,
  children,
  id: suppliedId,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  id?: string;
}) {
  const generated = useId();
  const id = suppliedId || generated;
  const describedBy =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
        {children}
      </FieldContext.Provider>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <Notice tone="error" id={`${id}-error`}>
          {error}
        </Notice>
      )}
    </div>
  );
}

export function TextInput({
  className,
  autoFocus,
  'data-dialog-autofocus': dialogFocus,
  ...props
}: ComponentProps<'input'> & { 'data-dialog-autofocus'?: boolean }) {
  const field = useContext(FieldContext);
  return (
    <input
      id={field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      {...props}
      autoFocus={autoFocus}
      data-dialog-autofocus={autoFocus || dialogFocus || undefined}
      data-ui="input"
      className={cx('ui-input', className)}
    />
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input {...props} type="checkbox" data-ui="checkbox" className={cx('ui-checkbox', className)} />
  );
}

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'onChange' | 'role' | 'aria-checked'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      data-ui="switch"
      className={cx('toggle', className)}
    >
      <span />
    </button>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      {...props}
      type="button"
      data-ui="menu-item"
      className={cx('menu-item', className)}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        props.onClick?.(event);
      }}
    />
  );
}
export function MenuLink({ className, ...props }: ComponentProps<'a'>) {
  return <a {...props} data-ui="menu-item" className={cx('menu-item', className)} />;
}

export function Notice({
  tone = 'info',
  className,
  children,
  ...props
}: ComponentProps<'div'> & { tone?: 'info' | 'error' | 'success' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      {...props}
      data-ui="notice"
      className={cx('ui-notice', `notice-${tone}`, className)}
    >
      {children}
    </div>
  );
}

export function LoadingState({ children = '불러오는 중…' }: { children?: ReactNode }) {
  return (
    <div className="list-loading" role="status" data-ui="loading">
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" data-ui="empty-state">
      {icon}
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function Disclosure({
  summary,
  children,
  className,
  ...props
}: Omit<ComponentProps<'details'>, 'children'> & { summary: ReactNode; children: ReactNode }) {
  return (
    <details {...props} data-ui="disclosure" className={cx('ui-disclosure', className)}>
      <summary>
        {summary}
        <ChevronRight size={16} aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'blue' | 'green' | 'purple' | 'amber' }) {
  return <span {...props} data-ui="badge" className={cx('ui-badge', `badge-${tone}`, className)} />;
}

export function SearchField({
  label,
  icon,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'aria-label'> & { label: string; icon: ReactNode }) {
  return (
    <div className={cx('search-field', className)}>
      {icon}
      <TextInput {...props} type="search" aria-label={label} />
    </div>
  );
}
