import type {
  DesktopDictationInput,
  DesktopDictationMode,
  DesktopDictationResult,
  DesktopDictationState,
} from "@t3tools/contracts";
import { create } from "zustand";

import type { CodexMicroDictationConfig } from "./config";

// A dictation key is hold to talk, double-press to keep listening, and a single
// press while listening to stop. The desktop app turns each step into the
// dictation app's own global shortcut; T3 Code never touches audio. Modes here
// mean which shortcut the desktop app expects to own, not whether the
// dictation app is actually recording.

/** A press held this long is push-to-talk rather than the start of a tap. */
export const DICTATION_HOLD_MS = 220;
/** The second press of a double-press must land this soon after the first release. */
export const DICTATION_DOUBLE_PRESS_MS = 320;

export type DictationAction = DesktopDictationInput["action"];

export function isDictationStart(action: DictationAction): boolean {
  return action === "hold-start" || action === "toggle";
}

export type DictationGesturePhase =
  /** Nothing pressed and no dictation running. */
  | "idle"
  /** First press, not yet long enough to be a hold. */
  | "pressed"
  /** Push-to-talk shortcut is held down. */
  | "holding"
  /** A short press was released; a second press latches. */
  | "tapped"
  /** Hands-free dictation is on, or a release failed and the next press stops it. */
  | "latched";

export interface DictationScheduler {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const browserScheduler: DictationScheduler = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface DictationGestureOptions {
  readonly scheduler?: DictationScheduler;
  /**
   * Runs synchronously just before dictation starts. Returning false declines
   * the start, for example when no message field can take the text.
   */
  readonly canStart?: () => boolean;
  readonly onChange?: (phase: DictationGesturePhase) => void;
}

/**
 * Turns press and release reports from one key into dictation steps. Each
 * gesture keeps the shortcuts it started with, so editing settings or remapping
 * the key mid-gesture still releases exactly what was pressed.
 */
export class CodexMicroDictationGesture {
  private phase: DictationGesturePhase = "idle";
  private owner: string | null = null;
  private keyDown = false;
  private snapshot: CodexMicroDictationConfig | null = null;
  private timer: unknown = null;
  private generation = 0;
  private readonly scheduler: DictationScheduler;

  constructor(
    private readonly emit: (
      action: DictationAction,
      config: CodexMicroDictationConfig,
      generation: number,
    ) => void,
    private readonly options: DictationGestureOptions = {},
  ) {
    this.scheduler = options.scheduler ?? browserScheduler;
  }

  get state(): DictationGesturePhase {
    return this.phase;
  }

  press(key: string, config: CodexMicroDictationConfig): void {
    if (this.owner !== null && key !== this.owner) return;
    if (this.keyDown) return;
    this.keyDown = true;
    this.owner = key;
    switch (this.phase) {
      case "idle":
        this.snapshot = config;
        this.generation += 1;
        this.setPhase("pressed");
        this.schedule(() => {
          if (this.phase !== "pressed") return;
          if (!this.allowStart()) return;
          this.setPhase("holding");
          this.send("hold-start");
        }, DICTATION_HOLD_MS);
        return;
      case "tapped":
        this.cancelTimer();
        if (!this.allowStart()) return;
        this.setPhase("latched");
        this.send("toggle");
        return;
      case "latched":
        // This press stops; its release must not start anything.
        this.send("stop");
        this.settle();
        return;
      default:
        return;
    }
  }

  release(key: string): void {
    if (key !== this.owner || !this.keyDown) return;
    this.keyDown = false;
    switch (this.phase) {
      case "pressed":
        this.cancelTimer();
        this.setPhase("tapped");
        this.schedule(() => {
          if (this.phase === "tapped") this.finish();
        }, DICTATION_DOUBLE_PRESS_MS);
        return;
      case "holding":
        this.send("hold-end");
        this.finish();
        return;
      case "latched":
        return;
      default:
        this.owner = null;
    }
  }

  /** Ends any held or hands-free dictation, as on disconnect, blur, or a settings change. */
  cancel(): void {
    if (this.phase === "holding") this.send("hold-end");
    else if (this.phase === "latched") this.send("stop");
    this.finish();
  }

  /**
   * Reconciles with the desktop app's reply. A start that came back idle ends
   * its gesture. A release that left a shortcut owned brings back a pending
   * stop with the shortcuts that are still held, so the next press or cleanup
   * retries it. Replies about an older gesture never end a newer one.
   */
  handleResult(
    result: Pick<DesktopDictationResult, "mode">,
    action: DictationAction,
    generation: number,
    config: CodexMicroDictationConfig,
  ): void {
    const current = generation === this.generation;
    if (result.mode === "idle") {
      // Nothing is owned any more: a declined start, or a retried release that worked.
      const owned = isDictationStart(action)
        ? this.phase === "holding" || this.phase === "latched"
        : this.phase === "latched";
      if (current && owned) this.finish();
      return;
    }
    if (isDictationStart(action)) return;
    if (!current && (this.phase === "holding" || this.phase === "latched")) return;
    this.cancelTimer();
    if (!this.keyDown) this.owner = null;
    this.snapshot = config;
    this.setPhase("latched");
  }

  private allowStart(): boolean {
    if (this.options.canStart?.() ?? true) return true;
    this.settle();
    return false;
  }

  private send(action: DictationAction): void {
    if (this.snapshot !== null) this.emit(action, this.snapshot, this.generation);
  }

  /** Idle, while remembering a key that is still down so its release is ignored. */
  private settle(): void {
    const { owner, keyDown } = this;
    this.finish();
    this.owner = keyDown ? owner : null;
    this.keyDown = keyDown;
  }

  private finish(): void {
    this.cancelTimer();
    this.owner = null;
    this.keyDown = false;
    this.snapshot = null;
    this.setPhase("idle");
  }

  private setPhase(phase: DictationGesturePhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    this.options.onChange?.(phase);
  }

  private schedule(callback: () => void, ms: number): void {
    this.cancelTimer();
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      callback();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clear(this.timer);
    this.timer = null;
  }
}

export interface DictationBridge {
  readonly getDictationState: () => Promise<DesktopDictationState>;
  readonly sendDictationInput: (input: DesktopDictationInput) => Promise<DesktopDictationResult>;
}

/** The desktop app's dictation methods; null in browsers and older desktop builds. */
export function readDictationBridge(): DictationBridge | null {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  if (!bridge?.getDictationState || !bridge.sendDictationInput) return null;
  return {
    getDictationState: bridge.getDictationState,
    sendDictationInput: bridge.sendDictationInput,
  };
}

export const DICTATION_DESKTOP_REQUIRED =
  "Dictation from Codex Micro needs the T3 Code desktop app on macOS.";

export const DICTATION_NEEDS_COMPOSER =
  "Open a thread you can message, then try again. Dictation types into its message box.";

export type DictationResultListener = (
  result: DesktopDictationResult,
  action: DictationAction,
  generation: number,
  config: CodexMicroDictationConfig,
) => void;

export interface DictationOwner {
  readonly send: (
    action: DictationAction,
    config: CodexMicroDictationConfig,
    generation: number,
  ) => void;
  /** Drops queued starts and silences replies; queued releases still run. */
  readonly dispose: () => void;
}

/**
 * The one ordered line to the desktop app. Every connected-device session
 * sends through it, so a release from a session being torn down always
 * reaches the desktop app before the next session's start, and a shortcut
 * left held by a failed release is stopped before anything new starts.
 */
export class DictationChannel {
  private queue: Promise<void> = Promise.resolve();
  private owned: { mode: DesktopDictationMode; config: CodexMicroDictationConfig | null } = {
    mode: "idle",
    config: null,
  };

  constructor(private readonly readBridge: () => DictationBridge | null) {}

  open(listener: DictationResultListener, canStart: () => boolean = () => true): DictationOwner {
    let disposed = false;
    return {
      send: (action, config, generation) => {
        this.queue = this.queue.then(async () => {
          if (disposed && isDictationStart(action)) return;
          const result = await this.run(action, config, () => !disposed && canStart());
          if (!disposed) listener(result, action, generation, config);
        });
      },
      dispose: () => {
        disposed = true;
      },
    };
  }

  private async run(
    action: DictationAction,
    config: CodexMicroDictationConfig,
    canStart: () => boolean,
  ): Promise<DesktopDictationResult> {
    const bridge = this.readBridge();
    if (bridge === null) return { ok: false, mode: "idle", message: DICTATION_DESKTOP_REQUIRED };
    if (isDictationStart(action) && this.owned.mode !== "idle" && this.owned.config !== null) {
      const cleared = await this.call(bridge, "stop", this.owned.config);
      if (cleared.mode !== "idle") {
        return {
          ok: false,
          mode: cleared.mode,
          message: cleared.message ?? "Couldn't release the previous dictation shortcut.",
        };
      }
    }
    if (isDictationStart(action) && !canStart()) {
      return { ok: false, mode: "idle", message: DICTATION_NEEDS_COMPOSER };
    }
    return this.call(bridge, action, config);
  }

  private async call(
    bridge: DictationBridge,
    action: DictationAction,
    config: CodexMicroDictationConfig,
  ): Promise<DesktopDictationResult> {
    let result: DesktopDictationResult;
    try {
      result = await bridge.sendDictationInput({
        action,
        shortcut: config.holdShortcut,
        toggleShortcut: config.toggleShortcut,
      });
    } catch (error) {
      // A lost start reply can still have posted keys. Keep its shortcuts for cleanup.
      if (isDictationStart(action)) {
        this.owned = { mode: action === "hold-start" ? "holding" : "latched", config };
      }
      return {
        ok: false,
        mode: this.owned.mode,
        message: error instanceof Error && error.message ? error.message : "Dictation failed.",
      };
    }
    this.owned = { mode: result.mode, config: result.mode === "idle" ? null : config };
    return result;
  }
}

export const codexMicroDictationChannel = new DictationChannel(readDictationBridge);

export interface CodexMicroDictationStatus {
  /** What the Micro is asking for; the dictation app's own state is not observable. */
  readonly mode: DesktopDictationMode;
  readonly error: string | null;
}

export const useCodexMicroDictationStatus = create<CodexMicroDictationStatus>()(() => ({
  mode: "idle",
  error: null,
}));

export function gestureMode(phase: DictationGesturePhase): DesktopDictationMode {
  return phase === "holding" ? "holding" : phase === "latched" ? "latched" : "idle";
}
