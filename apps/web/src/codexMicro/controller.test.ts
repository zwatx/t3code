import { describe, expect, it } from "vite-plus/test";

import {
  CodexMicroJoystickTracker,
  CodexMicroKeyTracker,
  adjacentSlot,
  assignSlots,
  joystickDirection,
  slotLighting,
} from "./controller";

describe("Codex Micro keys", () => {
  it("acts once per press and ignores repeats until release", () => {
    const keys = new CodexMicroKeyTracker();

    expect(keys.handle("AG03", 1)).toEqual({ type: "slot", slot: 3 });
    expect(keys.handle("AG03", 1)).toBeNull();
    expect(keys.handle("AG03", 0)).toBeNull();
    expect(keys.handle("AG03", 1)).toEqual({ type: "slot", slot: 3 });
  });

  it("maps action keys to app commands and ignores the second half of the double key", () => {
    const keys = new CodexMicroKeyTracker();

    expect(keys.handle("ACT06", 1)).toEqual({ type: "command", command: "chat.new" });
    expect(keys.handle("ACT08", 1)).toEqual({ type: "command", command: "thread.stop" });
    expect(keys.handle("ACT10", 1)).toEqual({ type: "command", command: "terminal.toggle" });
    expect(keys.handle("ACT11", 1)).toBeNull();
    expect(keys.handle("AG06", 1)).toBeNull();
  });

  it("steps reasoning on every dial detent and opens the picker on press", () => {
    const keys = new CodexMicroKeyTracker();

    expect(keys.handle("ENC_CW", 2)).toEqual({
      type: "command",
      command: "composer.increaseEffort",
    });
    expect(keys.handle("ENC_CW", 2)).toEqual({
      type: "command",
      command: "composer.increaseEffort",
    });
    expect(keys.handle("ENC_CC", 2)).toEqual({
      type: "command",
      command: "composer.decreaseEffort",
    });
    expect(keys.handle("ENC_SW", 1)).toEqual({ type: "command", command: "composer.effort" });
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

    expect(joystick.handle(0.75, 0.9)).toBe("previous");
    expect(joystick.handle(0.76, 1)).toBeNull();
    expect(joystick.handle(0.75, 0.4)).toBeNull();
    expect(joystick.handle(0.75, 0.9)).toBeNull();
    expect(joystick.handle(0.75, 0.1)).toBeNull();
    expect(joystick.handle(0.25, 0.9)).toBe("next");
  });
});

describe("Codex Micro agent key slots", () => {
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
