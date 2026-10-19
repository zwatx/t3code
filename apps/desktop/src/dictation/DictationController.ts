import type {
  DesktopDictationInput,
  DesktopDictationMode,
  DesktopDictationResult,
  DesktopDictationShortcut,
} from "@t3tools/contracts";

export interface DictationKeyboard {
  press: (shortcut: DesktopDictationShortcut) => void;
  release: () => void;
  tap: (shortcut: DesktopDictationShortcut) => void;
}

/** Owns only the shortcuts T3 sent; provider recording state has no public API. */
export class DictationController {
  private keyboard: DictationKeyboard | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private disposed = false;
  private currentMode: DesktopDictationMode = "idle";
  private latchedShortcut: DesktopDictationShortcut | null = null;
  private readonly loadKeyboard: () => Promise<DictationKeyboard>;
  private readonly canUse: () => boolean;

  constructor(loadKeyboard: () => Promise<DictationKeyboard>, canUse: () => boolean) {
    this.loadKeyboard = loadKeyboard;
    this.canUse = canUse;
  }

  get mode(): DesktopDictationMode {
    return this.currentMode;
  }

  send(input: DesktopDictationInput): Promise<DesktopDictationResult> {
    if (input.action === "stop") return Promise.resolve(this.stop());
    const generation = this.generation;
    const run = this.queue.then(async (): Promise<DesktopDictationResult> => {
      try {
        if (this.disposed || generation !== this.generation) return this.cancelled();
        if (input.action === "hold-end" && this.currentMode !== "holding") return this.result(true);
        if (input.action !== "hold-end" && !this.canUse()) {
          return this.result(
            false,
            "Allow T3 Code in macOS Accessibility to trigger dictation shortcuts.",
          );
        }
        const keyboard = this.keyboard ?? (await this.loadKeyboard());
        if (this.disposed || generation !== this.generation) return this.cancelled();
        this.keyboard = keyboard;
        if (input.action === "hold-start") {
          if (this.currentMode === "holding") return this.result(true);
          if (this.currentMode === "latched")
            return this.result(false, "Stop hands-free dictation before holding to dictate.");
          keyboard.press(input.shortcut);
          this.currentMode = "holding";
        } else if (input.action === "hold-end") {
          keyboard.release();
          this.currentMode = "idle";
        } else {
          if (this.currentMode === "holding") {
            keyboard.release();
            this.currentMode = "idle";
          }
          const shortcut = this.latchedShortcut ?? input.toggleShortcut;
          keyboard.tap(shortcut);
          const latched = this.currentMode !== "latched";
          this.latchedShortcut = latched ? shortcut : null;
          this.currentMode = latched ? "latched" : "idle";
        }
        return this.result(true);
      } catch (error) {
        // A partial key-down must not survive a failed native call.
        let released = false;
        try {
          this.keyboard?.release();
          released = true;
        } catch {}
        if (released && this.currentMode === "holding") this.currentMode = "idle";
        if (!released && this.currentMode === "idle") this.currentMode = "holding";
        return this.result(
          false,
          error instanceof Error ? error.message : "Could not send the dictation shortcut.",
        );
      }
    });
    this.queue = run;
    return run;
  }

  /** Synchronous cleanup also cancels starts still waiting on the native loader. */
  stop(): DesktopDictationResult {
    this.generation += 1;
    try {
      this.keyboard?.release();
      if (this.latchedShortcut !== null) this.keyboard?.tap(this.latchedShortcut);
      this.currentMode = "idle";
      this.latchedShortcut = null;
      return this.result(true);
    } catch (error) {
      return this.result(
        false,
        error instanceof Error ? error.message : "Could not stop the dictation shortcut.",
      );
    }
  }

  shutdown(): void {
    this.disposed = true;
    this.stop();
  }

  private cancelled(): DesktopDictationResult {
    return this.result(false, "Dictation input was cancelled.");
  }

  private result(ok: boolean, message: string | null = null): DesktopDictationResult {
    return { ok, mode: this.currentMode, message };
  }
}
