import * as NodeEvents from "node:events";
import type * as Electron from "electron";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

const { keyboard, trusted } = vi.hoisted(() => ({
  keyboard: { press: vi.fn(), release: vi.fn(), tap: vi.fn() },
  trusted: vi.fn(() => true),
}));
vi.mock("electron", () => ({ systemPreferences: { isTrustedAccessibilityClient: trusted } }));
vi.mock("../../dictation/MacDictationKeyboard.ts", () => ({
  loadMacDictationKeyboard: async () => keyboard,
}));

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { GET_DICTATION_STATE_CHANNEL, SEND_DICTATION_INPUT_CHANNEL } from "../channels.ts";
import { installDictation } from "./dictation.ts";

function fixture(platform: NodeJS.Platform = "darwin") {
  vi.clearAllMocks();
  trusted.mockReturnValue(true);
  const frame = { url: "t3code://app/" };
  const contents = Object.assign(new NodeEvents.EventEmitter(), { id: 7, mainFrame: frame });
  const focused = vi.fn(() => true);
  const window = Object.assign(new NodeEvents.EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
    isFocused: focused,
  });
  const appListeners = new Map<string, () => void>();
  const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  const layer = Layer.mergeAll(
    DesktopIpc.layer({
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    }),
    Layer.mock(ElectronApp.ElectronApp)({
      on: (name, listener) =>
        Effect.sync(() => {
          appListeners.set(name, listener as () => void);
        }),
    }),
    Layer.mock(ElectronWindow.ElectronWindow)({
      currentMainOrFirst: Effect.succeedSome(window as unknown as Electron.BrowserWindow),
    }),
    Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
      platform,
      isDevelopment: false,
      homeDirectory: "/test-home",
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
    Layer.succeed(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: (location) => Effect.succeed(location === "/Applications/Wispr Flow.app"),
      }),
    ),
    Path.layer,
  );
  const event = { sender: { id: 7 }, senderFrame: frame };
  const send = (action: string, sender = event) =>
    Effect.promise(async () =>
      handlers.get(SEND_DICTATION_INPUT_CHANNEL)!(sender, {
        action,
        shortcut: { modifiers: ["fn"], key: null },
        toggleShortcut: { modifiers: ["fn"], key: "space" },
      }),
    );
  return { layer, window, contents, focused, handlers, appListeners, event, send };
}

describe("native dictation IPC", () => {
  it.effect("reports local desktop permission and installation state", () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* installDictation();
      const state = yield* Effect.promise(async () =>
        f.handlers.get(GET_DICTATION_STATE_CHANNEL)!(f.event, undefined),
      );
      assert.deepEqual(state, {
        supported: true,
        platform: "darwin",
        accessibilityGranted: true,
        wisprFlowInstalled: true,
        mode: "idle",
        message: null,
      });
      assert.deepEqual(trusted.mock.calls, [[false]]);
    }).pipe(Effect.scoped, Effect.provide(f.layer));
  });

  it.effect("denies other renderers, missing Accessibility and background starts", () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* installDictation();
      const deniedSender = yield* f.send("hold-start", {
        sender: { id: 8 },
        senderFrame: f.event.senderFrame,
      });
      assert.propertyVal(deniedSender, "ok", false);
      trusted.mockReturnValue(false);
      assert.propertyVal(yield* f.send("hold-start"), "ok", false);
      trusted.mockReturnValue(true);
      f.focused.mockReturnValue(false);
      assert.propertyVal(yield* f.send("hold-start"), "ok", false);
      assert.strictEqual(keyboard.press.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(f.layer));
  });

  it.effect.each(["blur", "reload", "render-process-gone", "destroyed"] as const)(
    "releases a held shortcut on %s",
    (reason) => {
      const f = fixture();
      return Effect.gen(function* () {
        yield* installDictation();
        assert.propertyVal(yield* f.send("hold-start"), "mode", "holding");
        const releases = keyboard.release.mock.calls.length;
        if (reason === "blur") f.window.emit(reason);
        else if (reason === "reload")
          f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
        else f.contents.emit(reason);
        assert.strictEqual(keyboard.release.mock.calls.length, releases + 1);
        assert.propertyVal(yield* f.send("hold-end"), "mode", "idle");
      }).pipe(Effect.scoped, Effect.provide(f.layer));
    },
  );

  it.effect("stops hands-free before quitting and rejects further starts", () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* installDictation();
      assert.propertyVal(yield* f.send("toggle"), "mode", "latched");
      f.appListeners.get("before-quit")!();
      assert.strictEqual(keyboard.tap.mock.calls.length, 2);
      assert.propertyVal(yield* f.send("hold-start"), "ok", false);
    }).pipe(Effect.scoped, Effect.provide(f.layer));
  });

  it.effect("keeps other Micro actions independent of unsupported native dictation", () => {
    const f = fixture("win32");
    return Effect.gen(function* () {
      yield* installDictation();
      assert.propertyVal(yield* f.send("toggle"), "ok", false);
      const state = yield* Effect.promise(async () =>
        f.handlers.get(GET_DICTATION_STATE_CHANNEL)!(f.event, undefined),
      );
      assert.propertyVal(state, "supported", false);
      assert.strictEqual(keyboard.tap.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(f.layer));
  });
});
