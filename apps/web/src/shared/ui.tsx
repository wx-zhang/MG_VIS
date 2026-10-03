import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Bookmark, ChevronDown, LogOut, Mail, Menu, Moon, Plus, Search, Settings, Shield, Sun, UserRound, X } from "lucide-react";
import type { UserRecord } from "@tyr-ai/contracts";
import { applyThemeMode, nextThemeMode, persistThemeMode, readThemeMode } from "../themeMode";

export type WorkspaceTopBarProps = {
  currentUser: UserRecord;
  unreadCount: number;
  pendingApprovalCount: number;
  activeUtility: "search" | "inbox" | "saved" | null;
  onOpenSearch: () => void;
  onOpenInbox: () => void;
  onOpenSaved: () => void;
  onOpenApprovals: () => void;
  onOpenProfile: () => void;
  onLogoutRequest: () => void;
  onOpenMobileNav?: () => void;
  mobileNavOpen?: boolean;
  mode?: "workspace" | "operator";
  contextLabel?: string;
  hideAccountControls?: boolean;
};

export function TopBar({ title, currentUser, unreadCount, pendingApprovalCount, activeUtility, onOpenSearch, onOpenInbox, onOpenSaved, onOpenApprovals, onOpenProfile, onLogoutRequest, onOpenMobileNav, mobileNavOpen, mode = "workspace", contextLabel, hideAccountControls = false, className = "topbar" }: { title: ReactNode; className?: string } & WorkspaceTopBarProps) {
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountControlRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    applyThemeMode(themeMode);
    persistThemeMode(themeMode);
  }, [themeMode]);
  useEffect(() => {
    if (!accountMenuOpen) return;
    function closeAccountMenu(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && accountControlRef.current?.contains(event.target as Node)) return;
      setAccountMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeAccountMenu);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeAccountMenu);
    };
  }, [accountMenuOpen]);
  const ThemeIcon = themeMode === "dark" ? Sun : Moon;
  const avatarLabel = currentUser.displayName || currentUser.name || "User profile";
  function openAccountControl() {
    // 窄屏把低频系统操作集中到头像菜单；桌面端继续直接进入 Settings。
    if (window.matchMedia("(max-width: 520px)").matches) {
      setAccountMenuOpen((open) => !open);
      return;
    }
    onOpenProfile();
  }
  return (
    <header className={className}>
      {onOpenMobileNav && (
        <button className="icon-btn top-mobile-menu-button" type="button" onClick={onOpenMobileNav} title="Open workspace navigation" aria-label="Open workspace navigation" aria-expanded={Boolean(mobileNavOpen)}>
          <Menu size={18} />
        </button>
      )}
      <div className="top-title"><h1>{title}</h1></div>
      <div className="top-actions">
        {mode === "workspace" && <nav className="top-utility-dock" aria-label="Workspace tools">
          <button className={activeUtility === "search" ? "top-utility-button active" : "top-utility-button"} type="button" onClick={onOpenSearch} title="Search · ⌘K" aria-label="Open Search" aria-current={activeUtility === "search" ? "page" : undefined}>
            <Search size={16} />
          </button>
          <button className={activeUtility === "inbox" ? "top-utility-button active" : "top-utility-button"} type="button" onClick={onOpenInbox} title="Open Inbox" aria-label={unreadCount > 0 ? `Open Inbox, ${unreadCount} unread` : "Open Inbox"} aria-current={activeUtility === "inbox" ? "page" : undefined}>
            <Mail size={17} />
            {unreadCount > 0 && <em className="top-utility-badge">{unreadCount > 99 ? "99+" : unreadCount}</em>}
          </button>
          <button className={activeUtility === "saved" ? "top-utility-button active" : "top-utility-button"} type="button" onClick={onOpenSaved} title="Open Saved" aria-label="Open Saved" aria-current={activeUtility === "saved" ? "page" : undefined}>
            <Bookmark size={16} />
          </button>
        </nav>}
        {mode === "workspace" && <span className="top-actions-divider" aria-hidden="true" />}
        <div className="top-system-actions">
          {mode === "workspace" && <button className={pendingApprovalCount > 0 ? "icon-btn top-approvals-button has-approvals" : "icon-btn top-approvals-button"} type="button" onClick={onOpenApprovals} title="Open approvals" aria-label={pendingApprovalCount > 0 ? `Open approvals, ${pendingApprovalCount} pending` : "Open approvals"}>
            <Shield size={17} />
            {pendingApprovalCount > 0 && <em>{pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}</em>}
          </button>}
          <button className="icon-btn top-theme-toggle" onClick={() => setThemeMode((mode) => nextThemeMode(mode))} title={themeMode === "dark" ? "Use light mode" : "Use dark mode"} aria-label={themeMode === "dark" ? "Use light mode" : "Use dark mode"}>
            <ThemeIcon size={17} />
          </button>
        </div>
        {contextLabel && <span className="top-context-label">{contextLabel}</span>}
        {!hideAccountControls && <div className="top-account-control" ref={accountControlRef}>
          <button className="top-avatar-button" type="button" disabled={mode === "operator"} onClick={mode === "workspace" ? openAccountControl : undefined} title={mode === "workspace" ? "Account and settings" : "Operator session"} aria-label={mode === "workspace" ? "Account and settings" : "Operator session"} aria-haspopup={mode === "workspace" ? "menu" : undefined} aria-expanded={mode === "workspace" ? accountMenuOpen : undefined}>
            {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt={avatarLabel} /> : <UserRound size={17} />}
          </button>
          {mode === "workspace" && accountMenuOpen && (
            <div className="top-account-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onOpenApprovals(); }}><Shield size={16} /><span>Approvals</span>{pendingApprovalCount > 0 && <em>{pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}</em>}</button>
              <button type="button" role="menuitem" onClick={() => setThemeMode((mode) => nextThemeMode(mode))}><ThemeIcon size={16} /><span>{themeMode === "dark" ? "Light mode" : "Dark mode"}</span></button>
              <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onOpenProfile(); }}><Settings size={16} /><span>Settings</span></button>
              <button className="danger" type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onLogoutRequest(); }}><LogOut size={16} /><span>Log out</span></button>
            </div>
          )}
        </div>}
        {!hideAccountControls && <button className="icon-btn top-logout-button" type="button" onClick={onLogoutRequest} title="Log out" aria-label="Log out">
          <LogOut size={17} />
        </button>}
      </div>
    </header>
  );
}

export function InfoBlock({ title, value, editable, muted }: { title: string; value: string; editable?: boolean; muted?: boolean }) {
  return (
    <div className="info-block">
      <h3>{title} {editable && <span>✎</span>}</h3>
      <p className={muted ? "muted-text" : ""}>{value}</p>
    </div>
  );
}

export function Placeholder({ title, text }: { title: string; text: string }) {
  return <div className="placeholder"><h2>{title}</h2><p>{text}</p></div>;
}

export function EmptyState({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="empty-state">
      <h1>{title}</h1>
      <button className="btn primary" onClick={onAction}><Plus size={16} /> {action}</button>
    </div>
  );
}

export function SelectControl({ wrapperClassName = "", className = "", children, ...props }: ComponentPropsWithoutRef<"select"> & { wrapperClassName?: string }) {
  const shellClassName = wrapperClassName ? `select-control-shell ${wrapperClassName}` : "select-control-shell";
  const selectClassName = className ? `select-control ${className}` : "select-control";
  return (
    <span className={shellClassName}>
      <select className={selectClassName} {...props}>{children}</select>
      <ChevronDown size={14} aria-hidden="true" focusable="false" />
    </span>
  );
}

export function Modal({ title, onClose, children, className = "", backdropClassName = "", titleIcon, titleAction }: { title: string; onClose: () => void; children: ReactNode; className?: string; backdropClassName?: string; titleIcon?: ReactNode; titleAction?: ReactNode }) {
  const modalClassName = className ? `modal ${className}` : "modal";
  const backdropClassNames = backdropClassName ? `modal-backdrop ${backdropClassName}` : "modal-backdrop";
  return (
    <div className={backdropClassNames}>
      <div className={modalClassName}>
        <div className="modal-head">
          <h2>{titleIcon && <span className="modal-title-icon">{titleIcon}</span>}<span className="modal-title-text">{title}</span></h2>
          {titleAction && <div className="modal-title-action">{titleAction}</div>}
          <button className="icon-btn" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionLabel({ label }: { label: string }) {
  return <div className="section-label">{label}</div>;
}
