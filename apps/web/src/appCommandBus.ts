import type { KeybindingCommand } from "@t3tools/contracts";

// Lets non-keyboard inputs, such as a Codex Micro, run the same command
// handlers as keyboard shortcuts, including their permission checks.
export type AppCommand = KeybindingCommand | "composer.submit";

const APP_COMMAND_EVENT = "t3code:app-command";

/** Returns true when a mounted handler accepted the command. */
export function dispatchAppCommand(command: AppCommand): boolean {
  if (typeof window === "undefined") return false;
  return !window.dispatchEvent(
    new CustomEvent<AppCommand>(APP_COMMAND_EVENT, { detail: command, cancelable: true }),
  );
}

/** The listener returns true when it handled the command. */
export function onAppCommand(listener: (command: AppCommand) => boolean): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (event.defaultPrevented) return;
    const command = (event as CustomEvent<AppCommand>).detail;
    if (typeof command === "string" && listener(command)) event.preventDefault();
  };
  window.addEventListener(APP_COMMAND_EVENT, handler);
  return () => window.removeEventListener(APP_COMMAND_EVENT, handler);
}
