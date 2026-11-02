/** Bundled Phosphor icons. Keep product meanings consistent across every surface. */
import { Play, List, GitFork, CheckCircle, Code, Cpu, User, StackSimple } from '@phosphor-icons/react';
import type { NodeKind, Executor } from './types';

export const NODE_ICONS = { start: Play, step: List, decision: GitFork, end: CheckCircle } satisfies Record<NodeKind, typeof Play>;
export const EXECUTOR_ICONS = { program: Code, llm: Cpu, human: User } satisfies Record<Executor, typeof Code>;
export const GroupIcon = StackSimple;
// One clear linear weight. Optical sizes are assigned by control/metadata roles.
export const UI_ICON_STYLE = { weight: 'bold' as const, size: 20 };
export { IconContext } from '@phosphor-icons/react';

export {
  ArrowDown, DownloadSimple as ArrowDownToLine, ArrowLeft, ArrowRight,
  Check, Checks as CheckCheck, CaretRight as ChevronRight, Clock as Clock3,
  FileCode as FileJson, GitBranch, ClockCounterClockwise as History,
  SquaresFour as LayoutGrid, SpinnerGap as Loader2, CornersOut as Maximize,
  ChatText as MessageSquare, Cursor as MousePointer2,
  SidebarSimple as PanelRightClose, Sidebar as PanelRightOpen,
  Plus, ArrowBendUpRight as Redo2, ArrowCounterClockwise as RotateCcw,
  FloppyDisk as Save, ShieldCheck, Cpu as Sparkles, Trash as Trash2,
  ArrowBendUpLeft as Undo2, X, WarningCircle as AlertCircle, Pause,
  LockKey as LockKeyhole, Image, FileText, FolderOpen,
  MagnifyingGlass as Search, SidebarSimple as PanelLeft, Command as Keyboard,
  FlowArrow as Workflow, Desktop as Monitor, SlidersHorizontal, Minus,
  BookOpen, PencilSimple as Pencil, SunDim as AmbientLight,
} from '@phosphor-icons/react';
