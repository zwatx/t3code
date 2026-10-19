import type { DesktopDictationShortcut } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AppCommand } from "~/appCommandBus";
import { resolveStorage } from "~/lib/storage";

// What each Codex Micro control does. Thread keys (AG00–AG05) are not here:
// they always open their assigned thread, and assignments live in the slot store.

/** Commands a control can run. Each has a handler on the app command bus. */
export const CODEX_MICRO_COMMANDS = [
  { command: "chat.new", label: "New thread" },
  { command: "composer.submit", label: "Send message" },
  { command: "thread.stop", label: "Stop the running turn" },
  { command: "commandPalette.toggle", label: "Command palette" },
  { command: "diff.toggle", label: "Toggle diff" },
  { command: "terminal.toggle", label: "Toggle terminal" },
  { command: "terminal.new", label: "New terminal" },
  { command: "rightPanel.toggle", label: "Toggle side panel" },
  { command: "modelPicker.toggle", label: "Model picker" },
  { command: "composer.effort", label: "Reasoning effort picker" },
  { command: "composer.increaseEffort", label: "Raise reasoning effort" },
  { command: "composer.decreaseEffort", label: "Lower reasoning effort" },
  { command: "composer.mode", label: "Mode picker" },
  { command: "thread.pin", label: "Pin or unpin thread" },
  { command: "chat.find", label: "Find in thread" },
  { command: "thread.copyReference", label: "Copy thread reference" },
] as const satisfies ReadonlyArray<{ command: AppCommand; label: string }>;

export type CodexMicroCommand = (typeof CODEX_MICRO_COMMANDS)[number]["command"];

const COMMAND_IDS: ReadonlySet<string> = new Set(
  CODEX_MICRO_COMMANDS.map((entry) => entry.command),
);

export function codexMicroCommandLabel(command: CodexMicroCommand): string {
  return CODEX_MICRO_COMMANDS.find((entry) => entry.command === command)?.label ?? command;
}

export type CodexMicroKeyAction =
  | { readonly type: "none" }
  | { readonly type: "dictation" }
  | { readonly type: "command"; readonly command: CodexMicroCommand };

export type CodexMicroStickAction =
  | { readonly type: "none" }
  | { readonly type: "thread"; readonly direction: "previous" | "next" }
  | { readonly type: "command"; readonly command: CodexMicroCommand };

/**
 * Configurable keys. ACT10 and ACT11 sit under one double-width keycap and
 * both report, so ACT10 stands for the wide key and ACT11 is ignored.
 */
export const CODEX_MICRO_ACTION_KEYS = [
  "ACT06",
  "ACT07",
  "ACT08",
  "ACT09",
  "ACT10",
  "ACT12",
] as const;
export type CodexMicroActionKey = (typeof CODEX_MICRO_ACTION_KEYS)[number];

export const CODEX_MICRO_STICK_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type CodexMicroStickDirection = (typeof CODEX_MICRO_STICK_DIRECTIONS)[number];

/** What turning the dial steps through. */
export type CodexMicroDialTurn = "effort" | "threads" | "none";

export type CodexMicroDictationProvider = "wispr-flow" | "custom";

export type CodexMicroShortcut = DesktopDictationShortcut;

export interface CodexMicroDictationConfig {
  readonly provider: CodexMicroDictationProvider;
  /** Held for as long as the key is held. */
  readonly holdShortcut: CodexMicroShortcut;
  /** Pressed once to start, and again to stop, hands-free dictation. */
  readonly toggleShortcut: CodexMicroShortcut;
}

export interface CodexMicroConfig {
  readonly version: 1;
  readonly keys: Readonly<Record<CodexMicroActionKey, CodexMicroKeyAction>>;
  readonly dial: { readonly turn: CodexMicroDialTurn; readonly press: CodexMicroKeyAction };
  readonly joystick: Readonly<Record<CodexMicroStickDirection, CodexMicroStickAction>>;
  readonly dictation: CodexMicroDictationConfig;
}

export type CodexMicroPlatform = "mac" | "windows" | "other";

export function detectCodexMicroPlatform(): CodexMicroPlatform {
  if (typeof navigator === "undefined") return "other";
  const platform = navigator.platform.toLowerCase();
  if (platform.startsWith("mac")) return "mac";
  if (platform.startsWith("win")) return "windows";
  return "other";
}

export interface CodexMicroShortcutPreset {
  readonly id: string;
  readonly label: string;
  readonly hold: CodexMicroShortcut;
  readonly toggle: CodexMicroShortcut;
}

// Wispr Flow's documented defaults: push-to-talk, and the same keys plus Space
// for hands-free. Keyboards without an Apple Fn key use Control+Option.
export const WISPR_FLOW_PRESETS: Readonly<Record<CodexMicroPlatform, CodexMicroShortcutPreset[]>> =
  {
    mac: [
      {
        id: "mac-fn",
        label: "Fn",
        hold: { modifiers: ["fn"], key: null },
        toggle: { modifiers: ["fn"], key: "Space" },
      },
      {
        id: "mac-control-option",
        label: "Control + Option",
        hold: { modifiers: ["control", "alt"], key: null },
        toggle: { modifiers: ["control", "alt"], key: "Space" },
      },
    ],
    windows: [
      {
        id: "windows-control-win",
        label: "Ctrl + Win",
        hold: { modifiers: ["control", "meta"], key: null },
        toggle: { modifiers: ["control", "meta"], key: "Space" },
      },
    ],
    other: [],
  };

export function defaultCodexMicroConfig(
  platform: CodexMicroPlatform = detectCodexMicroPlatform(),
): CodexMicroConfig {
  const preset = WISPR_FLOW_PRESETS[platform][0] ?? WISPR_FLOW_PRESETS.mac[0]!;
  return {
    version: 1,
    keys: {
      ACT06: { type: "command", command: "chat.new" },
      ACT07: { type: "command", command: "composer.submit" },
      ACT08: { type: "command", command: "thread.stop" },
      ACT09: { type: "command", command: "commandPalette.toggle" },
      ACT10: { type: "dictation" },
      ACT12: { type: "command", command: "diff.toggle" },
    },
    dial: { turn: "effort", press: { type: "command", command: "composer.effort" } },
    joystick: {
      up: { type: "thread", direction: "previous" },
      down: { type: "thread", direction: "next" },
      left: { type: "none" },
      right: { type: "none" },
    },
    dictation: { provider: "wispr-flow", holdShortcut: preset.hold, toggleShortcut: preset.toggle },
  };
}

// Stored config is untrusted: an older build, a hand edit, or a removed
// command must never break the device. Each invalid field falls back alone.

const SHORTCUT_MODIFIERS = ["fn", "control", "alt", "shift", "meta"] as const;
export type CodexMicroShortcutModifier = (typeof SHORTCUT_MODIFIERS)[number];

/** Keys the desktop app can press, besides single letters and digits. */
export const SHORTCUT_NAMED_KEYS = [
  "Space",
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  ...Array.from({ length: 20 }, (_, index) => `F${index + 1}`),
] as const;

const NAMED_KEYS: ReadonlySet<string> = new Set(SHORTCUT_NAMED_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidShortcutKey(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || NAMED_KEYS.has(key);
}

function parseShortcut(value: unknown): CodexMicroShortcut | null {
  if (!isRecord(value) || !Array.isArray(value.modifiers)) return null;
  const modifiers = SHORTCUT_MODIFIERS.filter((modifier) =>
    (value.modifiers as unknown[]).includes(modifier),
  );
  if (modifiers.length !== value.modifiers.length) return null;
  const key = value.key;
  if (key !== null && (typeof key !== "string" || !isValidShortcutKey(key))) return null;
  if (modifiers.length === 0 && key === null) return null;
  return { modifiers, key };
}

function parseCommand(value: unknown): CodexMicroCommand | null {
  return typeof value === "string" && COMMAND_IDS.has(value) ? (value as CodexMicroCommand) : null;
}

function parseKeyAction(value: unknown): CodexMicroKeyAction | null {
  if (!isRecord(value)) return null;
  if (value.type === "none" || value.type === "dictation") return { type: value.type };
  if (value.type === "command") {
    const command = parseCommand(value.command);
    return command === null ? null : { type: "command", command };
  }
  return null;
}

function parseStickAction(value: unknown): CodexMicroStickAction | null {
  if (!isRecord(value)) return null;
  if (value.type === "none") return { type: "none" };
  if (value.type === "thread" && (value.direction === "previous" || value.direction === "next")) {
    return { type: "thread", direction: value.direction };
  }
  if (value.type === "command") {
    const command = parseCommand(value.command);
    return command === null ? null : { type: "command", command };
  }
  return null;
}

export function sanitizeCodexMicroConfig(
  value: unknown,
  fallback: CodexMicroConfig = defaultCodexMicroConfig(),
): CodexMicroConfig {
  if (!isRecord(value) || value.version !== 1) return fallback;
  const keys = isRecord(value.keys) ? value.keys : {};
  const dial = isRecord(value.dial) ? value.dial : {};
  const joystick = isRecord(value.joystick) ? value.joystick : {};
  const dictation = isRecord(value.dictation) ? value.dictation : {};
  return {
    version: 1,
    keys: Object.fromEntries(
      CODEX_MICRO_ACTION_KEYS.map((key) => [key, parseKeyAction(keys[key]) ?? fallback.keys[key]]),
    ) as Record<CodexMicroActionKey, CodexMicroKeyAction>,
    dial: {
      turn:
        dial.turn === "effort" || dial.turn === "threads" || dial.turn === "none"
          ? dial.turn
          : fallback.dial.turn,
      press: parseKeyAction(dial.press) ?? fallback.dial.press,
    },
    joystick: Object.fromEntries(
      CODEX_MICRO_STICK_DIRECTIONS.map((direction) => [
        direction,
        parseStickAction(joystick[direction]) ?? fallback.joystick[direction],
      ]),
    ) as Record<CodexMicroStickDirection, CodexMicroStickAction>,
    dictation: {
      provider:
        dictation.provider === "wispr-flow" || dictation.provider === "custom"
          ? dictation.provider
          : fallback.dictation.provider,
      holdShortcut: parseShortcut(dictation.holdShortcut) ?? fallback.dictation.holdShortcut,
      toggleShortcut: parseShortcut(dictation.toggleShortcut) ?? fallback.dictation.toggleShortcut,
    },
  };
}

export function shortcutsEqual(a: CodexMicroShortcut, b: CodexMicroShortcut): boolean {
  return (
    a.key === b.key &&
    a.modifiers.length === b.modifiers.length &&
    a.modifiers.every((modifier) => b.modifiers.includes(modifier))
  );
}

const MODIFIER_LABELS: Readonly<
  Record<CodexMicroPlatform, Record<CodexMicroShortcutModifier, string>>
> = {
  mac: { fn: "Fn", control: "Control", alt: "Option", shift: "Shift", meta: "Command" },
  windows: { fn: "Fn", control: "Ctrl", alt: "Alt", shift: "Shift", meta: "Win" },
  other: { fn: "Fn", control: "Ctrl", alt: "Alt", shift: "Shift", meta: "Super" },
};

export function modifierLabel(
  modifier: CodexMicroShortcutModifier,
  platform: CodexMicroPlatform,
): string {
  return MODIFIER_LABELS[platform][modifier];
}

export function shortcutKeyLabels(
  shortcut: CodexMicroShortcut,
  platform: CodexMicroPlatform,
): string[] {
  return [
    ...SHORTCUT_MODIFIERS.filter((modifier) => shortcut.modifiers.includes(modifier)).map(
      (modifier) => modifierLabel(modifier, platform),
    ),
    ...(shortcut.key === null ? [] : [shortcut.key]),
  ];
}

export function orderedModifiers(
  modifiers: ReadonlyArray<CodexMicroShortcutModifier>,
): CodexMicroShortcutModifier[] {
  return SHORTCUT_MODIFIERS.filter((modifier) => modifiers.includes(modifier));
}

export { SHORTCUT_MODIFIERS as CODEX_MICRO_SHORTCUT_MODIFIERS };

interface CodexMicroConfigStoreState {
  readonly config: CodexMicroConfig;
  readonly setKeyAction: (key: CodexMicroActionKey, action: CodexMicroKeyAction) => void;
  readonly setDialTurn: (turn: CodexMicroDialTurn) => void;
  readonly setDialPress: (action: CodexMicroKeyAction) => void;
  readonly setStickAction: (
    direction: CodexMicroStickDirection,
    action: CodexMicroStickAction,
  ) => void;
  readonly setDictation: (dictation: Partial<CodexMicroDictationConfig>) => void;
  readonly reset: () => void;
}

export const useCodexMicroConfigStore = create<CodexMicroConfigStoreState>()(
  persist(
    (set) => ({
      config: defaultCodexMicroConfig(),
      setKeyAction: (key, action) =>
        set(({ config }) => ({ config: { ...config, keys: { ...config.keys, [key]: action } } })),
      setDialTurn: (turn) =>
        set(({ config }) => ({ config: { ...config, dial: { ...config.dial, turn } } })),
      setDialPress: (press) =>
        set(({ config }) => ({ config: { ...config, dial: { ...config.dial, press } } })),
      setStickAction: (direction, action) =>
        set(({ config }) => ({
          config: { ...config, joystick: { ...config.joystick, [direction]: action } },
        })),
      setDictation: (dictation) =>
        set(({ config }) => ({
          config: sanitizeCodexMicroConfig(
            { ...config, dictation: { ...config.dictation, ...dictation } },
            config,
          ),
        })),
      reset: () => set({ config: defaultCodexMicroConfig() }),
    }),
    {
      name: "t3code:codex-micro-config:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ config: state.config }),
      merge: (persisted, current) => ({
        ...current,
        config: sanitizeCodexMicroConfig(
          isRecord(persisted) ? persisted.config : undefined,
          current.config,
        ),
      }),
    },
  ),
);
