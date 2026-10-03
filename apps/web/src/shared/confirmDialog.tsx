import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";

export type ConfirmDialogTone = "default" | "danger";

export type ConfirmDialogOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmDialogTone;
};

export type ActiveConfirmDialogRequest = {
  id: string;
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  tone: ConfirmDialogTone;
};

type ConfirmDialogPresenter = (options: ConfirmDialogOptions) => Promise<boolean>;
type QueuedConfirmDialog = {
  request: ActiveConfirmDialogRequest;
  resolve: (confirmed: boolean) => void;
};

const ConfirmDialogContext = createContext<ConfirmDialogPresenter | null>(null);
let globalPresenter: ConfirmDialogPresenter | null = null;
let requestSequence = 0;

function normalizedConfirmDialogRequest(options: ConfirmDialogOptions): ActiveConfirmDialogRequest {
  requestSequence += 1;
  return {
    id: `confirm-dialog-${requestSequence}`,
    title: options.title,
    description: options.description,
    confirmText: options.confirmText ?? "Confirm",
    cancelText: options.cancelText ?? "Cancel",
    tone: options.tone ?? "default"
  };
}

export function fallbackConfirmText(options: ConfirmDialogOptions): string {
  return [options.title, options.description].filter(Boolean).join("\n\n");
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  if (globalPresenter) return globalPresenter(options);
  const fallbackConfirm = globalThis.confirm;
  if (typeof fallbackConfirm !== "function") return Promise.resolve(false);
  return Promise.resolve(fallbackConfirm(fallbackConfirmText(options)));
}

export function useConfirmDialog(): ConfirmDialogPresenter {
  const presenter = useContext(ConfirmDialogContext);
  return presenter ?? confirmDialog;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [activeDialog, setActiveDialog] = useState<QueuedConfirmDialog | null>(null);
  const activeDialogRef = useRef<QueuedConfirmDialog | null>(null);
  const queuedDialogsRef = useRef<QueuedConfirmDialog[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const settleDialog = useCallback((confirmed: boolean) => {
    const current = activeDialogRef.current;
    if (!current) return;
    current.resolve(confirmed);
    const next = queuedDialogsRef.current.shift() ?? null;
    activeDialogRef.current = next;
    setActiveDialog(next);

    // Confirmation is modal-only state; restore keyboard focus after the last queued dialog exits.
    if (!next) window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  const presentDialog = useCallback<ConfirmDialogPresenter>((options) => new Promise((resolve) => {
    const dialog: QueuedConfirmDialog = {
      request: normalizedConfirmDialogRequest(options),
      resolve
    };
    if (activeDialogRef.current) {
      queuedDialogsRef.current.push(dialog);
      return;
    }
    activeDialogRef.current = dialog;
    setActiveDialog(dialog);
  }), []);

  useEffect(() => {
    globalPresenter = presentDialog;
    return () => {
      if (globalPresenter === presentDialog) globalPresenter = null;
    };
  }, [presentDialog]);

  useEffect(() => () => {
    activeDialogRef.current?.resolve(false);
    for (const dialog of queuedDialogsRef.current.splice(0)) dialog.resolve(false);
  }, []);

  useEffect(() => {
    if (!activeDialog) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      settleDialog(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      const defaultButton = document.querySelector<HTMLElement>("[data-confirm-dialog-default='true']");
      defaultButton?.focus();
    });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDialog, settleDialog]);

  return (
    <ConfirmDialogContext.Provider value={presentDialog}>
      {children}
      {activeDialog && (
        <ConfirmDialogSurface
          request={activeDialog.request}
          onCancel={() => settleDialog(false)}
          onConfirm={() => settleDialog(true)}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function ConfirmDialogSurface({ request, onCancel, onConfirm }: { request: ActiveConfirmDialogRequest; onCancel: () => void; onConfirm: () => void }) {
  const titleId = `${request.id}-title`;
  const descriptionId = request.description ? `${request.id}-description` : undefined;
  const iconClassName = request.tone === "danger" ? "confirm-dialog-icon danger" : "confirm-dialog-icon";
  const Icon = request.tone === "danger" ? AlertTriangle : Info;
  const primaryClassName = request.tone === "danger" ? "btn danger confirm-dialog-primary" : "btn primary confirm-dialog-primary";

  return (
    <div className="confirm-dialog-backdrop">
      <section
        className={request.tone === "danger" ? "confirm-dialog danger" : "confirm-dialog"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <span className={iconClassName} aria-hidden="true"><Icon size={18} /></span>
        <div className="confirm-dialog-copy">
          <h2 id={titleId}>{request.title}</h2>
          {request.description && <p id={descriptionId}>{request.description}</p>}
        </div>
        <div className="confirm-dialog-actions">
          <button className="btn confirm-dialog-secondary" type="button" onClick={onCancel} data-confirm-dialog-default={request.tone === "danger" ? "true" : undefined}>
            {request.cancelText}
          </button>
          <button className={primaryClassName} type="button" onClick={onConfirm} data-confirm-dialog-default={request.tone === "danger" ? undefined : "true"}>
            {request.confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}
