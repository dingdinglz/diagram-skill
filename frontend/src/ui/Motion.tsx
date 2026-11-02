import { motion } from 'motion/react';
import { useReducedMotion } from './useReducedMotion';
import type { ReactNode } from 'react';

/** Shared motion is limited to workspace chrome, never graph geometry or exports. */
export const UI_TRANSITION = { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const };
export const UI_SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.55 };

export function SelectionIndicator({ id, className }: { id: string; className: string }) {
  const reduced = useReducedMotion();
  // Static replacement also avoids layout projection for reduced-motion users.
  if (reduced) return <span className={className} aria-hidden="true" />;
  return <motion.span aria-hidden="true" className={className} layoutId={id} initial={false} transition={UI_SPRING} />;
}

export function ContentTransition({ identity, children }: { identity: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <motion.div key={identity} className="content-transition"
    initial={reduced ? false : { opacity: 0.72, y: 6 }}
    animate={{ opacity: 1, y: 0 }} transition={reduced ? { duration: 0 } : UI_TRANSITION}>
    {children}
  </motion.div>;
}
