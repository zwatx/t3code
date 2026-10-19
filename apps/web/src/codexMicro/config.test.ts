import { describe, expect, it } from "vite-plus/test";

import {
  defaultCodexMicroConfig,
  sanitizeCodexMicroConfig,
  shortcutKeyLabels,
  shortcutsEqual,
} from "./config";

describe("Codex Micro config", () => {
  it("defaults the wide key to dictation with Wispr Flow's shortcuts", () => {
    const mac = defaultCodexMicroConfig("mac");
    expect(mac.keys.ACT10).toEqual({ type: "dictation" });
    expect(mac.dictation).toEqual({
      provider: "wispr-flow",
      holdShortcut: { modifiers: ["fn"], key: null },
      toggleShortcut: { modifiers: ["fn"], key: "Space" },
    });

    expect(defaultCodexMicroConfig("windows").dictation.holdShortcut).toEqual({
      modifiers: ["control", "meta"],
      key: null,
    });
  });

  it("round-trips a valid config", () => {
    const config = defaultCodexMicroConfig("mac");
    expect(sanitizeCodexMicroConfig(JSON.parse(JSON.stringify(config)), config)).toEqual(config);
  });

  it("falls back to defaults for unknown versions and non-objects", () => {
    const fallback = defaultCodexMicroConfig("mac");
    expect(sanitizeCodexMicroConfig(null, fallback)).toBe(fallback);
    expect(sanitizeCodexMicroConfig({ ...fallback, version: 2 }, fallback)).toBe(fallback);
    expect(sanitizeCodexMicroConfig("config", fallback)).toBe(fallback);
  });

  it("replaces only the invalid fields", () => {
    const fallback = defaultCodexMicroConfig("mac");
    const config = sanitizeCodexMicroConfig(
      {
        version: 1,
        keys: {
          ACT06: { type: "command", command: "terminal.toggle" },
          ACT07: { type: "command", command: "not.a.command" },
          ACT08: { type: "none" },
          ACT11: { type: "dictation" },
        },
        dial: { turn: "threads", press: { type: "launch-rockets" } },
        joystick: { up: { type: "thread", direction: "sideways" }, left: { type: "none" } },
        dictation: {
          provider: "custom",
          holdShortcut: { modifiers: ["control", "hyper"], key: null },
          toggleShortcut: { modifiers: ["alt"], key: "F5" },
        },
      },
      fallback,
    );

    expect(config.keys.ACT06).toEqual({ type: "command", command: "terminal.toggle" });
    expect(config.keys.ACT07).toEqual(fallback.keys.ACT07);
    expect(config.keys.ACT08).toEqual({ type: "none" });
    expect(config.keys.ACT10).toEqual({ type: "dictation" });
    expect(config.keys).not.toHaveProperty("ACT11");
    expect(config.dial).toEqual({ turn: "threads", press: fallback.dial.press });
    expect(config.joystick.up).toEqual(fallback.joystick.up);
    expect(config.joystick.left).toEqual({ type: "none" });
    expect(config.dictation.provider).toBe("custom");
    expect(config.dictation.holdShortcut).toEqual(fallback.dictation.holdShortcut);
    expect(config.dictation.toggleShortcut).toEqual({ modifiers: ["alt"], key: "F5" });
  });

  it("rejects empty shortcuts and keys the desktop app cannot press", () => {
    const fallback = defaultCodexMicroConfig("mac");
    const config = sanitizeCodexMicroConfig(
      {
        ...fallback,
        dictation: {
          ...fallback.dictation,
          holdShortcut: { modifiers: [], key: null },
          toggleShortcut: { modifiers: ["fn"], key: "Hyper" },
        },
      },
      fallback,
    );
    expect(config.dictation).toEqual(fallback.dictation);
  });

  it("labels and compares shortcuts in modifier order", () => {
    expect(shortcutKeyLabels({ modifiers: ["alt", "control"], key: "Space" }, "mac")).toEqual([
      "Control",
      "Option",
      "Space",
    ]);
    expect(shortcutKeyLabels({ modifiers: ["meta", "control"], key: null }, "windows")).toEqual([
      "Ctrl",
      "Win",
    ]);
    expect(
      shortcutsEqual(
        { modifiers: ["alt", "control"], key: null },
        { modifiers: ["control", "alt"], key: null },
      ),
    ).toBe(true);
  });
});
