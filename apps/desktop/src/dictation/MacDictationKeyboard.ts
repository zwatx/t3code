import type { DesktopDictationShortcut } from "@t3tools/contracts";
import type { DictationKeyboard } from "./DictationController.ts";

const MODIFIERS = {
  control: { code: 59, flag: 0x40000 },
  alt: { code: 58, flag: 0x80000 },
  meta: { code: 55, flag: 0x100000 },
  shift: { code: 56, flag: 0x20000 },
  fn: { code: 63, flag: 0x800000 },
} as const;

// macOS virtual keys are physical key positions, independent of keyboard layout.
const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  o: 31,
  u: 32,
  "[": 33,
  i: 34,
  p: 35,
  enter: 36,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  n: 45,
  m: 46,
  ".": 47,
  tab: 48,
  space: 49,
  " ": 49,
  "`": 50,
  backspace: 51,
  escape: 53,
  f17: 64,
  f18: 79,
  f19: 80,
  f20: 90,
  f5: 96,
  f6: 97,
  f7: 98,
  f3: 99,
  f8: 100,
  f9: 101,
  f11: 103,
  f13: 105,
  f16: 106,
  f14: 107,
  f10: 109,
  f12: 111,
  f15: 113,
  home: 115,
  pageup: 116,
  delete: 117,
  f4: 118,
  end: 119,
  f2: 120,
  pagedown: 121,
  f1: 122,
  arrowleft: 123,
  arrowright: 124,
  arrowdown: 125,
  arrowup: 126,
};

export interface MacDictationEventApi {
  flags: () => number;
  isKeyDown: (code: number) => boolean;
  post: (code: number, down: boolean, flags: number, modifier: boolean) => void;
}

type OwnedKey = { readonly code: number; readonly flag: number };

export function createMacDictationKeyboard(api: MacDictationEventApi): DictationKeyboard {
  let held: OwnedKey[] = [];
  const release = () => {
    // The user can press or release unrelated modifiers during a long hold.
    let flags = api.flags() | held.reduce((value, key) => value | key.flag, 0);
    const failed: OwnedKey[] = [];
    let failure: unknown;
    for (const key of held.toReversed()) {
      flags &= ~key.flag;
      try {
        api.post(key.code, false, flags, key.flag !== 0);
      } catch (error) {
        failed.unshift(key);
        failure ??= error;
      }
    }
    held = failed;
    if (failure !== undefined) throw failure;
  };
  const press = (shortcut: DesktopDictationShortcut) => {
    if (held.length > 0) throw new Error("The previous dictation shortcut is still held.");
    if (new Set(shortcut.modifiers).size !== shortcut.modifiers.length) {
      throw new Error("Choose each shortcut modifier only once.");
    }
    if (shortcut.key === null && shortcut.modifiers.length === 0) {
      throw new Error("Choose a dictation shortcut first.");
    }
    const code = shortcut.key === null ? null : KEY_CODES[shortcut.key.toLowerCase()];
    if (code === undefined) throw new Error("This dictation shortcut key is not supported.");
    if (code !== null && api.isKeyDown(code))
      throw new Error("Release the shortcut keys before dictating.");
    const baselineFlags = api.flags();
    let flags = baselineFlags;
    const keys: OwnedKey[] = shortcut.modifiers.map((modifier) => MODIFIERS[modifier]);
    if (code !== null) keys.push({ code, flag: 0 });
    try {
      for (const key of keys) {
        if (key.flag !== 0 && (baselineFlags & key.flag) !== 0) continue;
        flags |= key.flag;
        held.push(key);
        api.post(key.code, true, flags, key.flag !== 0);
      }
    } catch (error) {
      try {
        release();
      } catch {}
      throw error;
    }
  };
  return {
    press,
    release,
    tap: (shortcut) => {
      press(shortcut);
      release();
    },
  };
}

let keyboardPromise: Promise<DictationKeyboard> | null = null;

export function loadMacDictationKeyboard(): Promise<DictationKeyboard> {
  keyboardPromise ??= import("ffi-rs").then(({ DataType, isNullPointer, load, open }) => {
    const graphics = "t3-dictation-coregraphics";
    const foundation = "t3-dictation-corefoundation";
    open({
      library: graphics,
      path: "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
    });
    open({
      library: foundation,
      path: "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
    });
    return createMacDictationKeyboard({
      flags: () =>
        load({
          library: graphics,
          funcName: "CGEventSourceFlagsState",
          retType: DataType.U64,
          paramsType: [DataType.I32],
          paramsValue: [0],
        }) as number,
      isKeyDown: (code) =>
        load({
          library: graphics,
          funcName: "CGEventSourceKeyState",
          retType: DataType.Boolean,
          paramsType: [DataType.I32, DataType.I16],
          paramsValue: [0, code],
        }) as boolean,
      post: (code, down, flags, modifier) => {
        const event = load({
          library: graphics,
          funcName: "CGEventCreateKeyboardEvent",
          retType: DataType.External,
          paramsType: [DataType.BigInt, DataType.I16, DataType.Boolean],
          paramsValue: [0n, code, down],
        });
        if (isNullPointer(event)) throw new Error("macOS could not create a dictation key event.");
        try {
          load({
            library: graphics,
            funcName: "CGEventSetFlags",
            retType: DataType.Void,
            paramsType: [DataType.External, DataType.U64],
            paramsValue: [event, flags],
          });
          if (modifier)
            load({
              library: graphics,
              funcName: "CGEventSetType",
              retType: DataType.Void,
              paramsType: [DataType.External, DataType.I32],
              paramsValue: [event, 12],
            });
          load({
            library: graphics,
            funcName: "CGEventPost",
            retType: DataType.Void,
            paramsType: [DataType.I32, DataType.External],
            paramsValue: [0, event],
          });
        } finally {
          load({
            library: foundation,
            funcName: "CFRelease",
            retType: DataType.Void,
            paramsType: [DataType.External],
            paramsValue: [event],
          });
        }
      },
    });
  });
  return keyboardPromise;
}
