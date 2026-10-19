import {
  ArrowUpIcon,
  BrainIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  CommandIcon,
  CpuIcon,
  FileDiffIcon,
  LinkIcon,
  MicIcon,
  PanelRightIcon,
  PinIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import type { CodexMicroCommand, CodexMicroKeyAction } from "~/codexMicro/config";
import { cn } from "~/lib/utils";

// The Codex Micro's top plate, drawn on a 4×4 grid as the hardware lays it out:
//   dial   · agent 1 · agent 2 · stick
//   agent 3 · agent 4 · agent 5 · agent 6
//   key 1  · key 2   · key 3   · key 4
//   lights · wide key (2 units)  · key 5

export type CodexMicroControlId =
  | "dial"
  | "joystick"
  | "AG00"
  | "AG01"
  | "AG02"
  | "AG03"
  | "AG04"
  | "AG05"
  | "ACT06"
  | "ACT07"
  | "ACT08"
  | "ACT09"
  | "ACT10"
  | "ACT12";

interface Cell {
  readonly id: CodexMicroControlId | "lights";
  readonly row: number;
  readonly col: number;
  readonly span?: 2;
}

const LAYOUT: ReadonlyArray<Cell> = [
  { id: "dial", row: 0, col: 0 },
  { id: "AG00", row: 0, col: 1 },
  { id: "AG01", row: 0, col: 2 },
  { id: "joystick", row: 0, col: 3 },
  { id: "AG02", row: 1, col: 0 },
  { id: "AG03", row: 1, col: 1 },
  { id: "AG04", row: 1, col: 2 },
  { id: "AG05", row: 1, col: 3 },
  { id: "ACT06", row: 2, col: 0 },
  { id: "ACT07", row: 2, col: 1 },
  { id: "ACT08", row: 2, col: 2 },
  { id: "ACT09", row: 2, col: 3 },
  { id: "lights", row: 3, col: 0 },
  { id: "ACT10", row: 3, col: 1, span: 2 },
  { id: "ACT12", row: 3, col: 3 },
];

const CONTROL_CELLS = LAYOUT.filter(
  (cell): cell is Cell & { id: CodexMicroControlId } => cell.id !== "lights",
);

function cellAt(row: number, col: number) {
  return CONTROL_CELLS.find(
    (cell) => cell.row === row && col >= cell.col && col < cell.col + (cell.span ?? 1),
  );
}

/** The control an arrow key moves to, skipping the lights and spanning the wide key. */
function neighbor(id: CodexMicroControlId, key: string): CodexMicroControlId | null {
  const cell = CONTROL_CELLS.find((candidate) => candidate.id === id);
  if (!cell) return null;
  const [dRow, dCol] =
    key === "ArrowUp"
      ? [-1, 0]
      : key === "ArrowDown"
        ? [1, 0]
        : key === "ArrowLeft"
          ? [0, -1]
          : [0, 1];
  let row = cell.row;
  let col = dCol > 0 ? cell.col + (cell.span ?? 1) - 1 : cell.col;
  for (let step = 0; step < 4; step += 1) {
    row += dRow;
    col += dCol;
    if (row < 0 || row > 3 || col < 0 || col > 3) return null;
    const next = cellAt(row, col);
    if (next && next.id !== id) return next.id;
  }
  return null;
}

const COMMAND_ICONS: Readonly<Record<CodexMicroCommand, LucideIcon>> = {
  "chat.new": SquarePenIcon,
  "composer.submit": ArrowUpIcon,
  "thread.stop": SquareIcon,
  "commandPalette.toggle": CommandIcon,
  "diff.toggle": FileDiffIcon,
  "terminal.toggle": TerminalIcon,
  "terminal.new": SquareTerminalIcon,
  "rightPanel.toggle": PanelRightIcon,
  "modelPicker.toggle": CpuIcon,
  "composer.effort": BrainIcon,
  "composer.increaseEffort": ChevronsUpIcon,
  "composer.decreaseEffort": ChevronsDownIcon,
  "composer.mode": SlidersHorizontalIcon,
  "thread.pin": PinIcon,
  "chat.find": SearchIcon,
  "thread.copyReference": LinkIcon,
};

export function KeyActionIcon({
  action,
  className,
}: {
  action: CodexMicroKeyAction;
  className?: string;
}) {
  if (action.type === "none") {
    return (
      <span
        aria-hidden
        className="size-2.5 rounded-xs border border-dashed border-muted-foreground/50"
      />
    );
  }
  const Icon = action.type === "dictation" ? MicIcon : COMMAND_ICONS[action.command];
  return <Icon aria-hidden className={cn("size-4", className)} />;
}

export interface CodexMicroAgentKeyView {
  readonly assigned: boolean;
  /** Status color the key glows; null when idle or unassigned. */
  readonly color: string | null;
  readonly active: boolean;
}

export interface CodexMicroSurfaceProps {
  readonly selected: CodexMicroControlId;
  readonly onSelect: (id: CodexMicroControlId) => void;
  readonly keyActions: Readonly<
    Record<"ACT06" | "ACT07" | "ACT08" | "ACT09" | "ACT10" | "ACT12", CodexMicroKeyAction>
  >;
  readonly agentKeys: ReadonlyArray<CodexMicroAgentKeyView>;
  readonly labels: Readonly<Record<CodexMicroControlId, string>>;
  /** Controls held down on the connected device right now. */
  readonly pressed: ReadonlySet<CodexMicroControlId>;
  /** Live stick deflection: a fraction of a turn and 0–1 distance. */
  readonly stick: { readonly angle: number; readonly distance: number } | null;
  readonly connected: boolean;
}

export function CodexMicroSurface({
  selected,
  onSelect,
  keyActions,
  agentKeys,
  labels,
  pressed,
  stick,
  connected,
}: CodexMicroSurfaceProps) {
  const refs = useRef(new Map<CodexMicroControlId, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: CodexMicroControlId) => {
    if (!event.key.startsWith("Arrow")) return;
    const next = neighbor(id, event.key);
    event.preventDefault();
    if (next === null) return;
    onSelect(next);
    refs.current.get(next)?.focus();
  };

  const control = (id: CodexMicroControlId, className: string, children: ReactNode) => (
    <button
      key={id}
      ref={(node) => {
        if (node) refs.current.set(id, node);
        else refs.current.delete(id);
      }}
      type="button"
      role="radio"
      aria-checked={selected === id}
      aria-label={labels[id]}
      tabIndex={selected === id ? 0 : -1}
      data-selected={selected === id ? "" : undefined}
      data-pressed={pressed.has(id) ? "" : undefined}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => onKeyDown(event, id)}
      className={cn(
        "group/control relative flex min-w-0 cursor-pointer items-center justify-center outline-none transition-[transform,box-shadow,border-color] duration-100 ease-out",
        "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring",
        "data-pressed:translate-y-px",
        className,
      )}
    >
      {children}
    </button>
  );

  const keycap =
    "rounded-lg border border-border bg-background text-foreground shadow-xs hover:border-foreground/25 data-pressed:shadow-none data-selected:border-primary data-selected:ring-1 data-selected:ring-inset data-selected:ring-primary dark:bg-input/40";

  return (
    <div
      role="radiogroup"
      aria-label="Codex Micro controls"
      className="relative grid aspect-square w-full max-w-62 grid-cols-4 grid-rows-4 gap-1.5 rounded-2xl border border-border/70 bg-muted p-2.5 shadow-inner dark:bg-black/30"
    >
      {LAYOUT.map((cell) => {
        switch (cell.id) {
          case "lights":
            return <StatusLights key="lights" connected={connected} />;
          case "dial":
            return control(
              "dial",
              "rounded-full",
              <span className="relative size-[88%] rounded-full border border-border bg-background shadow-sm transition-[border-color,box-shadow] group-hover/control:border-foreground/25 group-data-pressed/control:shadow-none group-data-selected/control:border-primary group-data-selected/control:ring-1 group-data-selected/control:ring-inset group-data-selected/control:ring-primary dark:bg-input/50">
                <span className="absolute top-[12%] left-1/2 h-[18%] w-0.5 -translate-x-1/2 rounded-full bg-muted-foreground/45" />
              </span>,
            );
          case "joystick": {
            const radians = (stick?.angle ?? 0) * Math.PI * 2;
            const reach = Math.min(stick?.distance ?? 0, 1) * 18;
            return control(
              "joystick",
              cn(keycap, "bg-muted-foreground/10 dark:bg-white/[0.04]"),
              <span
                className="size-[58%] rounded-full bg-foreground/85 shadow-sm transition-transform duration-75 ease-out dark:bg-muted-foreground/50"
                style={{
                  transform: `translate(${Math.cos(radians) * reach}%, ${Math.sin(radians) * reach}%)`,
                }}
              />,
            );
          }
          case "AG00":
          case "AG01":
          case "AG02":
          case "AG03":
          case "AG04":
          case "AG05": {
            const index = Number(cell.id.slice(3));
            const view = agentKeys[index];
            return control(
              cell.id,
              cn(keycap, "overflow-hidden"),
              <AgentKeyFace index={index} view={view} />,
            );
          }
          default:
            return control(
              cell.id,
              cn(keycap, cell.span === 2 && "col-span-2"),
              <span className="flex items-center gap-1.5 text-foreground/80">
                <KeyActionIcon action={keyActions[cell.id]} />
              </span>,
            );
        }
      })}
    </div>
  );
}

function AgentKeyFace({
  index,
  view,
}: {
  index: number;
  view: CodexMicroAgentKeyView | undefined;
}) {
  const color = view?.color ?? null;
  return (
    <>
      {color !== null ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 transition-opacity",
            view?.active ? "opacity-30" : "opacity-15",
          )}
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="absolute top-1 left-1.5 text-4xs leading-none font-medium text-muted-foreground tabular-nums">
        {index + 1}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative size-2 rounded-full",
          color === null && (view?.assigned ? "bg-foreground/45" : "bg-muted-foreground/20"),
        )}
        style={
          color === null ? undefined : { backgroundColor: color, boxShadow: `0 0 6px ${color}` }
        }
      />
    </>
  );
}

function StatusLights({ connected }: { connected: boolean }) {
  return (
    <div
      role="img"
      aria-label={connected ? "Connected" : "Not connected"}
      className="flex items-center justify-center gap-1.5"
    >
      <span className="flex flex-col gap-1">
        <span
          className={cn("size-1 rounded-full", connected ? "bg-info" : "bg-muted-foreground/25")}
        />
        <span className="size-1 rounded-full bg-muted-foreground/25" />
        <span className="size-1 rounded-full bg-muted-foreground/25" />
      </span>
      <span className="size-[46%] rounded-full bg-foreground/80 shadow-sm dark:bg-foreground/20" />
    </div>
  );
}
