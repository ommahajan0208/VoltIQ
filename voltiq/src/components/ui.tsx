"use client";
import Link from "next/link";
import { ArrowRight, RefreshCw, TriangleAlert, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useRef } from "react";
import { number } from "@/lib/time";
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Metric({
  label,
  value,
  unit,
  detail,
  accent = false,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <section className={`metric ${accent ? "metric-accent" : ""}`}>
      <span>{label}</span>
      <div>
        {number(
          value,
          ["bins", "events", "rows", "min"].includes(unit ?? "") ? 0 : 2,
        )}{" "}
        <small>{value != null ? unit : ""}</small>
      </div>
      <p>{detail}</p>
    </section>
  );
}
export function Empty({
  title,
  children,
  href,
  action = "Set up a dataset",
}: {
  title: string;
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <TriangleAlert size={22} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {href && (
        <Link className="button primary" href={href}>
          {action}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function QueryState({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => unknown;
  };
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <div className="skeleton" aria-label="Loading panel" role="status">
        <span />
        <span />
        <span />
      </div>
    );
  if (query.isError)
    return (
      <div className="query-error" role="alert">
        <TriangleAlert size={20} />
        <p>{query.error?.message ?? "This panel could not load."}</p>
        <button className="button" onClick={() => query.refetch()}>
          <RefreshCw size={15} />
          Retry
        </button>
      </div>
    );
  return <>{children}</>;
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "cyan" | "amber" | "success" | "error";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement instanceof HTMLElement
              ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocus.current?.isConnected) return;
            event.preventDefault();
            returnFocus.current.focus();
            returnFocus.current = null;
          }}
        >
          <div className="dialog-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice">
      <TriangleAlert size={16} />
      <span>{children}</span>
    </p>
  );
}
