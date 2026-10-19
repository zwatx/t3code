import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

import { CodexMicroConnection, readHidApi, type HidConnectionEvent } from "./connection";
import { CODEX_MICRO_SLOT_COUNT, slotLighting } from "./controller";
import {
  CODEX_MICRO_PRODUCT_ID,
  CODEX_MICRO_USAGE_PAGE,
  CODEX_MICRO_VENDOR_ID,
  firmwareVersionRequest,
  type CodexMicroDeviceMessage,
} from "./protocol";

export type CodexMicroSupport = "available" | "insecure-context" | "unsupported";

export type CodexMicroStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "connecting" }
  | { readonly phase: "disconnecting" }
  | {
      readonly phase: "connected";
      readonly productName: string;
      readonly firmwareVersion: string | null;
    }
  | { readonly phase: "error"; readonly message: string };

export function codexMicroSupport(): CodexMicroSupport {
  if (readHidApi() !== null) return "available";
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure-context";
  return "unsupported";
}

interface CodexMicroStoreState {
  readonly status: CodexMicroStatus;
  /** Opens the browser device chooser; must run inside a click handler. */
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  /** Disconnects and revokes this site's permission for the device. */
  readonly forget: () => Promise<void>;
}

// Held outside React state: the open device carries the permission grant and
// must never be serialized or persisted.
let connection: CodexMicroConnection | null = null;
let stopWatchingDisconnect: (() => void) | null = null;
const messageListeners = new Set<(message: CodexMicroDeviceMessage) => void>();

export function subscribeCodexMicroMessages(
  listener: (message: CodexMicroDeviceMessage) => void,
): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

export function readCodexMicroConnection(): CodexMicroConnection | null {
  return connection;
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Access to the device was blocked. Another app may be using it, or HID access is disabled for this site.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function release(lightsOff: boolean): Promise<void> {
  const current = connection;
  connection = null;
  stopWatchingDisconnect?.();
  stopWatchingDisconnect = null;
  if (current === null) return;
  if (lightsOff) {
    // Leave the keys dark rather than frozen on stale thread statuses.
    const off = Array.from({ length: CODEX_MICRO_SLOT_COUNT }, (_, id) =>
      slotLighting(id, { assigned: false, status: null, active: false }),
    );
    await current.finalLighting(off);
  }
  await current.close();
}

export const useCodexMicroStore = create<CodexMicroStoreState>()((set, get) => {
  let teardown: Promise<void> | null = null;
  const disconnect = (options: { forget?: boolean; error?: string } = {}): Promise<void> => {
    if (teardown !== null) return teardown;
    if (get().status.phase === "connecting") return Promise.resolve();
    const device = connection?.device ?? null;
    set({ status: { phase: "disconnecting" } });
    teardown = (async () => {
      await release(options.error === undefined);
      if (options.forget) await device?.forget?.().catch(() => undefined);
      set({
        status: options.error ? { phase: "error", message: options.error } : { phase: "idle" },
      });
    })().finally(() => {
      teardown = null;
    });
    return teardown;
  };

  return {
    status: { phase: "idle" },
    connect: async () => {
      const hid = readHidApi();
      if (hid === null) {
        set({ status: { phase: "error", message: "This browser cannot access HID devices." } });
        return;
      }
      const phase = get().status.phase;
      if (
        teardown !== null ||
        phase === "connecting" ||
        phase === "connected" ||
        phase === "disconnecting"
      )
        return;
      set({ status: { phase: "connecting" } });
      try {
        const [device] = await hid.requestDevice({
          filters: [
            {
              vendorId: CODEX_MICRO_VENDOR_ID,
              productId: CODEX_MICRO_PRODUCT_ID,
              usagePage: CODEX_MICRO_USAGE_PAGE,
            },
          ],
        });
        if (!device) {
          set({ status: { phase: "idle" } });
          return;
        }
        const opened = await CodexMicroConnection.open(
          device,
          (message) => {
            if (connection !== opened) return;
            for (const listener of messageListeners) listener(message);
          },
          (error) => {
            if (connection === opened) {
              void disconnect({ error: describeError(error, "Lost contact with Codex Micro.") });
            }
          },
        );
        connection = opened;
        const onDisconnect = (event: Event) => {
          if ((event as HidConnectionEvent).device === device && connection === opened) {
            void disconnect({ error: "Codex Micro disconnected." });
          }
        };
        hid.addEventListener("disconnect", onDisconnect);
        stopWatchingDisconnect = () => hid.removeEventListener("disconnect", onDisconnect);
        set({
          status: {
            phase: "connected",
            productName: device.productName || "Codex Micro",
            firmwareVersion: null,
          },
        });
        void opened
          .request(firmwareVersionRequest)
          .then((result) => {
            const version = (result as { version?: unknown } | null)?.version;
            const status = get().status;
            if (connection !== opened || status.phase !== "connected") return;
            if (typeof version === "string") {
              set({ status: { ...status, firmwareVersion: version } });
            }
          })
          .catch(() => undefined);
      } catch (error) {
        await release(false);
        set({
          status: {
            phase: "error",
            message: describeError(error, "Could not connect to Codex Micro."),
          },
        });
      }
    },
    disconnect: () => disconnect(),
    forget: () => disconnect({ forget: true }),
  };
});

interface CodexMicroSlotStoreState {
  /** Thread keys on agent keys 1–6. Only keys are stored, never device state. */
  readonly slots: ReadonlyArray<string | null>;
  readonly setSlots: (slots: ReadonlyArray<string | null>) => void;
  readonly clearSlots: () => void;
}

export const useCodexMicroSlotStore = create<CodexMicroSlotStoreState>()(
  persist(
    (set) => ({
      slots: [],
      setSlots: (slots) => set({ slots }),
      clearSlots: () => set({ slots: [] }),
    }),
    {
      name: "t3code:codex-micro-slots:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);
