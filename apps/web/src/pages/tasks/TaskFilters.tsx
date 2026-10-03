import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { shouldCloseContextMenuForKey, shouldCloseContextMenuForPointerTarget } from '../../contextMenu';

export function TaskFilterMenu({ label, icon, count, options, selected, onToggle, onClear }: {
  label: string;
  icon: ReactElement;
  count: number;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      // 筛选菜单是浮层语义，点击浮层外任意区域应立即收起，避免多个筛选菜单叠在页面上。
      if (shouldCloseContextMenuForPointerTarget(menuRef.current, event.target)) setOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (shouldCloseContextMenuForKey(event.key)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
  return (
    <div ref={menuRef} className="task-filter-pop">
      <button className={count > 0 ? 'filter-button inline active' : 'filter-button inline'} onClick={() => setOpen((current) => !current)}>
        {icon} {label} {count > 0 && <span className="pill notice">{count}</span>} <ChevronDown size={14} />
      </button>
      {open && (
        <div className="task-filter-menu">
          <div className="task-filter-menu-head"><b>{label}</b><button onClick={onClear}>CLEAR</button></div>
          {options.length === 0 && <div className="task-filter-empty">No options</div>}
          {options.map((option) => (
            <button key={option.id} className={selected.includes(option.id) ? 'active' : ''} onClick={() => onToggle(option.id)}>
              <span>{option.label}</span>
              {selected.includes(option.id) && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
