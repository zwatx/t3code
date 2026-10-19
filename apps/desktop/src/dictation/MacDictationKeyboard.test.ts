import { describe, expect, it, vi } from "vite-plus/test";
import { createMacDictationKeyboard } from "./MacDictationKeyboard.ts";

const fixture = (flags = 0) => {
  const api = { flags: () => flags, isKeyDown: vi.fn(() => false), post: vi.fn() };
  return { api, keyboard: createMacDictationKeyboard(api) };
};

describe("macOS dictation shortcuts", () => {
  it("holds Fn with flags-changed events and releases it", () => {
    const { api, keyboard } = fixture();
    keyboard.press({ modifiers: ["fn"], key: null });
    expect(api.post.mock.calls).toEqual([[63, true, 0x800000, true]]);
    keyboard.release();
    expect(api.post.mock.calls).toEqual([
      [63, true, 0x800000, true],
      [63, false, 0, true],
    ]);
    keyboard.release();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("taps hands-free in down order and releases in reverse order", () => {
    const { api, keyboard } = fixture();
    keyboard.tap({ modifiers: ["control", "alt"], key: "Space" });
    expect(api.post.mock.calls).toEqual([
      [59, true, 0x40000, true],
      [58, true, 0xc0000, true],
      [49, true, 0xc0000, false],
      [49, false, 0xc0000, false],
      [58, false, 0x40000, true],
      [59, false, 0, true],
    ]);
  });

  it("does not release modifiers that were already held by the user", () => {
    const { api, keyboard } = fixture(0x100000);
    keyboard.tap({ modifiers: ["meta", "shift"], key: "a" });
    expect(api.post.mock.calls).toEqual([
      [56, true, 0x120000, true],
      [0, true, 0x120000, false],
      [0, false, 0x120000, false],
      [56, false, 0x100000, true],
    ]);
  });

  it("preserves unrelated modifier changes made during a hold", () => {
    let flags = 0;
    const post = vi.fn();
    const keyboard = createMacDictationKeyboard({
      flags: () => flags,
      isKeyDown: () => false,
      post,
    });
    keyboard.press({ modifiers: ["fn"], key: null });
    flags = 0x820000;
    keyboard.release();
    expect(post).toHaveBeenLastCalledWith(63, false, 0x20000, true);
    flags = 0x100000;
    keyboard.press({ modifiers: ["fn"], key: null });
    flags = 0x800000;
    keyboard.release();
    expect(post).toHaveBeenLastCalledWith(63, false, 0, true);
  });

  it("rejects empty, duplicate, unknown, and physically held keys without input", () => {
    const { api, keyboard } = fixture();
    for (const shortcut of [
      { modifiers: [], key: null },
      { modifiers: ["fn", "fn"] as const, key: null },
      { modifiers: [], key: "unsupported" },
    ])
      expect(() => keyboard.press(shortcut)).toThrow();
    api.isKeyDown.mockReturnValue(true);
    expect(() => keyboard.press({ modifiers: ["meta"], key: "a" })).toThrow("Release");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("releases partial presses when posting fails", () => {
    const { api, keyboard } = fixture();
    api.post.mockImplementationOnce(() => {
      throw new Error("post failed");
    });
    expect(() => keyboard.press({ modifiers: ["fn"], key: "space" })).toThrow("post failed");
    expect(api.post.mock.calls).toEqual([
      [63, true, 0x800000, true],
      [63, false, 0, true],
    ]);
    keyboard.press({ modifiers: ["fn"], key: null });
    keyboard.release();
  });

  it("releases all owned keys after one release fails and keeps failed keys for retry", () => {
    const { api, keyboard } = fixture();
    keyboard.press({ modifiers: ["fn"], key: "space" });
    api.post.mockImplementationOnce(() => {
      throw new Error("release failed");
    });
    expect(() => keyboard.release()).toThrow("release failed");
    expect(api.post).toHaveBeenLastCalledWith(63, false, 0, true);
    expect(() => keyboard.press({ modifiers: ["fn"], key: null })).toThrow("still held");
    keyboard.release();
    expect(api.post).toHaveBeenLastCalledWith(49, false, 0, false);
  });
});
