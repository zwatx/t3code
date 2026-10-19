import {
  CODEX_MICRO_REPORT_ID,
  CodexMicroLineDecoder,
  encodeReports,
  encodeRequest,
  nextRequestId,
  parseDeviceMessage,
  threadLightingRequest,
  type CodexMicroDeviceMessage,
  type CodexMicroRequest,
  type CodexMicroSlotLighting,
} from "./protocol";

// The subset of WebHID this integration uses. TypeScript's DOM lib does not
// ship WebHID types.
export interface HidDevice extends EventTarget {
  readonly opened: boolean;
  readonly productName: string;
  readonly vendorId: number;
  readonly productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

interface HidInputReportEvent extends Event {
  readonly reportId: number;
  readonly data: DataView;
}

export interface HidConnectionEvent extends Event {
  readonly device: HidDevice;
}

export interface HidApi extends EventTarget {
  requestDevice(options: {
    filters: ReadonlyArray<{ vendorId: number; productId: number; usagePage: number }>;
  }): Promise<HidDevice[]>;
}

export function readHidApi(): HidApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { hid?: HidApi }).hid ?? null;
}

const RESPONSE_TIMEOUT_MS = 2_000;
// The vendor kit pauses between requests so the firmware can finish each one.
const REQUEST_COOLDOWN_MS = 50;

type ResponseMessage = Extract<CodexMicroDeviceMessage, { type: "response" }>;

interface PendingResponse {
  /** null settles the waiter as a timeout or teardown. */
  readonly resolve: (message: ResponseMessage | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * One open Codex Micro. Requests run one at a time because the firmware
 * interleaves nothing; lighting updates coalesce so only the newest state is
 * ever queued.
 */
export class CodexMicroConnection {
  private readonly decoder = new CodexMicroLineDecoder();
  private queue: Promise<void> = Promise.resolve();
  private requestId = 0;
  private pending: { id: number; response: PendingResponse } | null = null;
  private lighting: ReadonlyArray<CodexMicroSlotLighting> | null = null;
  private lightingFlushing = false;
  private closed = false;

  constructor(
    readonly device: HidDevice,
    private readonly onMessage: (message: CodexMicroDeviceMessage) => void,
    private readonly onFailure: (error: unknown) => void,
  ) {
    device.addEventListener("inputreport", this.handleInputReport);
  }

  static async open(
    device: HidDevice,
    onMessage: (message: CodexMicroDeviceMessage) => void,
    onFailure: (error: unknown) => void,
  ): Promise<CodexMicroConnection> {
    if (!device.opened) await device.open();
    return new CodexMicroConnection(device, onMessage, onFailure);
  }

  /** Resolves with the device's result; rejects on write failure, device error, or timeout. */
  request(request: CodexMicroRequest): Promise<unknown> {
    const run = this.queue.then(() => this.send(request));
    this.queue = run.then(
      () => wait(REQUEST_COOLDOWN_MS),
      () => wait(REQUEST_COOLDOWN_MS),
    );
    return run;
  }

  setLighting(slots: ReadonlyArray<CodexMicroSlotLighting>): void {
    this.lighting = slots;
    if (this.lightingFlushing) return;
    this.lightingFlushing = true;
    void this.flushLighting();
  }

  /** Sends one last lighting state, dropping any queued update, and waits for it. */
  async finalLighting(slots: ReadonlyArray<CodexMicroSlotLighting>): Promise<void> {
    this.lighting = null;
    await this.request(threadLightingRequest(slots)).catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.device.removeEventListener("inputreport", this.handleInputReport);
    this.settlePending(null);
    this.lighting = null;
    await this.device.close().catch(() => undefined);
  }

  private async flushLighting(): Promise<void> {
    while (this.lighting !== null && !this.closed) {
      const slots = this.lighting;
      this.lighting = null;
      // A rejected or slow lighting update is not fatal; the next state replaces it.
      await this.request(threadLightingRequest(slots)).catch(() => undefined);
    }
    this.lightingFlushing = false;
  }

  private async send(request: CodexMicroRequest): Promise<unknown> {
    if (this.closed) throw new Error("Codex Micro is disconnected.");
    this.requestId = nextRequestId(this.requestId);
    const id = this.requestId;
    const response = new Promise<ResponseMessage | null>((resolve) => {
      const timer = setTimeout(() => this.settlePending(null), RESPONSE_TIMEOUT_MS);
      this.pending = { id, response: { resolve, timer } };
    });
    try {
      for (const report of encodeReports(encodeRequest(request, id))) {
        await this.device.sendReport(CODEX_MICRO_REPORT_ID, report);
      }
    } catch (error) {
      this.settlePending(null);
      if (!this.closed) this.onFailure(error);
      throw error;
    }
    const message = await response;
    if (message === null) throw new Error("Codex Micro did not respond.");
    if (message.error !== null) throw new Error(message.error);
    return message.result;
  }

  private settlePending(message: ResponseMessage | null) {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    clearTimeout(pending.response.timer);
    pending.response.resolve(message);
  }

  private readonly handleInputReport = (event: Event) => {
    const report = event as HidInputReportEvent;
    if (this.closed || report.reportId !== CODEX_MICRO_REPORT_ID) return;
    for (const line of this.decoder.push(report.data)) {
      const message = parseDeviceMessage(line);
      if (message === null) continue;
      if (message.type === "response") {
        if (this.pending?.id === message.id) this.settlePending(message);
        continue;
      }
      this.onMessage(message);
    }
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
