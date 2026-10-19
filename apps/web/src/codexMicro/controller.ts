import type { AppCommand } from "~/appCommandBus";
import type { ThreadStatusPill } from "~/components/Sidebar.logic";

import { CodexMicroLightingEffect, type CodexMicroSlotLighting } from "./protocol";

export const CODEX_MICRO_SLOT_COUNT = 6;

const KEY_PRESS = 1;
const KEY_RELEASE = 0;
const ENCODER_ROTATE = 2;

export type CodexMicroAction =
  | { readonly type: "slot"; readonly slot: number }
  | { readonly type: "command"; readonly command: AppCommand };

// ACT10 and ACT11 sit under one double-width keycap in the stock layout and
// both report, so only ACT10 acts.
const KEY_COMMANDS: Readonly<Record<string, AppCommand>> = {
  ACT06: "chat.new",
  ACT07: "composer.submit",
  ACT08: "thread.stop",
  ACT09: "commandPalette.toggle",
  ACT10: "terminal.toggle",
  ACT12: "diff.toggle",
};

export const CODEX_MICRO_CONTROL_MAP: ReadonlyArray<{
  readonly control: string;
  readonly action: string;
}> = [
  { control: "Agent keys 1–6", action: "Open the thread assigned to that key" },
  { control: "ACT06", action: "New thread" },
  { control: "ACT07", action: "Send message" },
  { control: "ACT08", action: "Stop the running turn" },
  { control: "ACT09", action: "Command palette" },
  { control: "ACT10", action: "Toggle terminal" },
  { control: "ACT12", action: "Toggle diff" },
  { control: "Dial", action: "Raise or lower reasoning effort; press to choose" },
  { control: "Joystick up / down", action: "Previous or next agent-key thread" },
];

function agentSlot(key: string): number | null {
  const match = /^AG0([0-5])$/.exec(key);
  return match ? Number(match[1]) : null;
}

/**
 * Turns raw key reports into actions. A press acts once; repeats before the
 * matching release are dropped so a held or re-reported key never fires twice.
 */
export class CodexMicroKeyTracker {
  private readonly held = new Set<string>();

  handle(key: string, act: number): CodexMicroAction | null {
    if (act === ENCODER_ROTATE) {
      if (key === "ENC_CW") return { type: "command", command: "composer.increaseEffort" };
      if (key === "ENC_CC") return { type: "command", command: "composer.decreaseEffort" };
      return null;
    }
    const action = this.pressAction(key);
    if (action === null) return null;
    if (act === KEY_RELEASE) {
      this.held.delete(key);
      return null;
    }
    if (act !== KEY_PRESS || this.held.has(key)) return null;
    this.held.add(key);
    return action;
  }

  reset(): void {
    this.held.clear();
  }

  private pressAction(key: string): CodexMicroAction | null {
    const slot = agentSlot(key);
    if (slot !== null) return { type: "slot", slot };
    const command = KEY_COMMANDS[key];
    if (command) return { type: "command", command };
    if (key.startsWith("ENC") && key !== "ENC_CW" && key !== "ENC_CC") {
      return { type: "command", command: "composer.effort" };
    }
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

  handle(angle: number, distance: number): "previous" | "next" | null {
    if (distance < JOYSTICK_RELEASE) {
      this.active = null;
      return null;
    }
    const direction = joystickDirection(angle, distance);
    if (direction === null || direction === this.active) return null;
    this.active = direction;
    if (direction === "up") return "previous";
    if (direction === "down") return "next";
    return null;
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

const OFF: Omit<CodexMicroSlotLighting, "id"> = {
  color: 0,
  brightness: 0,
  effect: CodexMicroLightingEffect.off,
  speed: 0,
};

const STATUS_LIGHTING: Readonly<
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

const IDLE_COLOR = 0xffffff;

export interface CodexMicroSlotState {
  readonly assigned: boolean;
  readonly status: ThreadStatusPill["label"] | null;
  readonly active: boolean;
}

/** The open thread's key glows brighter so the user can see where they are. */
export function slotLighting(id: number, slot: CodexMicroSlotState): CodexMicroSlotLighting {
  if (!slot.assigned) return { id, ...OFF };
  const status = slot.status === null ? null : STATUS_LIGHTING[slot.status];
  if (status === null) {
    return {
      id,
      color: IDLE_COLOR,
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
