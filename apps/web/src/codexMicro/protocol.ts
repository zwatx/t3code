// Wire format of the Work Louder Codex Micro vendor HID interface.
//
// Each 64-byte report on usage page 0xff00 carries report ID 6, a channel byte
// (1 = firmware log, 2 = RPC), a payload length, and up to 61 UTF-8 bytes. RPC
// messages are compact JSON objects terminated by a newline and may span many
// reports. WebHID strips the report ID from both directions, so payloads here
// start at the channel byte.

export const CODEX_MICRO_VENDOR_ID = 0x303a;
export const CODEX_MICRO_PRODUCT_ID = 0x8360;
export const CODEX_MICRO_USAGE_PAGE = 0xff00;
export const CODEX_MICRO_REPORT_ID = 6;

const CHANNEL_RPC = 2;
const REPORT_PAYLOAD_SIZE = 63;
const MAX_CHUNK_BYTES = REPORT_PAYLOAD_SIZE - 2;
// Device messages are short notifications; anything longer is a framing fault.
const MAX_LINE_BYTES = 4096;
// The firmware only accepts request ids in [0, 999).
const RPC_ID_LIMIT = 999;

export const CodexMicroLightingEffect = {
  off: 0,
  solid: 1,
  breath: 4,
  shallowBreath: 6,
} as const;
export type CodexMicroLightingEffect =
  (typeof CodexMicroLightingEffect)[keyof typeof CodexMicroLightingEffect];

export interface CodexMicroSlotLighting {
  readonly id: number;
  readonly color: number;
  readonly brightness: number;
  readonly effect: CodexMicroLightingEffect;
  readonly speed: number;
}

export type CodexMicroDeviceMessage =
  | { readonly type: "key"; readonly key: string; readonly action: number }
  | { readonly type: "joystick"; readonly angle: number; readonly distance: number }
  | {
      readonly type: "response";
      readonly id: number;
      readonly result: unknown;
      readonly error: string | null;
    };

export interface CodexMicroRequest {
  readonly method: string;
  readonly params: unknown;
}

const encoder = new TextEncoder();

// Firmware JSON parsing is ASCII-only, so non-ASCII characters travel as \u escapes.
function escapeNonAscii(json: string): string {
  return json.replace(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function encodeRequest(request: CodexMicroRequest, id: number): string {
  return `${escapeNonAscii(JSON.stringify({ method: request.method, params: request.params, id }))}\n`;
}

export function encodeReports(message: string): Array<Uint8Array<ArrayBuffer>> {
  const bytes = encoder.encode(message);
  const reports: Array<Uint8Array<ArrayBuffer>> = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + MAX_CHUNK_BYTES);
    const report = new Uint8Array(REPORT_PAYLOAD_SIZE);
    report[0] = CHANNEL_RPC;
    report[1] = chunk.length;
    report.set(chunk, 2);
    reports.push(report);
  }
  return reports;
}

export function nextRequestId(previous: number): number {
  return (previous + 1) % RPC_ID_LIMIT;
}

/** Reassembles newline-terminated RPC lines from input report payloads. */
export class CodexMicroLineDecoder {
  private decoder = new TextDecoder();
  private buffer = "";

  push(report: DataView): string[] {
    if (report.byteLength < 2 || report.getUint8(0) !== CHANNEL_RPC) return [];
    const length = Math.min(report.getUint8(1), report.byteLength - 2, MAX_CHUNK_BYTES);
    const payload = new Uint8Array(report.buffer, report.byteOffset + 2, length);
    this.buffer += this.decoder.decode(payload, { stream: true });
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    if (this.buffer.length > MAX_LINE_BYTES) this.reset();
    return lines.map((line) => line.trim()).filter((line) => line.length > 0);
  }

  reset(): void {
    this.decoder = new TextDecoder();
    this.buffer = "";
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseDeviceMessage(line: string): CodexMicroDeviceMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  const id = finiteNumber(message.id ?? message.i);
  if (id !== null) {
    const error = message.error as { message?: unknown } | undefined;
    return {
      type: "response",
      id,
      result: message.result,
      error:
        error === undefined
          ? null
          : typeof error?.message === "string"
            ? error.message
            : "Device rejected the request.",
    };
  }
  const method = message.method ?? message.m;
  const params = (message.params ?? message.p) as Record<string, unknown> | undefined;
  if (typeof params !== "object" || params === null) return null;
  if (method === "v.oai.hid") {
    const action = finiteNumber(params.act);
    if (typeof params.k !== "string" || params.k.length > 32 || action === null) return null;
    return { type: "key", key: params.k, action };
  }
  if (method === "v.oai.rad") {
    const angle = finiteNumber(params.a);
    const distance = finiteNumber(params.d);
    if (angle === null || distance === null) return null;
    return { type: "joystick", angle, distance };
  }
  return null;
}

export function threadLightingRequest(
  slots: ReadonlyArray<CodexMicroSlotLighting>,
): CodexMicroRequest {
  return {
    method: "v.oai.thstatus",
    params: slots.map((slot) => ({
      id: slot.id,
      c: slot.color,
      b: slot.brightness,
      e: slot.effect,
      s: slot.speed,
    })),
  };
}

export const firmwareVersionRequest: CodexMicroRequest = { method: "sys.version", params: null };
