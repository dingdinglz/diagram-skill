import { motion } from 'motion/react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { usePanelWidth } from './usePanelWidth';

export function InspectorPanel({ narrow, children, ...props }: Omit<ComponentPropsWithRef<typeof motion.aside>, 'children'> & { narrow: boolean; children: ReactNode }) {
  const { width, splitter } = usePanelWidth({
    storageKey: 'flowplan:inspector-width', min: 300, defaultWidth: v => v > 1100 && v <= 1280 ? 336 : 380,
    // A docked panel leaves room for the canvas even with the task sidebar at its widest.
    maxWidth: v => Math.min(800, v <= 1100 ? v * .62 : v - Math.min(420, v * .30) - 360),
    edge: 'left', controls: props.id, label: '详情面板宽度', className: 'inspector-splitter',
  });
  return <motion.aside {...props} style={narrow ? undefined : { width }}>
    {!narrow && splitter}
    {children}
  </motion.aside>;
}
