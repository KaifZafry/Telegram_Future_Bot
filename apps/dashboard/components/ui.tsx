"use client";

import { Loader2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

export const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

export const Card = ({
  title,
  description,
  action,
  children,
  className,
  bodyClassName
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) => (
  <section className={cn("rounded-xl border border-border bg-surface", className)}>
    {(title || action) && (
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
      </header>
    )}
    <div className={cn("p-5", bodyClassName)}>{children}</div>
  </section>
);

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90",
  secondary: "border border-border-strong bg-surface-2 text-text hover:bg-surface-3",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  danger: "bg-loss/15 text-loss-text border border-loss/40 hover:bg-loss/25"
};

export const Button = ({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}) => (
  <button
    type="button"
    {...props}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cn(
      "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
      buttonStyles[variant],
      className
    )}
  >
    {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
    {children}
  </button>
);

export type Tone = "neutral" | "accent" | "gain" | "loss" | "warn";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-surface-3 text-text-2",
  accent: "bg-accent/15 text-accent-text",
  gain: "bg-gain/15 text-gain-text",
  loss: "bg-loss/15 text-loss-text",
  warn: "bg-warn/15 text-warn"
};

export const Badge = ({
  tone = "neutral",
  icon,
  children,
  className
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
      toneStyles[tone],
      className
    )}
  >
    {icon}
    {children}
  </span>
);

export const SideBadge = ({ side }: { side?: "LONG" | "SHORT" }) =>
  side ? (
    <Badge tone={side === "LONG" ? "gain" : "loss"}>{side === "LONG" ? "▲ Long" : "▼ Short"}</Badge>
  ) : (
    <span className="text-muted">—</span>
  );

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-md bg-surface-3/70", className)} aria-hidden />
);

export const EmptyState = ({
  icon,
  title,
  children,
  action
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
    <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted" aria-hidden>
      {icon}
    </div>
    <p className="text-sm font-medium text-text">{title}</p>
    {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => (
  <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
    <p className="text-sm text-loss-text">
      {error instanceof Error ? error.message : "Something went wrong"}
    </p>
    {onRetry && (
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

export const Toggle = ({
  checked,
  onChange,
  label,
  disabled,
  tone = "accent"
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: "accent" | "gain";
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
      checked
        ? tone === "gain"
          ? "border-gain bg-gain"
          : "border-accent bg-accent"
        : "border-border-strong bg-surface-3"
    )}
  >
    <span
      className={cn(
        "inline-block size-4 rounded-full bg-white shadow transition-transform duration-200",
        checked ? "translate-x-6" : "translate-x-1"
      )}
    />
  </button>
);

export const Field = ({
  label,
  help,
  error,
  suffix,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  help?: string;
  error?: string;
  suffix?: string;
}) => {
  const id = useId();
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-text-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...props}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            "num h-10 w-full rounded-lg border bg-bg px-3 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:outline-none",
            error ? "border-loss" : "border-border-strong",
            suffix && "pr-14"
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
            {suffix}
          </span>
        )}
      </div>
      {help && !error && (
        <p id={`${id}-help`} className="mt-1 text-xs text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-loss-text">
          {error}
        </p>
      )}
    </div>
  );
};

/**
 * Modal shell: Escape and backdrop close it, focus moves inside on open.
 * Rendered into <body> so ancestors with transforms or backdrop filters (the
 * sticky header) cannot clip it.
 */
export const Modal = ({
  open,
  onClose,
  title,
  children,
  wide = false
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "[data-autofocus], button, input, textarea, select"
    );
    focusable?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-border-strong bg-surface shadow-2xl",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export const ConfirmDialog = ({
  open,
  title,
  children,
  confirmLabel,
  loading,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <Modal open={open} onClose={onCancel} title={title}>
    <div className="text-sm text-text-2">{children}</div>
    <div className="mt-6 flex justify-end gap-2">
      <Button data-autofocus onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="danger" loading={loading} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  </Modal>
);

export const PageHeader = ({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
    {action}
  </div>
);
