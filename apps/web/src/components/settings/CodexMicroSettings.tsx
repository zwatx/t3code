import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import {
  CODEX_MICRO_COMMANDS,
  codexMicroCommandLabel,
  useCodexMicroConfigStore,
  type CodexMicroActionKey,
  type CodexMicroKeyAction,
  type CodexMicroStickAction,
  type CodexMicroStickDirection,
} from "~/codexMicro/config";
import {
  CODEX_MICRO_IDLE_COLOR,
  CODEX_MICRO_SLOT_COUNT,
  CODEX_MICRO_STATUS_LIGHTING,
  assignThreadToSlot,
  compareSlotCandidates,
} from "~/codexMicro/controller";
import {
  codexMicroSupport,
  subscribeCodexMicroMessages,
  useCodexMicroSlotStore,
  useCodexMicroStore,
  type CodexMicroStatus,
  type CodexMicroSupport,
} from "~/codexMicro/store";
import { resolveThreadLastVisitedAt, resolveThreadStatusPill } from "~/components/Sidebar.logic";
import { cn } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { CodexMicroDictationSettings } from "./CodexMicroDictationSettings";
import {
  CodexMicroSurface,
  KeyActionIcon,
  type CodexMicroAgentKeyView,
  type CodexMicroControlId,
} from "./CodexMicroSurface";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const UNSUPPORTED_MESSAGE: Record<Exclude<CodexMicroSupport, "available">, string> = {
  unsupported:
    "This browser can't use HID devices. Use the desktop app, or Chrome or Edge on a computer.",
  "insecure-context":
    "HID devices need a secure page. Open T3 Code over HTTPS or on localhost to connect.",
};

const KEY_NAMES: Readonly<Record<CodexMicroActionKey, string>> = {
  ACT06: "Key 1",
  ACT07: "Key 2",
  ACT08: "Key 3",
  ACT09: "Key 4",
  ACT10: "Wide key",
  ACT12: "Key 5",
};

const STICK_DIRECTIONS: ReadonlyArray<{
  direction: CodexMicroStickDirection;
  label: string;
  icon: typeof ArrowUpIcon;
}> = [
  { direction: "up", label: "Up", icon: ArrowUpIcon },
  { direction: "down", label: "Down", icon: ArrowDownIcon },
  { direction: "left", label: "Left", icon: ArrowLeftIcon },
  { direction: "right", label: "Right", icon: ArrowRightIcon },
];

const STATUS_LABELS: ReadonlyArray<{ label: string; color: number }> = [
  { label: "Working", color: CODEX_MICRO_STATUS_LIGHTING.Working.color },
  { label: "Needs approval", color: CODEX_MICRO_STATUS_LIGHTING["Pending Approval"].color },
  { label: "Needs input", color: CODEX_MICRO_STATUS_LIGHTING["Awaiting Input"].color },
  { label: "Plan ready", color: CODEX_MICRO_STATUS_LIGHTING["Plan Ready"].color },
  { label: "Completed", color: CODEX_MICRO_STATUS_LIGHTING.Completed.color },
  { label: "Failed", color: CODEX_MICRO_STATUS_LIGHTING.Failed.color },
];

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function keyActionLabel(action: CodexMicroKeyAction): string {
  switch (action.type) {
    case "none":
      return "No action";
    case "dictation":
      return "Dictate";
    case "command":
      return codexMicroCommandLabel(action.command);
  }
}

function stickActionLabel(action: CodexMicroStickAction): string {
  switch (action.type) {
    case "none":
      return "No action";
    case "thread":
      return action.direction === "previous" ? "Previous agent key" : "Next agent key";
    case "command":
      return codexMicroCommandLabel(action.command);
  }
}

function statusText(status: CodexMicroStatus) {
  switch (status.phase) {
    case "idle":
      return "Not connected";
    case "connecting":
      return "Choose your Codex Micro in the browser prompt…";
    case "disconnecting":
      return "Releasing Codex Micro…";
    case "connected":
      return status.firmwareVersion
        ? `Connected to ${status.productName} · firmware ${status.firmwareVersion}`
        : `Connected to ${status.productName}`;
    case "error":
      return <span className="text-destructive">{status.message}</span>;
  }
}

export function CodexMicroSettings() {
  // Support cannot change while the page is open.
  const [support] = useState(codexMicroSupport);
  const status = useCodexMicroStore((state) => state.status);
  const connect = useCodexMicroStore((state) => state.connect);
  const disconnect = useCodexMicroStore((state) => state.disconnect);
  const forget = useCodexMicroStore((state) => state.forget);
  const connected = status.phase === "connected";

  return (
    <SettingsSection id="codex-micro-section" title="Codex Micro">
      <SettingsRow
        {...searchableSetting("codex-micro")}
        title={
          <span className="flex items-center gap-2">
            Codex Micro
            {support === "available" ? (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  connected
                    ? "bg-success"
                    : status.phase === "error"
                      ? "bg-destructive"
                      : "bg-muted-foreground/30",
                )}
              />
            ) : null}
          </span>
        }
        description="Use a Work Louder Codex Micro attached to this computer over USB or Bluetooth. Agent keys open threads and light up with their status."
        status={support === "available" ? statusText(status) : UNSUPPORTED_MESSAGE[support]}
        control={
          support !== "available" ? null : connected ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void forget()}>
                Forget device
              </Button>
              <Button size="sm" variant="outline" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={status.phase === "connecting" || status.phase === "disconnecting"}
              onClick={() => void connect()}
            >
              {status.phase === "connecting"
                ? "Connecting…"
                : status.phase === "disconnecting"
                  ? "Disconnecting…"
                  : "Connect"}
            </Button>
          )
        }
      />
      {support === "available" ? (
        <>
          <CodexMicroLayoutRow connected={connected} />
          <CodexMicroDictationSettings />
          <ResetRow />
        </>
      ) : null}
    </SettingsSection>
  );
}

function controlForKey(key: string): CodexMicroControlId | null {
  if (/^AG0[0-5]$/.test(key)) return key as CodexMicroControlId;
  if (key === "ACT11") return "ACT10";
  if (/^ACT(0[6-9]|10|12)$/.test(key)) return key as CodexMicroControlId;
  if (key.startsWith("ENC")) return "dial";
  return null;
}

/** Shows the connected device's input as it happens, and follows it to the pressed control. */
function useLiveInput(connected: boolean, onSelect: (id: CodexMicroControlId) => void) {
  const onControl = useEffectEvent(onSelect);
  const [pressed, setPressed] = useState<ReadonlySet<CodexMicroControlId>>(new Set());
  const [stick, setStick] = useState<{ angle: number; distance: number } | null>(null);

  useEffect(() => {
    if (!connected) return;
    const held = new Map<string, CodexMicroControlId>();
    const publish = () => setPressed(new Set(held.values()));
    const unsubscribe = subscribeCodexMicroMessages((message) => {
      if (message.type === "joystick") {
        setStick(message.distance < 0.3 ? null : message);
        if (message.distance >= 0.5) onControl("joystick");
        return;
      }
      if (message.type !== "key") return;
      const id = controlForKey(message.key);
      if (id === null) return;
      if (message.action === 2) {
        onControl(id);
      } else if (message.action === 1) {
        held.set(message.key, id);
        onControl(id);
      } else {
        held.delete(message.key);
      }
      publish();
    });
    return () => {
      unsubscribe();
      setPressed(new Set());
      setStick(null);
    };
  }, [connected]);

  return { pressed, stick };
}

function useAgentKeys() {
  const slots = useCodexMicroSlotStore((state) => state.slots);
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const shells = useThreadShells();
  const liveShells = shells
    .filter((shell) => shell.archivedAt === null && shell.deletedAt === null)
    .toSorted(compareSlotCandidates);
  const shellByKey = new Map(
    liveShells.map((shell) => [
      scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
      shell,
    ]),
  );

  const keys = Array.from({ length: CODEX_MICRO_SLOT_COUNT }, (_, index) => {
    const key = slots[index] ?? null;
    const shell = key === null ? undefined : shellByKey.get(key);
    if (key === null || shell === undefined) {
      return {
        key,
        title: key === null ? null : "Unavailable thread",
        statusLabel: null,
        view: { assigned: false, color: null, active: false } satisfies CodexMicroAgentKeyView,
      };
    }
    const lastVisitedAt = resolveThreadLastVisitedAt(shell.lastVisitedAt, lastVisitedById[key]);
    const pill = resolveThreadStatusPill({
      thread: { ...shell, ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }) },
    });
    const lighting = pill ? CODEX_MICRO_STATUS_LIGHTING[pill.label] : null;
    return {
      key,
      title: shell.title,
      statusLabel: pill?.label ?? null,
      view: {
        assigned: true,
        color: lighting && lighting.color !== CODEX_MICRO_IDLE_COLOR ? hex(lighting.color) : null,
        active: false,
      } satisfies CodexMicroAgentKeyView,
    };
  });

  const threads = [...shellByKey.entries()].map(([key, shell]) => ({ key, title: shell.title }));
  return { slots, keys, threads };
}

function CodexMicroLayoutRow({ connected }: { connected: boolean }) {
  const [selected, setSelected] = useState<CodexMicroControlId>("ACT10");
  const config = useCodexMicroConfigStore((state) => state.config);
  const agentKeys = useAgentKeys();
  const { pressed, stick } = useLiveInput(connected, setSelected);

  const labels = {
    dial: "Dial",
    joystick: "Joystick",
    ...Object.fromEntries(
      agentKeys.keys.map((entry, index) => [
        `AG0${index}`,
        `Agent key ${index + 1}: ${entry.title ?? "Unassigned"}`,
      ]),
    ),
    ...Object.fromEntries(
      (Object.keys(KEY_NAMES) as CodexMicroActionKey[]).map((key) => [
        key,
        `${KEY_NAMES[key]}: ${keyActionLabel(config.keys[key])}`,
      ]),
    ),
  } as Record<CodexMicroControlId, string>;

  return (
    <SettingsRow
      {...searchableSetting("codex-micro-agent-keys")}
      title="Controls"
      description="Choose what each key, the dial, and the joystick do. Changes apply right away."
    >
      <div className="@container/micro pt-1 pb-3">
        <div className="grid items-start gap-5 @min-[34rem]/micro:grid-cols-[minmax(0,15.5rem)_minmax(0,1fr)] @min-[34rem]/micro:gap-6">
          <div className="flex flex-col items-center gap-2.5">
            <CodexMicroSurface
              selected={selected}
              onSelect={setSelected}
              keyActions={config.keys}
              agentKeys={agentKeys.keys.map((entry) => entry.view)}
              labels={labels}
              pressed={pressed}
              stick={stick}
              connected={connected}
            />
            <p className="text-center text-xs text-muted-foreground">
              {connected
                ? "Select a control, or press it on your Micro."
                : "Select a control to change it."}
            </p>
          </div>
          <div
            role="region"
            aria-label="Selected control"
            className="min-w-0 rounded-lg border border-border/60 bg-background/60 p-3.5 dark:bg-input/10"
          >
            <ControlInspector selected={selected} agentKeys={agentKeys} />
          </div>
        </div>
      </div>
    </SettingsRow>
  );
}

function InspectorHeader({
  title,
  hardware,
  children,
}: {
  title: string;
  hardware: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="truncate text-sm font-medium text-foreground">{title}</h4>
        <code className="shrink-0 font-mono text-3xs text-muted-foreground">{hardware}</code>
      </div>
      {children ? <p className="text-xs leading-normal text-muted-foreground">{children}</p> : null}
    </div>
  );
}

function ControlInspector({
  selected,
  agentKeys,
}: {
  selected: CodexMicroControlId;
  agentKeys: ReturnType<typeof useAgentKeys>;
}) {
  const config = useCodexMicroConfigStore((state) => state.config);
  const setKeyAction = useCodexMicroConfigStore((state) => state.setKeyAction);
  const setDialTurn = useCodexMicroConfigStore((state) => state.setDialTurn);
  const setDialPress = useCodexMicroConfigStore((state) => state.setDialPress);
  const setStickAction = useCodexMicroConfigStore((state) => state.setStickAction);

  if (selected === "dial") {
    return (
      <>
        <InspectorHeader title="Dial" hardware="ENC">
          Turn to step through a setting. Press to run an action.
        </InspectorHeader>
        <div className="space-y-3">
          <Field label="Turn">
            <ToggleGroup
              aria-label="Dial turn"
              variant="segmented"
              value={[config.dial.turn]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "effort" || value === "threads" || value === "none") {
                  setDialTurn(value);
                }
              }}
            >
              <ToggleGroupItem value="effort">Reasoning effort</ToggleGroupItem>
              <ToggleGroupItem value="threads">Agent keys</ToggleGroupItem>
              <ToggleGroupItem value="none">Off</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field label="Press">
            <KeyActionSelect
              label="Dial press action"
              value={config.dial.press}
              onChange={setDialPress}
            />
          </Field>
        </div>
      </>
    );
  }

  if (selected === "joystick") {
    return (
      <>
        <InspectorHeader title="Joystick" hardware="RAD">
          Push in a direction once; let it return to center before the next push.
        </InspectorHeader>
        <div className="space-y-2">
          {STICK_DIRECTIONS.map(({ direction, label, icon: Icon }) => (
            <div
              key={direction}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon aria-hidden className="size-3.5" />
                {label}
              </span>
              <StickActionSelect
                label={`Joystick ${label.toLowerCase()} action`}
                value={config.joystick[direction]}
                onChange={(action) => setStickAction(direction, action)}
              />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (selected.startsWith("AG")) {
    return <AgentKeyInspector slot={Number(selected.slice(3))} agentKeys={agentKeys} />;
  }

  const key = selected as CodexMicroActionKey;
  const action = config.keys[key];
  return (
    <>
      <InspectorHeader title={KEY_NAMES[key]} hardware={key === "ACT10" ? "ACT10 · ACT11" : key}>
        {key === "ACT10"
          ? "The wide key sits on two switches; it acts once per press."
          : "Runs its action once per press."}
      </InspectorHeader>
      <div className="space-y-3">
        <Field label="Action">
          <KeyActionSelect
            label={`${KEY_NAMES[key]} action`}
            value={action}
            onChange={(next) => setKeyAction(key, next)}
          />
        </Field>
        {action.type === "dictation" ? <DictationGestureHelp /> : null}
      </div>
    </>
  );
}

function DictationGestureHelp() {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2.5 text-xs">
      <dt className="font-medium text-foreground">Hold</dt>
      <dd className="text-muted-foreground">Dictate until you let go</dd>
      <dt className="font-medium text-foreground">Double-press</dt>
      <dd className="text-muted-foreground">Keep dictating hands-free</dd>
      <dt className="font-medium text-foreground">Press again</dt>
      <dd className="text-muted-foreground">Stop hands-free dictation</dd>
    </dl>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function keyActionValue(action: CodexMicroKeyAction): string {
  return action.type === "command" ? `command:${action.command}` : action.type;
}

function parseKeyActionValue(value: string): CodexMicroKeyAction | null {
  if (value === "none" || value === "dictation") return { type: value };
  const command = CODEX_MICRO_COMMANDS.find((entry) => `command:${entry.command}` === value);
  return command ? { type: "command", command: command.command } : null;
}

function KeyActionSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CodexMicroKeyAction;
  onChange: (action: CodexMicroKeyAction) => void;
}) {
  return (
    <Select
      value={keyActionValue(value)}
      onValueChange={(next) => {
        const action = next === null ? null : parseKeyActionValue(next);
        if (action) onChange(action);
      }}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue>
          <span className="flex min-w-0 items-center gap-2">
            <KeyActionIcon action={value} className="size-3.5 text-muted-foreground" />
            <span className="truncate">{keyActionLabel(value)}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="dictation">Dictate</SelectItem>
        <SelectGroup>
          <SelectGroupLabel>Commands</SelectGroupLabel>
          {CODEX_MICRO_COMMANDS.map((entry) => (
            <SelectItem key={entry.command} value={`command:${entry.command}`}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectItem value="none">No action</SelectItem>
      </SelectPopup>
    </Select>
  );
}

function stickActionValue(action: CodexMicroStickAction): string {
  if (action.type === "command") return `command:${action.command}`;
  if (action.type === "thread") return `thread:${action.direction}`;
  return "none";
}

function parseStickActionValue(value: string): CodexMicroStickAction | null {
  if (value === "none") return { type: "none" };
  if (value === "thread:previous" || value === "thread:next") {
    return { type: "thread", direction: value === "thread:previous" ? "previous" : "next" };
  }
  const command = CODEX_MICRO_COMMANDS.find((entry) => `command:${entry.command}` === value);
  return command ? { type: "command", command: command.command } : null;
}

function StickActionSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CodexMicroStickAction;
  onChange: (action: CodexMicroStickAction) => void;
}) {
  return (
    <Select
      value={stickActionValue(value)}
      onValueChange={(next) => {
        const action = next === null ? null : parseStickActionValue(next);
        if (action) onChange(action);
      }}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue>
          <span className="truncate">{stickActionLabel(value)}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Agent keys</SelectGroupLabel>
          <SelectItem value="thread:previous">Previous agent key</SelectItem>
          <SelectItem value="thread:next">Next agent key</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectGroupLabel>Commands</SelectGroupLabel>
          {CODEX_MICRO_COMMANDS.map((entry) => (
            <SelectItem key={entry.command} value={`command:${entry.command}`}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectItem value="none">No action</SelectItem>
      </SelectPopup>
    </Select>
  );
}

const AUTOMATIC = "automatic";

function AgentKeyInspector({
  slot,
  agentKeys,
}: {
  slot: number;
  agentKeys: ReturnType<typeof useAgentKeys>;
}) {
  const setSlots = useCodexMicroSlotStore((state) => state.setSlots);
  const clearSlots = useCodexMicroSlotStore((state) => state.clearSlots);
  const entry = agentKeys.keys[slot]!;
  const lighting = entry.statusLabel ? CODEX_MICRO_STATUS_LIGHTING[entry.statusLabel] : null;
  const missing =
    entry.key !== null && !agentKeys.threads.some((thread) => thread.key === entry.key);

  return (
    <>
      <InspectorHeader title={`Agent key ${slot + 1}`} hardware={`AG0${slot}`}>
        Opens its thread and glows with the thread's status. A thread keeps its key until it's
        archived.
      </InspectorHeader>
      <div className="space-y-3">
        <Field label="Thread">
          <Select
            value={missing || entry.key === null ? AUTOMATIC : entry.key}
            onValueChange={(next) => {
              if (next === null) return;
              setSlots(assignThreadToSlot(agentKeys.slots, slot, next === AUTOMATIC ? null : next));
            }}
          >
            <SelectTrigger aria-label={`Thread for agent key ${slot + 1}`} size="sm">
              <SelectValue>
                <span className="truncate">
                  {entry.key === null
                    ? "Next pinned or recent thread"
                    : (entry.title ?? "Untitled thread")}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={AUTOMATIC}>Next pinned or recent thread</SelectItem>
              {agentKeys.threads.length > 0 ? (
                <SelectGroup>
                  <SelectGroupLabel>Threads</SelectGroupLabel>
                  {agentKeys.threads.map((thread) => (
                    <SelectItem key={thread.key} value={thread.key}>
                      <span className="block max-w-72 truncate">
                        {thread.title || "Untitled thread"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectPopup>
          </Select>
        </Field>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              entry.key === null ? "bg-muted-foreground/25" : !lighting && "bg-foreground/45",
            )}
            style={
              lighting && lighting.color !== CODEX_MICRO_IDLE_COLOR
                ? { backgroundColor: hex(lighting.color) }
                : undefined
            }
          />
          {entry.key === null
            ? "Unassigned · light off"
            : missing
              ? "Thread unavailable while its environment is offline"
              : (entry.statusLabel ?? "Idle")}
        </p>
        <LightingLegend />
        <Button
          size="xs"
          variant="ghost"
          className="-ms-2"
          disabled={agentKeys.slots.every((key) => key === null)}
          onClick={clearSlots}
        >
          Reassign all agent keys
        </Button>
      </div>
    </>
  );
}

function LightingLegend() {
  return (
    <ul
      aria-label="Agent key colors"
      className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground"
    >
      {STATUS_LABELS.map(({ label, color }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ backgroundColor: hex(color) }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

function ResetRow() {
  const reset = useCodexMicroConfigStore((state) => state.reset);
  const [open, setOpen] = useState(false);
  return (
    <SettingsRow
      title="Reset controls"
      description="Restore the default key, dial, joystick, and dictation settings. Agent key threads stay where they are."
      control={
        <AlertDialog open={open} onOpenChange={setOpen}>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Reset…
          </Button>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Codex Micro controls?</AlertDialogTitle>
              <AlertDialogDescription>
                Keys, the dial, the joystick, and dictation shortcuts go back to their defaults.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                Reset controls
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      }
    />
  );
}
