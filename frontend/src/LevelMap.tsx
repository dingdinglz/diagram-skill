import { useEffect, useRef } from 'react';
import { levelPositionText, levelThumbnail, type LevelMapEntry } from './levelMap';

const THUMB = { width: 72, height: 50 };

function LevelThumb({ entry, selectedId }: { entry: LevelMapEntry; selectedId: string | null }) {
  const thumb = levelThumbnail(entry.scene, THUMB.width, THUMB.height);
  return <svg className="level-thumb" viewBox={`0 0 ${THUMB.width} ${THUMB.height}`} width={THUMB.width} height={THUMB.height} aria-hidden="true">
    <g transform={thumb.transform}>{thumb.paths.map((path, index) => <path key={index} d={path} />)}</g>
    {thumb.cards.map(card => {
      const mark = entry.markerIds.includes(card.id) || card.id === selectedId;
      return <rect key={card.id} className={mark ? 'is-marked' : card.group ? 'is-group' : undefined} x={card.x} y={card.y} width={card.width} height={card.height} rx={1.5} />;
    })}
  </svg>;
}

/** Every level from the main flow down to here, each marking where the next one sits. */
export function LevelMap({ entries, selectedId, top, onSelect }: { entries: LevelMapEntry[]; selectedId: string | null; top: number; onSelect: (index: number) => void }) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => { current.current?.scrollIntoView?.({ block: 'nearest' }); }, [entries.length]);
  return <nav className="level-map" id="level-map" aria-label="层级结构" style={{ top, maxHeight: `calc(100% - ${top + 124}px)` }}>
    <ol>{entries.map((entry, index) => {
      const here = index === entries.length - 1, text = levelPositionText(entry, here);
      return <li key={entry.id || 'root'}>
        <button ref={here ? current : undefined} aria-current={here ? 'location' : undefined} title={`${entry.label} · ${text}`} onClick={() => onSelect(index)}>
          <LevelThumb entry={entry} selectedId={here ? selectedId : null} />
          <span className="level-map-text"><strong>{entry.label}</strong><small>{text}</small></span>
        </button>
      </li>;
    })}</ol>
  </nav>;
}
