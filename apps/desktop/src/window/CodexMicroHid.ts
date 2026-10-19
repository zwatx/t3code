import type * as Electron from "electron";

const CODEX_MICRO_VENDOR_ID = 0x303a;
const CODEX_MICRO_PRODUCT_ID = 0x8360;

type HidChooserSession = Pick<Electron.Session, "on">;
type HidChooserContents = Pick<Electron.WebContents, "mainFrame" | "session" | "once">;

type MainRenderer = {
  readonly contents: HidChooserContents;
  readonly applicationUrl: string;
};

function isApplicationFrame(frameUrl: string, applicationUrl: string): boolean {
  try {
    const frame = new URL(frameUrl);
    const application = new URL(applicationUrl);
    // URL.origin is "null" for Electron's custom schemes.
    return frame.protocol === application.protocol && frame.host === application.host;
  } catch {
    return false;
  }
}

export function isCodexMicroDevice(
  device: Pick<Electron.HIDDevice, "vendorId" | "productId" | "collections">,
) {
  return (
    device.vendorId === CODEX_MICRO_VENDOR_ID &&
    device.productId === CODEX_MICRO_PRODUCT_ID &&
    device.collections.some((collection) => collection.usagePage === 0xff00)
  );
}

const choosers = new WeakMap<HidChooserSession, Set<MainRenderer>>();

export function installCodexMicroHidChooser(contents: HidChooserContents, applicationUrl: string) {
  const session = contents.session;
  let renderers = choosers.get(session);
  if (!renderers) {
    renderers = new Set();
    choosers.set(session, renderers);
    const registeredRenderers = renderers;
    const choose = (
      event: Electron.Event,
      details: { deviceList: Electron.HIDDevice[]; frame: Electron.WebFrameMain | null },
      callback: (deviceId?: string | null) => void,
    ) => {
      event.preventDefault();
      const allowed = [...registeredRenderers].some(
        (renderer) =>
          details.frame === renderer.contents.mainFrame &&
          details.frame !== null &&
          isApplicationFrame(details.frame.url, renderer.applicationUrl),
      );
      // Selection follows a user-initiated requestDevice call. Leave Electron's
      // device grants in memory; getDevices must not silently grant ownership.
      callback(allowed ? details.deviceList.find(isCodexMicroDevice)?.deviceId : undefined);
    };
    session.on("select-hid-device", choose);
    // The default session outlives individual windows, including a closed main
    // window recreated from the dock. Keep one chooser for that whole session.
  }
  const renderer = { contents, applicationUrl };
  const registeredRenderers = renderers;
  registeredRenderers.add(renderer);
  contents.once("destroyed", () => registeredRenderers.delete(renderer));
}
