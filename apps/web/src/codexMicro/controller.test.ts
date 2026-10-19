import { describe, expect, it } from "vite-plus/test";

import {
  CodexMicroJoystickTracker,
  CodexMicroKeyTracker,
  adjacentSlot,
  assignSlots,
  assignThreadToSlot,
  joystickDirection,
  slotLighting,
} from "./controller";
import { defaultCodexMicroConfig, type CodexMicroConfig } from "./config";

const config = defaultCodexMicroConfig("mac");

describe("Codex Micro keys", () => {
  it("acts once per press and ignores repeats until release", () => {
    const keys = new CodexMicroKeyTracker();

    expect(keys.handle("AG03", 1, config)).toEqual({ type: "slot", slot: 3 });
    expect(keys.handle("AG03", 1, config)).toBeNull();
    expect(keys.handle("AG03", 0, config)).toBeNull();
    expect(keys.handle("AG03", 1, config)).toEqual({ type: "slot", slot: 3 });
  });

  it("maps action keys to their configured actions and ignores the second half of the wide key", () => {
    const keys = new CodexMicroKeyTracker();

    expect(keys.handle("ACT06", 1, config)).toEqual({ type: "command", command: "chat.new" });
    expect(keys.handle("ACT08", 1, config)).toEqual({ type: "command", command: "thread.stop" });
    expect(keys.handle("ACT12", 1, config)).toEqual({ type: "command", command: "diff.toggle" });
    expect(keys.handle("ACT10", 1, config)).toEqual({
      type: "dictation",
      key: "ACT10",
      phase: "press",
    });
    expect(keys.handle("ACT11", 1, config)).toBeNull();
    expect(keys.handle("ACT11", 0, config)).toBeNull();
    expect(keys.handle("AG06", 1, config)).toBeNull();
  });

  it("reports dictation releases with the action the key had when pressed", () => {
    const keys = new CodexMicroKeyTracker();
    const remapped: CodexMicroConfig = {
      ...config,
      keys: { ...config.keys, ACT10: { type: "command", command: "terminal.toggle" } },
    };

    expect(keys.handle("ACT10", 1, config)?.type).toBe("dictation");
    expect(keys.handle("ACT10", 1, remapped)).toBeNull();
    expect(keys.handle("ACT10", 0, remapped)).toEqual({
      type: "dictation",
      key: "ACT10",
      phase: "release",
    });
    expect(keys.handle("ACT10", 1, remapped)).toEqual({
      type: "command",
      command: "terminal.toggle",
    });
    expect(keys.handle("ACT10", 0, config)).toBeNull();
  });

  it("does nothing for keys set to no action", () => {
    const keys = new CodexMicroKeyTracker();
    const cleared: CodexMicroConfig = {
      ...config,
      keys: { ...config.keys, ACT07: { type: "none" } },
    };

    expect(keys.handle("ACT07", 1, cleared)).toBeNull();
    expect(keys.handle("ACT07", 0, cleared)).toBeNull();
  });

  it("steps reasoning on every dial detent and opens the picker on press", () => {
    const keys = new CodexMicroKeyTracker();

    expect(keys.handle("ENC_CW", 2, config)).toEqual({
      type: "command",
      command: "composer.increaseEffort",
    });
    expect(keys.handle("ENC_CW", 2, config)).toEqual({
      type: "command",
      command: "composer.increaseEffort",
    });
    expect(keys.handle("ENC_CC", 2, config)).toEqual({
      type: "command",
      command: "composer.decreaseEffort",
    });
    expect(keys.handle("ENC_SW", 1, config)).toEqual({
      type: "command",
      command: "composer.effort",
    });
  });

  it("follows the configured dial turn", () => {
    const keys = new CodexMicroKeyTracker();
    const threads: CodexMicroConfig = { ...config, dial: { ...config.dial, turn: "threads" } };
    const off: CodexMicroConfig = { ...config, dial: { ...config.dial, turn: "none" } };

    expect(keys.handle("ENC_CW", 2, threads)).toEqual({ type: "thread", direction: "next" });
    expect(keys.handle("ENC_CC", 2, threads)).toEqual({ type: "thread", direction: "previous" });
    expect(keys.handle("ENC_CW", 2, off)).toBeNull();
  });
});

describe("Codex Micro joystick", () => {
  it("reads angles as fractions of a turn", () => {
    expect(joystickDirection(0.75, 1)).toBe("up");
    expect(joystickDirection(0.25, 1)).toBe("down");
    expect(joystickDirection(0.5, 1)).toBe("left");
    expect(joystickDirection(0, 1)).toBe("right");
    expect(joystickDirection(0.75, 0.2)).toBeNull();
  });

  it("fires once per deflection and rearms near center", () => {
    const joystick = new CodexMicroJoystickTracker();

    expect(joystick.handle(0.75, 0.9)).toBe("up");
    expect(joystick.handle(0.76, 1)).toBeNull();
    expect(joystick.handle(0.75, 0.4)).toBeNull();
    expect(joystick.handle(0.75, 0.9)).toBeNull();
    expect(joystick.handle(0.75, 0.1)).toBeNull();
    expect(joystick.handle(0.25, 0.9)).toBe("down");
    expect(joystick.handle(0.5, 0.9)).toBe("left");
  });
});

describe("Codex Micro agent key slots", () => {
  it("puts a chosen thread on a key and swaps it off its old key", () => {
    const slots = ["a", "b", "c", null, null, null];

    expect(assignThreadToSlot(slots, 3, "d")).toEqual(["a", "b", "c", "d", null, null]);
    expect(assignThreadToSlot(slots, 0, "c")).toEqual(["c", "b", "a", null, null, null]);
    expect(assignThreadToSlot(slots, 4, "b")).toEqual(["a", null, "c", null, "b", null]);
    expect(assignThreadToSlot(slots, 1, null)).toEqual(["a", null, "c", null, null, null]);
    expect(assignThreadToSlot([], 2, "x")).toEqual([null, null, "x", null, null, null]);
    expect(assignThreadToSlot(slots, 6, "x")).toEqual(slots);
  });

  it("keeps threads on their keys when candidate order changes", () => {
    const available = new Set(["a", "b", "c"]);
    const first = assignSlots([], ["a", "b", "c"], available);
    expect(first).toEqual(["a", "b", "c", null, null, null]);

    expect(assignSlots(first, ["c", "b", "a"], available)).toEqual(first);
  });

  it("frees keys for removed threads and fills gaps without duplicates", () => {
    const slots = assignSlots(
      ["a", "gone", "c", null, null, null],
      ["d", "c", "a", "e"],
      new Set(["a", "c", "d", "e"]),
    );

    expect(slots).toEqual(["a", "d", "c", "e", null, null]);
  });

  it("steps between assigned keys with wraparound", () => {
    const slots = ["a", null, "c", "d", null, null];

    expect(adjacentSlot(slots, "a", "next")).toBe("c");
    expect(adjacentSlot(slots, "a", "previous")).toBe("d");
    expect(adjacentSlot(slots, null, "next")).toBe("a");
    expect(adjacentSlot(slots, "elsewhere", "previous")).toBe("d");
    expect(adjacentSlot([null, null], null, "next")).toBeNull();
  });

  it("preserves offline assignments while filling empty keys and removing confirmed deletions", () => {
    const previous = ["remote", "deleted-local", null, null, null, null];
    const candidates = ["local-a", "local-b"];
    const available = new Set(candidates);
    const offline = assignSlots(previous, candidates, available, (key) => key !== "remote");
    expect(offline).toEqual(["remote", "local-a", "local-b", null, null, null]);
    expect(assignSlots(offline, candidates, available)).toEqual([
      null,
      "local-a",
      "local-b",
      null,
      null,
      null,
    ]);
  });
});

describe("Codex Micro lighting", () => {
  it("turns unassigned keys off and highlights the open thread", () => {
    expect(slotLighting(4, { assigned: false, status: null, active: false })).toMatchObject({
      id: 4,
      effect: 0,
      brightness: 0,
    });
    const idle = slotLighting(0, { assigned: true, status: null, active: false });
    const open = slotLighting(0, { assigned: true, status: null, active: true });
    expect(open.brightness).toBeGreaterThan(idle.brightness);
  });

  it("pulses for threads waiting on the user", () => {
    expect(
      slotLighting(1, { assigned: true, status: "Pending Approval", active: false }).effect,
    ).toBe(4);
    expect(slotLighting(1, { assigned: true, status: "Completed", active: false }).effect).toBe(1);
  });
});
