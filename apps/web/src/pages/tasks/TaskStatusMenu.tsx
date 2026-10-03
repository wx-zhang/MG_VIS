import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { TaskRecord } from '@tyr-ai/contracts';
import { TASK_STATUSES } from './taskConstants';
import { taskStatusMenuLabel, taskStatusTitle } from './taskFormatters';

type TaskStatusMenuVariant = "default" | "summary";
type TaskStatusMenuPosition = {
  left: number;
  top: number;
  placement: "top" | "bottom";
};

const CARD_MENU_WIDTH = 156;
const CARD_MENU_GAP = 6;
const CARD_MENU_FALLBACK_HEIGHT = 146;

export function TaskStatusMenu({ value, onChange, prefix, variant = "default" }: { value: TaskRecord["status"]; onChange: (status: TaskRecord["status"]) => void; prefix?: string; variant?: TaskStatusMenuVariant }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<TaskStatusMenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const summary = variant === "summary";
  const controlClassName = summary ? "task-status-control summary" : "task-status-control";
  const buttonClassName = `task-status-button ${value}${summary ? " summary" : ""}`;
  const menuClassName = `task-status-menu ${summary ? "summary" : "card"}`;
  const label = summary ? taskStatusMenuLabel(value) : taskStatusTitle(value);

  function updateCardMenuPosition() {
    if (summary || !buttonRef.current || typeof window === "undefined") return;
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? CARD_MENU_WIDTH;
    const menuHeight = menuRef.current?.offsetHeight ?? CARD_MENU_FALLBACK_HEIGHT;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const canOpenBelow = buttonRect.bottom + CARD_MENU_GAP + menuHeight <= viewportHeight - CARD_MENU_GAP;
    const top = canOpenBelow
      ? buttonRect.bottom + CARD_MENU_GAP
      : Math.max(CARD_MENU_GAP, buttonRect.top - CARD_MENU_GAP - menuHeight);
    const left = Math.min(
      Math.max(CARD_MENU_GAP, buttonRect.right - menuWidth),
      Math.max(CARD_MENU_GAP, viewportWidth - menuWidth - CARD_MENU_GAP)
    );
    setMenuPosition({ left, top, placement: canOpenBelow ? "bottom" : "top" });
  }

  useLayoutEffect(() => {
    if (!open || summary) return;
    updateCardMenuPosition();
  }, [open, summary, value]);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    function closeMenu() {
      setOpen(false);
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [open]);

  const menuStyle: CSSProperties | undefined = summary
    ? undefined
    : {
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        visibility: menuPosition ? "visible" : "hidden"
      };
  const menu = (
    <div ref={menuRef} className={menuClassName} data-placement={!summary ? menuPosition?.placement : undefined} style={menuStyle}>
      {TASK_STATUSES.map(([status]) => (
        <button key={status} type="button" className={status === value ? "active" : ""} onClick={() => {
          setOpen(false);
          onChange(status);
        }}>
          <span>{status === value && <Check size={14} />}</span>
          {taskStatusMenuLabel(status)}
        </button>
      ))}
    </div>
  );

  return (
    <div className={controlClassName} onClick={(event) => event.stopPropagation()}>
      <button className={buttonClassName} type="button" aria-haspopup="menu" aria-expanded={open} ref={buttonRef} onClick={() => setOpen((current) => !current)}>
        <span className={`task-status-dot ${value}`} aria-hidden="true" />
        {prefix && <span className="task-status-prefix">{prefix}</span>}
        {label} <ChevronDown size={13} />
      </button>
      {open && (summary || typeof document === "undefined" ? menu : createPortal(menu, document.body))}
    </div>
  );
}
