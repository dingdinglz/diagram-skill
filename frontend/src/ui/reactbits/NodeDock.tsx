// Adapted for Flowplan from React Bits Dock.
// Copyright (c) 2026 David Haz — MIT + Commons Clause.
// Source and full license: see README.md and skills/diagram-plan/licenses/react-bits-LICENSE.md.
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';
import { GroupIcon, NODE_ICONS } from '../../icons';
import { KIND_LABELS, type NodeKind } from '../../types';
import { UI_SPRING } from '../Motion';
import { useReducedMotion } from '../useReducedMotion';
import { SpotlightCard } from './SpotlightCard';

const HOVER_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 761px)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(HOVER_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const snapshot = () => window.matchMedia(HOVER_QUERY).matches;
const serverSnapshot = () => false;

/** React Bits' cosine falloff, restricted to a small neighborhood of fixed targets. */
export function dockProximity(pointer: number, center: number, distance = 84) {
  if (!Number.isFinite(pointer) || !Number.isFinite(center) || distance <= 0) return 0;
  const reach = Math.abs(pointer - center) / distance;
  return reach < 1 ? Math.cos(reach * Math.PI / 2) ** 2 : 0;
}

type DockType = NodeKind | 'group';
const items: { type: DockType; hint: string }[] = [
  { type: 'start', hint: '入口或触发' },
  { type: 'step', hint: '一个明确动作' },
  { type: 'decision', hint: '标明分支条件' },
  { type: 'end', hint: '结果或终点' },
  { type: 'group', hint: '把一段步骤收进一张卡片' },
];

function DockItem({ type, hint, pointer, enabled, disabled, onAdd }: {
  type: DockType; hint: string; pointer: MotionValue<number>; enabled: boolean;
  disabled: boolean; onAdd: (type: DockType) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const focused = useMotionValue(0);
  const proximity = useTransform(pointer, x => {
    const box = ref.current?.getBoundingClientRect();
    return enabled && box ? dockProximity(x, box.left + box.width / 2) : 0;
  });
  const target = useTransform(() => enabled ? Math.max(proximity.get(), focused.get()) : 0);
  const spring = useSpring(target, UI_SPRING);
  const scale = useTransform(spring, [0, 1], [1, 1.22]);
  const y = useTransform(spring, [0, 1], [0, -4]);
  const Icon = type === 'group' ? GroupIcon : NODE_ICONS[type];
  const label = type === 'group' ? '子流程' : KIND_LABELS[type];
  useEffect(() => { if (!enabled) focused.set(0); }, [enabled, focused]);

  return <button ref={ref} type="button" className={`palette-button palette-${type}`} disabled={disabled}
    aria-label={`添加${label}`} title={`${label} · ${hint}`}
    onClick={() => onAdd(type)}
    onFocus={event => focused.set(enabled && event.currentTarget.matches(':focus-visible') ? 1 : 0)}
    onBlur={() => focused.set(0)}>
    <motion.span className="dock-icon" aria-hidden="true" style={enabled ? { scale, y } : { scale: 1, y: 0 }}>
      <Icon size={22} />
    </motion.span>
    <span>{type === 'step' ? '步骤' : type === 'decision' ? '判断' : label}</span>
  </button>;
}

export function NodeDock({ disabled, context = '添加节点', onAdd }: { disabled: boolean; context?: string; onAdd: (type: DockType) => void }) {
  const pointer = useMotionValue(Infinity);
  const reduced = useReducedMotion();
  const canHover = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const enabled = canHover && !reduced && !disabled;
  useEffect(() => { if (!enabled) pointer.set(Infinity); }, [enabled, pointer]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !buttons.length) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return <SpotlightCard disabled={disabled} className="node-palette" role="toolbar" aria-label="添加流程节点" data-motion={enabled ? 'spring' : 'static'}
    onPointerMove={event => { if (enabled && event.pointerType !== 'touch') pointer.set(event.clientX); }}
    onPointerLeave={() => pointer.set(Infinity)} onPointerCancel={() => pointer.set(Infinity)} onKeyDown={navigate}>
    <span className="dock-label" title={context}>{context}</span><span className="toolbar-divider" />
    {items.map(item => <DockItem key={item.type} {...item} pointer={pointer} enabled={enabled} disabled={disabled} onAdd={onAdd} />)}
  </SpotlightCard>;
}
