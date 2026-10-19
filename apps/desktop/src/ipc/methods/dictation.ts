import {
  DesktopDictationInput,
  DesktopDictationResult,
  DesktopDictationState,
} from "@t3tools/contracts";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { DictationController } from "../../dictation/DictationController.ts";
import { isDictationSender } from "../../dictation/DictationSender.ts";
import { loadMacDictationKeyboard } from "../../dictation/MacDictationKeyboard.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import { getDesktopUrl } from "../../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { GET_DICTATION_STATE_CHANNEL, SEND_DICTATION_INPUT_CHANNEL } from "../channels.ts";

export const installDictation = Effect.fn("desktop.ipc.installDictation")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const windows = yield* ElectronWindow.ElectronWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const supported = environment.platform === "darwin";
  const accessibilityGranted = () =>
    supported && Electron.systemPreferences.isTrustedAccessibilityClient(false);
  let owner: Electron.BrowserWindow | null = null;
  const controller = new DictationController(
    loadMacDictationKeyboard,
    () => accessibilityGranted() && owner !== null && !owner.isDestroyed() && owner.isFocused(),
  );
  const stop = () => {
    controller.stop();
  };
  const bindings = new Map<Electron.BrowserWindow, () => void>();
  const bind = (window: Electron.BrowserWindow) => {
    owner = window;
    if (bindings.has(window)) return;
    const contents = window.webContents;
    const onNavigation = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ) => {
      if (event.isMainFrame && !event.isSameDocument) stop();
    };
    window.on("blur", stop);
    contents.on("did-start-navigation", onNavigation);
    contents.on("render-process-gone", stop);
    contents.on("destroyed", stop);
    const cleanup = () => {
      window.removeListener("blur", stop);
      contents.removeListener("did-start-navigation", onNavigation);
      contents.removeListener("render-process-gone", stop);
      contents.removeListener("destroyed", stop);
      bindings.delete(window);
    };
    window.once("closed", cleanup);
    bindings.set(window, () => {
      window.removeListener("closed", cleanup);
      cleanup();
    });
  };
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: GET_DICTATION_STATE_CHANNEL,
      payload: Schema.Undefined,
      result: DesktopDictationState,
      handler: () =>
        Effect.gen(function* () {
          const installed =
            supported &&
            (yield* Effect.forEach(
              [
                "/Applications/Wispr Flow.app",
                path.join(environment.homeDirectory, "Applications", "Wispr Flow.app"),
              ],
              (location) => fs.exists(location).pipe(Effect.orElseSucceed(() => false)),
            )).some(Boolean);
          return {
            supported,
            platform: environment.platform,
            accessibilityGranted: accessibilityGranted(),
            wisprFlowInstalled: installed,
            mode: controller.mode,
            message: supported
              ? null
              : "Native external dictation currently requires T3 Code for macOS.",
          };
        }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SEND_DICTATION_INPUT_CHANNEL,
      payload: DesktopDictationInput,
      result: DesktopDictationResult,
      handler: (input, event) =>
        Effect.gen(function* () {
          const window = yield* windows.currentMainOrFirst;
          if (
            Option.isNone(window) ||
            window.value.isDestroyed() ||
            !isDictationSender(
              event,
              window.value.webContents,
              getDesktopUrl(environment.isDevelopment),
            )
          ) {
            return {
              ok: false,
              mode: controller.mode,
              message: "Dictation input requires the main T3 Code window.",
            };
          }
          if (!supported)
            return {
              ok: false,
              mode: controller.mode,
              message: "Native external dictation currently requires T3 Code for macOS.",
            };
          if (input.action !== "hold-end" && input.action !== "stop" && !window.value.isFocused()) {
            return {
              ok: false,
              mode: controller.mode,
              message: "Focus T3 Code before starting dictation.",
            };
          }
          bind(window.value);
          return yield* Effect.promise(() => controller.send(input));
        }),
    }),
  );
  yield* app.on("before-quit", () => controller.shutdown());
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      controller.shutdown();
      for (const cleanup of bindings.values()) cleanup();
    }),
  );
});
