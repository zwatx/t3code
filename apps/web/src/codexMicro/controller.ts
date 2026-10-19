import type { ThreadStatusPill } from "~/components/Sidebar.logic";

import type {
  CodexMicroActionKey,
  CodexMicroCommand,
  CodexMicroConfig,
  CodexMicroKeyAction,
} from "./config";
import { CodexMicroLightingEffect, type CodexMicroSlotLighting } from "./protocol";

export const CODEX_MICRO_SLOT_COUNT = 6;

const KEY_PRESS = 1;
const KEY_RELEASE = 0;
const ENCODER_ROTATE = 2;

export type CodexMicroAction =
  | { readonly type: "slot"; readonly slot: number }
  | { readonly type: "command"; readonly command: CodexMicroCommand }
  /** Step through the agent-key threads. */
  | { readonly type: "thread"; readonly direction: "previous" | "next" }
  | { readonly type: "dictation"; readonly key: string; readonly phase: "press" | "release" };

const ACTION_KEYS: ReadonlySet<string> = new Set<CodexMicroActionKey>([
  "ACT06",
  "ACT07",
  "ACT08",
  "ACT09",
  "ACT10",
  "ACT12",
]);

function agentSlot(key: string): number | null {
  const match = /^AG0([0-5])$/.exec(key);
  return match ? Number(match[1]) : null;
}

function isDialPress(key: string): boolean {
  return key.startsWith("ENC") && key !== "ENC_CW" && key !== "ENC_CC";
}

type HeldAction = CodexMicroKeyAction | { readonly type: "slot"; readonly slot: number };

/**
 * Turns raw key reports into actions. A press acts once; repeats before the
 * matching release are dropped so a held or re-reported key never fires twice.
 * The action is fixed at press time, so a key remapped while held still
 * releases what it pressed.
 */
export class CodexMicroKeyTracker {
  private readonly held = new Map<string, HeldAction>();

  handle(key: string, act: number, config: CodexMicroConfig): CodexMicroAction | null {
    if (act === ENCODER_ROTATE) {
      if (key !== "ENC_CW" && key !== "ENC_CC") return null;
      const forward = key === "ENC_CW";
      if (config.dial.turn === "effort") {
        return {
          type: "command",
          command: forward ? "composer.increaseEffort" : "composer.decreaseEffort",
        };
      }
      if (config.dial.turn === "threads") {
        return { type: "thread", direction: forward ? "next" : "previous" };
      }
      return null;
    }
    if (act === KEY_RELEASE) {
      const held = this.held.get(key);
      this.held.delete(key);
      return held?.type === "dictation" ? { type: "dictation", key, phase: "release" } : null;
    }
    if (act !== KEY_PRESS || this.held.has(key)) return null;
    const action = this.pressAction(key, config);
    if (action === null) return null;
    this.held.set(key, action);
    switch (action.type) {
      case "slot":
      case "command":
        return action;
      case "dictation":
        return { type: "dictation", key, phase: "press" };
      case "none":
        return null;
    }
  }

  reset(): void {
    this.held.clear();
  }

  private pressAction(key: string, config: CodexMicroConfig): HeldAction | null {
    const slot = agentSlot(key);
    if (slot !== null) return { type: "slot", slot };
    // ACT11 is the second switch under the wide ACT10 keycap.
    if (ACTION_KEYS.has(key)) return config.keys[key as CodexMicroActionKey];
    if (isDialPress(key)) return config.dial.press;
    return null;
  }
}

export type JoystickDirection = "up" | "down" | "left" | "right";

const JOYSTICK_ENGAGE = 0.5;
const JOYSTICK_RELEASE = 0.3;

// Angles are fractions of a turn, as the ChatGPT desktop bridge reads them.
export function joystickDirection(angle: number, distance: number): JoystickDirection | null {
  if (distance < JOYSTICK_ENGAGE) return null;
  const turn = ((angle % 1) + 1) % 1;
  if (turn >= 0.625 && turn < 0.875) return "up";
  if (turn >= 0.125 && turn < 0.375) return "down";
  if (turn >= 0.375 && turn < 0.625) return "left";
  return "right";
}

/** Fires once per deflection; the stick must return toward center to fire again. */
export class CodexMicroJoystickTracker {
  private active: JoystickDirection | null = null;

  handle(angle: number, distance: number): JoystickDirection | null {
    if (distance < JOYSTICK_RELEASE) {
      this.active = null;
      return null;
    }
    const direction = joystickDirection(angle, distance);
    if (direction === null || direction === this.active) return null;
    this.active = direction;
    return direction;
  }

  reset(): void {
    this.active = null;
  }
}

/** The assigned slot before or after `current`, wrapping; the first or last when none is open. */
export function adjacentSlot(
  slots: ReadonlyArray<string | null>,
  current: string | null,
  direction: "previous" | "next",
): string | null {
  const assigned = slots.filter((key): key is string => key !== null);
  const index = current === null ? -1 : assigned.indexOf(current);
  const step = direction === "next" ? 1 : -1;
  const target = index === -1 ? (direction === "next" ? 0 : -1) : index + step;
  return assigned[(target + assigned.length) % assigned.length] ?? null;
}

export function assignSlots(
  previous: ReadonlyArray<string | null>,
  candidates: ReadonlyArray<string>,
  available: ReadonlySet<string>,
  canRemoveMissing: (key: string) => boolean = () => true,
): Array<string | null> {
  const slots = Array.from({ length: CODEX_MICRO_SLOT_COUNT }, (_, index) => {
    const key = previous[index] ?? null;
    return key !== null && (available.has(key) || !canRemoveMissing(key)) ? key : null;
  });
  const taken = new Set(slots);
  const fill = candidates.filter((key) => !taken.has(key) && available.has(key));
  return slots.map((key) => key ?? fill.shift() ?? null);
}

/** Puts a thread on an agent key, swapping keys if it already has one. Null frees the key. */
export function assignThreadToSlot(
  previous: ReadonlyArray<string | null>,
  slot: number,
  key: string | null,
): Array<string | null> {
  const slots = Array.from(
    { length: CODEX_MICRO_SLOT_COUNT },
    (_, index) => previous[index] ?? null,
  );
  if (slot < 0 || slot >= CODEX_MICRO_SLOT_COUNT) return slots;
  const existing = key === null ? -1 : slots.indexOf(key);
  if (existing !== -1) slots[existing] = slots[slot] ?? null;
  slots[slot] = key;
  return slots;
}

/** Pinned threads first, then the most recently messaged. */
export function compareSlotCandidates(
  a: {
    readonly pinnedAt: string | null;
    readonly latestUserMessageAt: string | null;
    readonly createdAt: string;
  },
  b: {
    readonly pinnedAt: string | null;
    readonly latestUserMessageAt: string | null;
    readonly createdAt: string;
  },
): number {
  if ((a.pinnedAt === null) !== (b.pinnedAt === null)) return a.pinnedAt === null ? 1 : -1;
  const aAt = a.latestUserMessageAt ?? a.createdAt;
  const bAt = b.latestUserMessageAt ?? b.createdAt;
  return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
}

const OFF: Omit<CodexMicroSlotLighting, "id"> = {
  color: 0,
  brightness: 0,
  effect: CodexMicroLightingEffect.off,
  speed: 0,
};

export const CODEX_MICRO_STATUS_LIGHTING: Readonly<
  Record<ThreadStatusPill["label"], { color: number; effect: CodexMicroLightingEffect }>
> = {
  "Pending Approval": { color: 0xffa000, effect: CodexMicroLightingEffect.breath },
  "Awaiting Input": { color: 0x6366f1, effect: CodexMicroLightingEffect.breath },
  Failed: { color: 0xef4444, effect: CodexMicroLightingEffect.solid },
  Working: { color: 0x0ea5e9, effect: CodexMicroLightingEffect.shallowBreath },
  Connecting: { color: 0x0ea5e9, effect: CodexMicroLightingEffect.shallowBreath },
  Waiting: { color: 0x0ea5e9, effect: CodexMicroLightingEffect.solid },
  "Plan Ready": { color: 0x8b5cf6, effect: CodexMicroLightingEffect.solid },
  Completed: { color: 0x10b981, effect: CodexMicroLightingEffect.solid },
};

export const CODEX_MICRO_IDLE_COLOR = 0xffffff;

export interface CodexMicroSlotState {
  readonly assigned: boolean;
  readonly status: ThreadStatusPill["label"] | null;
  readonly active: boolean;
}

/** The open thread's key glows brighter so the user can see where they are. */
export function slotLighting(id: number, slot: CodexMicroSlotState): CodexMicroSlotLighting {
  if (!slot.assigned) return { id, ...OFF };
  const status = slot.status === null ? null : CODEX_MICRO_STATUS_LIGHTING[slot.status];
  if (status === null) {
    return {
      id,
      color: CODEX_MICRO_IDLE_COLOR,
      brightness: slot.active ? 0.5 : 0.12,
      effect: CodexMicroLightingEffect.solid,
      speed: 0,
    };
  }
  return {
    id,
    color: status.color,
    brightness: slot.active ? 1 : 0.6,
    effect: status.effect,
    speed: 0.5,
  };
}
