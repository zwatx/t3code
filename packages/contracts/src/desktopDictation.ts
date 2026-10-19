import * as Schema from "effect/Schema";

export const DesktopDictationShortcut = Schema.Struct({
  modifiers: Schema.Array(Schema.Literals(["control", "alt", "meta", "shift", "fn"])).check(
    Schema.isMaxLength(5),
  ),
  key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(24))),
});
export type DesktopDictationShortcut = typeof DesktopDictationShortcut.Type;

export const DesktopDictationMode = Schema.Literals(["idle", "holding", "latched"]);
export type DesktopDictationMode = typeof DesktopDictationMode.Type;

export const DesktopDictationInput = Schema.Struct({
  action: Schema.Literals(["hold-start", "hold-end", "toggle", "stop"]),
  shortcut: DesktopDictationShortcut,
  toggleShortcut: DesktopDictationShortcut,
});
export type DesktopDictationInput = typeof DesktopDictationInput.Type;

export const DesktopDictationResult = Schema.Struct({
  ok: Schema.Boolean,
  mode: DesktopDictationMode,
  message: Schema.NullOr(Schema.String),
});
export type DesktopDictationResult = typeof DesktopDictationResult.Type;

export const DesktopDictationState = Schema.Struct({
  supported: Schema.Boolean,
  platform: Schema.String,
  accessibilityGranted: Schema.Boolean,
  wisprFlowInstalled: Schema.Boolean,
  mode: DesktopDictationMode,
  message: Schema.NullOr(Schema.String),
});
export type DesktopDictationState = typeof DesktopDictationState.Type;
