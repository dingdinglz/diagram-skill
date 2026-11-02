// Adapted for Flowplan from React Bits RubberSegment.
// Copyright (c) 2026 David Haz — MIT + Commons Clause.
// Source and full license: see README.md and skills/diagram-plan/licenses/react-bits-LICENSE.md.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useReducedMotion } from '../useReducedMotion';

/** Controlled, non-draggable adaptation: preserve native click/keyboard activation. */
export function FlowScope({ branches, onChange }: { branches: boolean; onChange: (branches: boolean) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const slots = useRef<{ l: number; r: number }[]>([]);
  const current = useRef(branches ? 1 : 0);
  current.current = branches ? 1 : 0;
  const previous = useRef(current.current);
  const animations = useRef<{ stop: () => void }[]>([]);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  const innerW = useMotionValue(0);
  const clipPath = useTransform(() => `inset(0 ${Math.max(0, innerW.get() - edgeR.get())}px 0 ${Math.max(0, edgeL.get())}px round 4px)`);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => {
      animations.current.forEach(animation => animation.stop());
      const rect = element.getBoundingClientRect();
      slots.current = buttons.current.map(button => {
        const box = button!.getBoundingClientRect();
        return { l: box.left - rect.left - 2, r: box.right - rect.left - 2 };
      });
      innerW.set(rect.width - 4);
      const slot = slots.current[current.current];
      edgeL.jump(slot.l); edgeR.jump(slot.r);
      previous.current = current.current;
      setReady(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    buttons.current.forEach(button => { if (button) observer.observe(button); });
    return () => {
      observer.disconnect();
      animations.current.forEach(animation => animation.stop());
      edgeL.stop(); edgeR.stop();
    };
  }, [edgeL, edgeR, innerW]);

  useLayoutEffect(() => {
    const index = branches ? 1 : 0;
    const slot = slots.current[index];
    if (!slot) return;
    if (!reduced && index === previous.current) return;
    animations.current.forEach(animation => animation.stop());
    if (reduced) {
      edgeL.jump(slot.l); edgeR.jump(slot.r);
    } else {
      // A short leading/trailing handoff keeps the material idea, without a
      // draggable or bouncy filter that could change the graph accidentally.
      const right = index > previous.current;
      const spring = { type: 'spring' as const, duration: 0.26, bounce: 0 };
      animations.current = [
        animate(edgeL, slot.l, { ...spring, delay: right ? 0.025 : 0 }),
        animate(edgeR, slot.r, { ...spring, delay: right ? 0 : 0.025 }),
      ];
    }
    previous.current = index;
  }, [branches, reduced, edgeL, edgeR]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'End') next = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'Home') next = 0;
    else return;
    event.preventDefault(); event.stopPropagation();
    if (next !== index) onChange(next === 1);
    buttons.current[next]?.focus();
  };

  return <div ref={track} className="view-switch" role="group" aria-label="流程显示范围">
    <motion.span className="scope-indicator" aria-hidden="true" style={{ clipPath, visibility: ready ? 'visible' : 'hidden' }} />
    {['主线', '含分支'].map((label, index) => <button key={label} ref={button => { buttons.current[index] = button; }}
      type="button" aria-label={index ? '显示分支' : '主线'} aria-pressed={index === (branches ? 1 : 0)}
      onClick={() => onChange(index === 1)} onKeyDown={event => navigate(event, index)}>{label}</button>)}
  </div>;
}
