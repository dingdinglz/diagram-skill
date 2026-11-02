import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from './icons';
import { motion } from 'motion/react';
import { useReducedMotion } from './ui/useReducedMotion';
import { UI_TRANSITION } from './ui/Motion';

export type DialogProps = {
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  labelledBy: string;
  className?: string;
};

const focusableSelector = [
  'a[href]', 'area[href]', 'button', 'input:not([type="hidden"])',
  'select', 'textarea', 'iframe', 'summary', '[contenteditable="true"]', '[tabindex]',
].join(',');

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0
      && !element.matches(':disabled')
      && !element.closest('[hidden], [inert]')
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility === 'visible')
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

export function Dialog({ children, actions, onClose, busy = false, labelledBy, className }: DialogProps) {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  // Capture before React commits children's autoFocus, rather than in an effect.
  const [trigger] = useState(() => typeof document !== 'undefined'
    && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useLayoutEffect(() => {
    const dialog = sectionRef.current;
    if (!dialog) return;
    const body = document.body;
    const overflow = body.style.getPropertyValue('overflow');
    const priority = body.style.getPropertyPriority('overflow');
    body.style.setProperty('overflow', 'hidden');

    // React autoFocus may not leave an HTML autofocus attribute. Preserve the
    // focus it already placed, including across StrictMode's effect replay.
    const active = document.activeElement;
    if (!initialFocus.current) {
      initialFocus.current = active instanceof HTMLElement && dialog.contains(active)
        ? active
        : dialog.querySelector<HTMLElement>('[autofocus]:not(:disabled)');
    }
    (initialFocus.current ?? focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });

    return () => {
      if (overflow) body.style.setProperty('overflow', overflow, priority);
      else body.style.removeProperty('overflow');
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Dialog editing shortcuts must never reach the global canvas handlers.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = sectionRef.current;
    if (!dialog) return;
    event.preventDefault();
    // Query on every press so conditional fields and busy controls are current.
    const elements = focusableElements(dialog);
    if (!elements.length) {
      dialog.focus({ preventScroll: true });
      return;
    }
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const next = index < 0
      ? (event.shiftKey ? elements.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
    elements[next].focus();
  };

  return (
    <motion.div className="modal-backdrop" initial={reduced ? false : { backgroundColor: 'rgba(16, 27, 50, 0)' }}
      animate={{ backgroundColor: 'rgba(16, 27, 50, 0.42)' }} transition={{ duration: reduced ? 0 : 0.16 }} onClick={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <motion.section
        initial={reduced ? false : { y: 10, scale: 0.985 }} animate={{ y: 0, scale: 1 }}
        transition={reduced ? { duration: 0 } : UI_TRANSITION}
        ref={sectionRef}
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <button type="button" className="icon-button modal-close" aria-label="关闭对话框" disabled={busy} onClick={() => { if (!busy) onClose(); }}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="modal-content">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </motion.section>
    </motion.div>
  );
}
