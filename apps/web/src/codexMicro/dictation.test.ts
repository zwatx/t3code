import type { DesktopDictationInput, DesktopDictationResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { defaultCodexMicroConfig, type CodexMicroDictationConfig } from "./config";
import {
  CodexMicroDictationGesture,
  DICTATION_DESKTOP_REQUIRED,
  DICTATION_DOUBLE_PRESS_MS,
  DICTATION_HOLD_MS,
  DICTATION_NEEDS_COMPOSER,
  DictationChannel,
  type DictationAction,
  type DictationBridge,
  type DictationGestureOptions,
  type DictationGesturePhase,
  type DictationScheduler,
} from "./dictation";

const dictation = defaultCodexMicroConfig("mac").dictation;
const otherDictation: CodexMicroDictationConfig = {
  ...dictation,
  holdShortcut: { modifiers: ["control", "alt"], key: null },
  toggleShortcut: { modifiers: ["control", "alt"], key: "Space" },
};

/** A manual clock: timers run only when the test advances time. */
function fakeScheduler() {
  let now = 0;
  let timers: Array<{ at: number; run: () => void; handle: number }> = [];
  let next = 0;
  const scheduler: DictationScheduler = {
    set: (run, ms) => {
      next += 1;
      timers.push({ at: now + ms, run, handle: next });
      return next;
    },
    clear: (handle) => {
      timers = timers.filter((timer) => timer.handle !== handle);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= now).toSorted((a, b) => a.at - b.at)[0];
      if (!due) return;
      timers = timers.filter((timer) => timer !== due);
      due.run();
    }
  };
  return { scheduler, advance, pending: () => timers.length };
}

function setup(options: Omit<DictationGestureOptions, "scheduler"> = {}) {
  const clock = fakeScheduler();
  const sent: Array<{ action: DictationAction; config: CodexMicroDictationConfig; gen: number }> =
    [];
  const gesture = new CodexMicroDictationGesture(
    (action, config, gen) => sent.push({ action, config, gen }),
    { ...options, scheduler: clock.scheduler },
  );
  const actions = () => sent.map((entry) => entry.action);
  return { gesture, clock, sent, actions };
}

/** Taps twice quickly to latch hands-free. */
function latch(gesture: CodexMicroDictationGesture, config = dictation) {
  gesture.press("ACT10", config);
  gesture.release("ACT10");
  gesture.press("ACT10", config);
  gesture.release("ACT10");
}

describe("Codex Micro dictation gesture", () => {
  it("holds the shortcut while the key is held", () => {
    const { gesture, clock, actions } = setup();

    gesture.press("ACT10", dictation);
    expect(actions()).toEqual([]);
    clock.advance(DICTATION_HOLD_MS);
    expect(gesture.state).toBe("holding");
    expect(actions()).toEqual(["hold-start"]);

    gesture.release("ACT10");
    expect(actions()).toEqual(["hold-start", "hold-end"]);
    expect(gesture.state).toBe("idle");
  });

  it("publishes every phase change, including the hold timer's", () => {
    const phases: DictationGesturePhase[] = [];
    const { gesture, clock } = setup({ onChange: (phase) => phases.push(phase) });

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");
    latch(gesture);
    gesture.press("ACT10", dictation);

    expect(phases).toEqual(["pressed", "holding", "idle", "pressed", "tapped", "latched", "idle"]);
  });

  it("does nothing for a single short press", () => {
    const { gesture, clock, actions } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS - 1);
    gesture.release("ACT10");
    expect(gesture.state).toBe("tapped");
    clock.advance(DICTATION_DOUBLE_PRESS_MS);

    expect(actions()).toEqual([]);
    expect(gesture.state).toBe("idle");
    expect(clock.pending()).toBe(0);
  });

  it("latches on a double press and stops on the next single press", () => {
    const { gesture, clock, actions } = setup();

    gesture.press("ACT10", dictation);
    gesture.release("ACT10");
    clock.advance(DICTATION_DOUBLE_PRESS_MS - 1);
    gesture.press("ACT10", dictation);
    expect(actions()).toEqual(["toggle"]);
    expect(gesture.state).toBe("latched");

    // Holding the latching press does not turn into push-to-talk.
    clock.advance(DICTATION_HOLD_MS * 4);
    gesture.release("ACT10");
    expect(gesture.state).toBe("latched");

    gesture.press("ACT10", dictation);
    expect(actions()).toEqual(["toggle", "stop"]);
    expect(gesture.state).toBe("idle");

    // The stopping press's release starts nothing.
    gesture.release("ACT10");
    clock.advance(DICTATION_HOLD_MS * 4);
    expect(actions()).toEqual(["toggle", "stop"]);
  });

  it("treats a second press after the window as a new gesture", () => {
    const { gesture, clock, actions } = setup();

    gesture.press("ACT10", dictation);
    gesture.release("ACT10");
    clock.advance(DICTATION_DOUBLE_PRESS_MS);
    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");

    expect(actions()).toEqual(["hold-start", "hold-end"]);
  });

  it("ignores repeated press and release reports", () => {
    const { gesture, clock, actions } = setup();

    gesture.release("ACT10");
    gesture.press("ACT10", dictation);
    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.press("ACT10", dictation);
    gesture.release("ACT10");
    gesture.release("ACT10");

    expect(actions()).toEqual(["hold-start", "hold-end"]);
  });

  it("ignores other dictation keys while one gesture is active", () => {
    const { gesture, clock, actions } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.press("ACT06", dictation);
    gesture.release("ACT06");
    expect(gesture.state).toBe("holding");
    gesture.release("ACT10");

    expect(actions()).toEqual(["hold-start", "hold-end"]);
  });

  it("releases the shortcuts a gesture started with after settings change", () => {
    const { gesture, clock, sent } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    // A later press with new settings is a repeat and must not swap shortcuts.
    gesture.press("ACT10", otherDictation);
    gesture.release("ACT10");

    expect(sent.map((entry) => entry.config)).toEqual([dictation, dictation]);
  });

  it("declines to start without a message field, and never asks the desktop app", () => {
    let focusable = false;
    const phases: DictationGesturePhase[] = [];
    const { gesture, clock, actions } = setup({
      canStart: () => focusable,
      onChange: (phase) => phases.push(phase),
    });

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS * 4);
    expect(gesture.state).toBe("idle");
    gesture.release("ACT10");

    latch(gesture);
    expect(gesture.state).toBe("idle");
    expect(actions()).toEqual([]);
    expect(phases.at(-1)).toBe("idle");

    // Once a message field can take text, the same key works again.
    focusable = true;
    clock.advance(DICTATION_DOUBLE_PRESS_MS);
    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");
    expect(actions()).toEqual(["hold-start", "hold-end"]);
  });

  it("cancels held and hands-free dictation", () => {
    const held = setup();
    held.gesture.press("ACT10", dictation);
    held.clock.advance(DICTATION_HOLD_MS);
    held.gesture.cancel();
    held.gesture.release("ACT10");
    expect(held.actions()).toEqual(["hold-start", "hold-end"]);

    const latched = setup();
    latched.gesture.press("ACT10", dictation);
    latched.gesture.release("ACT10");
    latched.gesture.press("ACT10", dictation);
    latched.gesture.cancel();
    expect(latched.actions()).toEqual(["toggle", "stop"]);
    expect(latched.gesture.state).toBe("idle");

    const pending = setup();
    pending.gesture.press("ACT10", dictation);
    pending.gesture.cancel();
    pending.clock.advance(DICTATION_HOLD_MS * 4);
    expect(pending.actions()).toEqual([]);
    expect(pending.clock.pending()).toBe(0);
  });

  it("forgets a start the desktop app declined, but not from an older gesture", () => {
    const { gesture, clock, sent } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");
    const first = sent[0]!;

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    // A late idle reply to the first gesture must not drop the live hold.
    gesture.handleResult({ mode: "idle" }, "hold-start", first.gen, dictation);
    expect(gesture.state).toBe("holding");
    gesture.release("ACT10");
    expect(sent.at(-1)?.action).toBe("hold-end");

    latch(gesture);
    gesture.handleResult({ mode: "idle" }, "toggle", sent.at(-1)!.gen, dictation);
    expect(gesture.state).toBe("idle");
  });

  it("retries a failed release with the shortcut that is still held", () => {
    const { gesture, clock, sent } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");
    const holdEnd = sent.at(-1)!;
    expect(holdEnd.action).toBe("hold-end");

    // The desktop app still owns the held shortcut.
    gesture.handleResult({ mode: "holding" }, "hold-end", holdEnd.gen, dictation);
    expect(gesture.state).toBe("latched");

    // The next press stops with the original shortcuts, despite new settings.
    gesture.press("ACT10", otherDictation);
    expect(sent.at(-1)).toMatchObject({ action: "stop", config: dictation });
    expect(gesture.state).toBe("idle");
    gesture.release("ACT10");
    clock.advance(DICTATION_HOLD_MS * 4);
    expect(sent).toHaveLength(3);
  });

  it("retries a failed stop on cleanup, and again after another failure", () => {
    const { gesture, sent } = setup();

    latch(gesture);
    gesture.press("ACT10", dictation);
    const stop = sent.at(-1)!;
    expect(stop.action).toBe("stop");

    gesture.handleResult({ mode: "latched" }, "stop", stop.gen, dictation);
    expect(gesture.state).toBe("latched");
    gesture.release("ACT10");

    gesture.cancel();
    expect(sent.at(-1)?.action).toBe("stop");
    gesture.handleResult({ mode: "latched" }, "stop", stop.gen, dictation);
    expect(gesture.state).toBe("latched");

    gesture.handleResult({ mode: "idle" }, "stop", stop.gen, dictation);
    expect(gesture.state).toBe("idle");
    gesture.press("ACT10", dictation);
    expect(gesture.state).toBe("pressed");
  });

  it("lets a failed release interrupt a newer gesture that has not started yet", () => {
    const { gesture, clock, sent } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");
    const holdEnd = sent.at(-1)!;

    gesture.press("ACT10", otherDictation);
    expect(gesture.state).toBe("pressed");
    gesture.handleResult({ mode: "holding" }, "hold-end", holdEnd.gen, dictation);
    expect(gesture.state).toBe("latched");
    clock.advance(DICTATION_HOLD_MS * 4);
    gesture.release("ACT10");

    expect(sent.map((entry) => entry.action)).toEqual(["hold-start", "hold-end"]);
    gesture.press("ACT10", otherDictation);
    expect(sent.at(-1)).toMatchObject({ action: "stop", config: dictation });
  });

  it("ignores a late failed release once a newer gesture owns the shortcut", () => {
    const { gesture, clock, sent } = setup();

    gesture.press("ACT10", dictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.release("ACT10");
    const holdEnd = sent.at(-1)!;

    gesture.press("ACT10", otherDictation);
    clock.advance(DICTATION_HOLD_MS);
    gesture.handleResult({ mode: "holding" }, "hold-end", holdEnd.gen, dictation);
    expect(gesture.state).toBe("holding");
    gesture.release("ACT10");
    expect(sent.at(-1)).toMatchObject({ action: "hold-end", config: otherDictation });
  });
});

interface Deferred {
  readonly input: DesktopDictationInput;
  readonly resolve: (result: DesktopDictationResult) => void;
  readonly reject: (error: Error) => void;
}

/** A desktop bridge whose replies the test releases one at a time. */
function deferredBridge() {
  const calls: Deferred[] = [];
  const bridge: DictationBridge = {
    getDictationState: () => Promise.reject(new Error("unused")),
    sendDictationInput: (input) =>
      new Promise((resolve, reject) => calls.push({ input, resolve, reject })),
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { bridge, calls, settle };
}

const ok = (mode: DesktopDictationResult["mode"]): DesktopDictationResult => ({
  ok: true,
  mode,
  message: null,
});

describe("Codex Micro dictation channel", () => {
  it.each(["focus", "disposal"] as const)(
    "rechecks %s after awaited cleanup before posting a start",
    async (reason) => {
      const { bridge, calls, settle } = deferredBridge();
      const channel = new DictationChannel(() => bridge);
      const replies: DesktopDictationResult[] = [];
      let focused = true;
      const owner = channel.open(
        (result) => replies.push(result),
        () => focused,
      );
      owner.send("toggle", dictation, 1);
      await settle();
      calls[0]!.resolve(ok("latched"));
      await settle();
      owner.send("hold-start", otherDictation, 2);
      await settle();
      expect(calls[1]!.input.action).toBe("stop");
      if (reason === "focus") focused = false;
      else owner.dispose();
      calls[1]!.resolve(ok("idle"));
      await settle();
      expect(calls.map((call) => call.input.action)).toEqual(["toggle", "stop"]);
      expect(replies).toEqual(
        reason === "focus"
          ? [ok("latched"), { ok: false, mode: "idle", message: DICTATION_NEEDS_COMPOSER }]
          : [ok("latched")],
      );
    },
  );

  it("retains an uncertain first start and stops it before the next start", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const replies: DesktopDictationResult[] = [];
    const owner = channel.open((result) => replies.push(result));
    owner.send("hold-start", dictation, 1);
    await settle();
    calls[0]!.reject(new Error("Start reply lost."));
    await settle();
    expect(replies[0]).toEqual({ ok: false, mode: "holding", message: "Start reply lost." });
    owner.send("hold-start", otherDictation, 2);
    await settle();
    expect(calls[1]!.input).toMatchObject({ action: "stop", shortcut: dictation.holdShortcut });
    calls[1]!.resolve(ok("idle"));
    await settle();
    expect(calls[2]!.input).toMatchObject({
      action: "hold-start",
      shortcut: otherDictation.holdShortcut,
    });
    calls[2]!.resolve(ok("holding"));
    await settle();
  });

  it("sends steps in order, one at a time, with the step's shortcuts", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const replies: string[] = [];
    const owner = channel.open((result, action) => replies.push(`${action}:${result.mode}`));

    owner.send("hold-start", dictation, 1);
    owner.send("hold-end", dictation, 1);
    await settle();
    expect(calls.map((call) => call.input.action)).toEqual(["hold-start"]);
    expect(calls[0]!.input).toEqual({
      action: "hold-start",
      shortcut: { modifiers: ["fn"], key: null },
      toggleShortcut: { modifiers: ["fn"], key: "Space" },
    });

    calls[0]!.resolve(ok("holding"));
    await settle();
    expect(calls.map((call) => call.input.action)).toEqual(["hold-start", "hold-end"]);
    calls[1]!.resolve(ok("idle"));
    await settle();
    expect(replies).toEqual(["hold-start:holding", "hold-end:idle"]);
  });

  it("finishes a torn-down session's release before the next session's start", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const oldReplies: string[] = [];
    const newReplies: string[] = [];
    const old = channel.open((result, action) => oldReplies.push(`${action}:${result.mode}`));

    // Disconnect while the old session's start is still waiting on the desktop app.
    old.send("hold-start", dictation, 1);
    await settle();
    old.send("hold-end", dictation, 1);
    old.dispose();

    const next = channel.open((result, action) => newReplies.push(`${action}:${result.mode}`));
    next.send("hold-start", otherDictation, 1);

    calls[0]!.resolve(ok("holding"));
    await settle();
    expect(calls.map((call) => call.input.action)).toEqual(["hold-start", "hold-end"]);
    calls[1]!.resolve(ok("idle"));
    await settle();
    expect(calls.map((call) => call.input.action)).toEqual([
      "hold-start",
      "hold-end",
      "hold-start",
    ]);
    expect(calls[2]!.input.shortcut).toEqual(otherDictation.holdShortcut);
    calls[2]!.resolve(ok("holding"));
    await settle();

    expect(oldReplies).toEqual([]);
    expect(newReplies).toEqual(["hold-start:holding"]);
  });

  it("drops a torn-down session's queued starts", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const blocker = channel.open(() => undefined);
    const old = channel.open(() => undefined);

    blocker.send("stop", dictation, 1);
    old.send("toggle", dictation, 1);
    old.dispose();
    await settle();
    calls[0]!.resolve(ok("idle"));
    await settle();

    expect(calls.map((call) => call.input.action)).toEqual(["stop"]);
  });

  it("stops a shortcut a failed release left held before starting again", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const old = channel.open(() => undefined);

    old.send("hold-start", dictation, 1);
    await settle();
    old.send("hold-end", dictation, 1);
    old.dispose();
    calls[0]!.resolve(ok("holding"));
    await settle();
    calls[1]!.resolve({ ok: false, mode: "holding", message: "Couldn't release Fn." });
    await settle();

    const replies: DesktopDictationResult[] = [];
    const next = channel.open((result) => replies.push(result));
    next.send("toggle", otherDictation, 1);
    await settle();
    expect(calls[2]!.input).toMatchObject({ action: "stop", shortcut: dictation.holdShortcut });
    calls[2]!.resolve(ok("idle"));
    await settle();
    expect(calls[3]!.input).toMatchObject({
      action: "toggle",
      toggleShortcut: otherDictation.toggleShortcut,
    });
    calls[3]!.resolve(ok("latched"));
    await settle();
    expect(replies).toEqual([ok("latched")]);
  });

  it("declines a start while a held shortcut still can't be released", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const replies: DesktopDictationResult[] = [];
    const owner = channel.open((result) => replies.push(result));

    owner.send("hold-start", dictation, 1);
    owner.send("hold-end", dictation, 1);
    await settle();
    calls[0]!.resolve(ok("holding"));
    await settle();
    calls[1]!.resolve({ ok: false, mode: "holding", message: "Stuck." });
    await settle();

    owner.send("hold-start", dictation, 2);
    await settle();
    calls[2]!.resolve({ ok: false, mode: "holding", message: "Still stuck." });
    await settle();

    expect(calls.map((call) => call.input.action)).toEqual(["hold-start", "hold-end", "stop"]);
    expect(replies.at(-1)).toEqual({ ok: false, mode: "holding", message: "Still stuck." });
  });

  it("keeps the owned mode when the desktop app call throws", async () => {
    const { bridge, calls, settle } = deferredBridge();
    const channel = new DictationChannel(() => bridge);
    const replies: DesktopDictationResult[] = [];
    const owner = channel.open((result) => replies.push(result));

    owner.send("toggle", dictation, 1);
    owner.send("stop", dictation, 1);
    await settle();
    calls[0]!.resolve(ok("latched"));
    await settle();
    calls[1]!.reject(new Error("IPC closed."));
    await settle();

    expect(replies.at(-1)).toEqual({ ok: false, mode: "latched", message: "IPC closed." });
  });

  it("explains that the desktop app is required when there is no bridge", async () => {
    const channel = new DictationChannel(() => null);
    const replies: DesktopDictationResult[] = [];
    channel.open((result) => replies.push(result)).send("hold-start", dictation, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(replies).toEqual([{ ok: false, mode: "idle", message: DICTATION_DESKTOP_REQUIRED }]);
  });
});
