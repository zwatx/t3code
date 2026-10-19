import type * as Electron from "electron";
import * as NodeEvents from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";

import { installCodexMicroHidChooser } from "./CodexMicroHid.ts";

const micro = {
  vendorId: 0x303a,
  productId: 0x8360,
  deviceId: "micro",
  collections: [{ usagePage: 0xff00 }],
} as Electron.HIDDevice;
const keyboard = {
  vendorId: 0x303a,
  productId: 0x1234,
  deviceId: "keyboard",
} as Electron.HIDDevice;

function setup(session = new NodeEvents.EventEmitter(), url = "t3code://app/") {
  const frame = { url };
  const events = new NodeEvents.EventEmitter();
  const contents = {
    session: session as unknown as Electron.Session,
    mainFrame: frame,
    once: events.once.bind(events),
  } as unknown as Electron.WebContents;
  installCodexMicroHidChooser(contents, url);
  const choose = (
    requestFrame: Pick<Electron.WebFrameMain, "url"> | null,
    devices = [keyboard, micro],
  ) => {
    const callback = vi.fn();
    const event = { preventDefault: vi.fn() };
    session.emit(
      "select-hid-device",
      event,
      { frame: requestFrame, deviceList: devices },
      callback,
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    return callback.mock.calls[0]?.[0];
  };
  return { session, frame, events, choose };
}

describe("Codex Micro desktop selection", () => {
  it("selects only the Codex Micro following a main renderer request", () => {
    const { frame, choose } = setup();
    expect(choose(frame)).toBe("micro");
    expect(choose(frame, [keyboard])).toBeUndefined();
    expect(choose(frame, [{ ...micro, collections: [] }])).toBeUndefined();
    expect(
      choose(frame, [{ ...micro, collections: [{ usagePage: 1 } as Electron.Collections] }]),
    ).toBeUndefined();
    expect(choose(frame, [])).toBeUndefined();
  });

  it("denies child frames, preview pages, destroyed frames and off-origin navigations", () => {
    const { frame, choose } = setup();
    expect(choose(null)).toBeUndefined();
    expect(choose({ url: frame.url } as Electron.WebFrameMain)).toBeUndefined();
    frame.url = "t3code://untrusted/";
    expect(choose(frame)).toBeUndefined();
    frame.url = "other-scheme://app/";
    expect(choose(frame)).toBeUndefined();
    frame.url = "https://app/";
    expect(choose(frame)).toBeUndefined();
  });

  it("supports development origins and removes destroyed window grants", () => {
    const { frame, events, choose } = setup(undefined, "t3code-dev://app/");
    expect(choose(frame)).toBe("micro");
    events.emit("destroyed");
    expect(choose(frame)).toBeUndefined();
  });

  it("keeps one selector when a session has multiple or recreated windows", () => {
    const first = setup();
    const second = setup(first.session);
    expect(first.session.listenerCount("select-hid-device")).toBe(1);
    expect(first.choose(first.frame)).toBe("micro");
    expect(second.choose(second.frame)).toBe("micro");
    first.events.emit("destroyed");
    expect(first.choose(first.frame)).toBeUndefined();
    expect(second.choose(second.frame)).toBe("micro");
  });
});
