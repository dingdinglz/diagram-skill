import type { ComponentPropsWithRef } from 'react';
import { usePanelWidth } from './usePanelWidth';

export function TaskSidebar({ narrow, collapsed, children, ...props }: ComponentPropsWithRef<'aside'> & { narrow: boolean; collapsed: boolean }) {
  const { width, splitter } = usePanelWidth({
    storageKey: 'flowplan:sidebar-width', min: 184, defaultWidth: v => v <= 1280 ? 212 : 232, maxWidth: v => Math.min(420, v * .30),
    edge: 'right', controls: props.id, label: '任务导航宽度', className: 'sidebar-splitter',
  });
  return <aside {...props} className="sidebar" hidden={!narrow && collapsed} style={narrow ? undefined : { width }}>
    {children}
    {!narrow && !collapsed && splitter}
  </aside>;
}
