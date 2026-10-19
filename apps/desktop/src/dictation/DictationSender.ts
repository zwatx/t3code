import type { DesktopIpcInvokeEvent } from "../ipc/DesktopIpc.ts";

export function isDictationSender(
  event: DesktopIpcInvokeEvent | undefined,
  contents: { readonly id: number; readonly mainFrame: { readonly url: string } },
  applicationUrl: string,
): boolean {
  if (event?.sender.id !== contents.id || event.senderFrame !== contents.mainFrame) return false;
  try {
    const frame = new URL(contents.mainFrame.url);
    const application = new URL(applicationUrl);
    // Custom Electron schemes have a null URL.origin.
    return frame.protocol === application.protocol && frame.host === application.host;
  } catch {
    return false;
  }
}
