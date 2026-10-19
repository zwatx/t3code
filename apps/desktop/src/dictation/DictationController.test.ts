import { describe, expect, it, vi } from "vite-plus/test";
import type { DesktopDictationInput, DesktopDictationShortcut } from "@t3tools/contracts";
import { DictationController, type DictationKeyboard } from "./DictationController.ts";

const shortcut: DesktopDictationShortcut = { modifiers: ["fn"], key: null };
const toggleShortcut: DesktopDictationShortcut = { modifiers: ["fn"], key: "space" };
const input = (action: DesktopDictationInput["action"]): DesktopDictationInput => ({
  action,
  shortcut,
  toggleShortcut,
});
const fixture = () => {
  const keyboard: DictationKeyboard = { press: vi.fn(), release: vi.fn(), tap: vi.fn() };
  const canUse = vi.fn(() => true);
  const load = vi.fn(async () => keyboard);
  return { keyboard, canUse, load, controller: new DictationController(load, canUse) };
};

describe("DictationController", () => {
  it("serializes down/up while loading and ignores repeated starts/releases", async () => {
    const { keyboard, controller } = fixture();
    const down = controller.send(input("hold-start"));
    const repeated = controller.send(input("hold-start"));
    const up = controller.send(input("hold-end"));
    expect((await down).mode).toBe("holding");
    await repeated;
    expect((await up).mode).toBe("idle");
    await controller.send(input("hold-end"));
    expect(keyboard.press).toHaveBeenCalledExactlyOnceWith(shortcut);
    expect(keyboard.release).toHaveBeenCalledTimes(1);
  });

  it("stops latched dictation using the shortcut that started it after settings change", async () => {
    const { keyboard, controller } = fixture();
    expect((await controller.send(input("toggle"))).mode).toBe("latched");
    await controller.send({
      ...input("toggle"),
      toggleShortcut: { modifiers: ["control"], key: "x" },
    });
    expect(keyboard.tap).toHaveBeenNthCalledWith(1, toggleShortcut);
    expect(keyboard.tap).toHaveBeenNthCalledWith(2, toggleShortcut);
    expect(controller.mode).toBe("idle");
  });

  it("releases a hold before switching to hands-free", async () => {
    const { keyboard, controller } = fixture();
    await controller.send(input("hold-start"));
    expect((await controller.send(input("toggle"))).mode).toBe("latched");
    expect(keyboard.release).toHaveBeenCalledTimes(1);
    expect(keyboard.tap).toHaveBeenCalledExactlyOnceWith(toggleShortcut);
    expect((await controller.send(input("hold-start"))).ok).toBe(false);
    expect(controller.stop().mode).toBe("idle");
    expect(keyboard.tap).toHaveBeenCalledTimes(2);
  });

  it("cancels queued and loading starts on focus loss without posting keys", async () => {
    const deferred = Promise.withResolvers<DictationKeyboard>();
    const loading = Promise.withResolvers<void>();
    const keyboard: DictationKeyboard = { press: vi.fn(), release: vi.fn(), tap: vi.fn() };
    const controller = new DictationController(
      () => {
        loading.resolve();
        return deferred.promise;
      },
      () => true,
    );
    const first = controller.send(input("hold-start"));
    const second = controller.send(input("toggle"));
    await loading.promise;
    controller.stop();
    deferred.resolve(keyboard);
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(false);
    expect(keyboard.press).not.toHaveBeenCalled();
    expect(keyboard.tap).not.toHaveBeenCalled();
  });

  it("requires permission for starts but always releases an owned shortcut", async () => {
    const { controller, keyboard, canUse, load } = fixture();
    canUse.mockReturnValue(false);
    expect((await controller.send(input("hold-start"))).ok).toBe(false);
    expect(load).not.toHaveBeenCalled();
    canUse.mockReturnValue(true);
    await controller.send(input("hold-start"));
    canUse.mockReturnValue(false);
    expect((await controller.send(input("hold-end"))).ok).toBe(true);
    expect(keyboard.release).toHaveBeenCalledOnce();
  });

  it("cleans up native failures and rejects starts after shutdown", async () => {
    const { controller, keyboard } = fixture();
    vi.mocked(keyboard.press).mockImplementationOnce(() => {
      throw new Error("native failure");
    });
    expect(await controller.send(input("hold-start"))).toEqual({
      ok: false,
      mode: "idle",
      message: "native failure",
    });
    expect(keyboard.release).toHaveBeenCalledOnce();
    controller.shutdown();
    expect((await controller.send(input("toggle"))).ok).toBe(false);
    expect(keyboard.tap).not.toHaveBeenCalled();
  });

  it("retains a failed latch stop for retry", async () => {
    const { controller, keyboard } = fixture();
    await controller.send(input("toggle"));
    vi.mocked(keyboard.tap).mockImplementationOnce(() => {
      throw new Error("native failure");
    });
    expect(controller.stop()).toEqual({ ok: false, mode: "latched", message: "native failure" });
    expect(controller.stop().mode).toBe("idle");
  });

  it("keeps held ownership visible when release and cleanup both fail", async () => {
    const { controller, keyboard } = fixture();
    await controller.send(input("hold-start"));
    const failure = () => {
      throw new Error("release failed");
    };
    vi.mocked(keyboard.release).mockImplementationOnce(failure).mockImplementationOnce(failure);
    expect(await controller.send(input("hold-end"))).toEqual({
      ok: false,
      mode: "holding",
      message: "release failed",
    });
    expect(controller.stop().mode).toBe("idle");
  });
});
