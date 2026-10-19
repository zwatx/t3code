import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CodexMicroConnection, type HidDevice } from "./connection";
import { CodexMicroLineDecoder, type CodexMicroDeviceMessage } from "./protocol";

class FakeDevice extends EventTarget implements HidDevice {
  opened = false;
  readonly productName = "Codex Micro";
  readonly vendorId = 0x303a;
  readonly productId = 0x8360;
  readonly requests: Array<{ method: string; params: unknown; id: number }> = [];
  inFlight = 0;
  maxInFlight = 0;
  respond = true;
  failWrites = false;
  private readonly decoder = new CodexMicroLineDecoder();

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async sendReport(reportId: number, data: BufferSource) {
    if (this.failWrites) throw new DOMException("Device gone", "NetworkError");
    expect(reportId).toBe(6);
    const bytes = data as Uint8Array;
    for (const line of this.decoder.push(new DataView(bytes.buffer, bytes.byteOffset))) {
      const request = JSON.parse(line) as { method: string; params: unknown; id: number };
      this.requests.push(request);
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      if (this.respond) {
        queueMicrotask(() => {
          this.inFlight -= 1;
          this.emit(`{"id":${request.id},"result":{"ok":true}}\n`);
        });
      }
    }
  }

  emit(text: string) {
    const bytes = new TextEncoder().encode(text);
    const payload = new Uint8Array(63);
    payload[0] = 2;
    payload[1] = bytes.length;
    payload.set(bytes, 2);
    const event = Object.assign(new Event("inputreport"), {
      reportId: 6,
      data: new DataView(payload.buffer),
    });
    this.dispatchEvent(event);
  }
}

const slots = (color: number) =>
  Array.from({ length: 6 }, (_, id) => ({
    id,
    color,
    brightness: 1,
    effect: 1 as const,
    speed: 0,
  }));

describe("CodexMicroConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes requests and keeps only the newest pending lighting", async () => {
    const device = new FakeDevice();
    const connection = await CodexMicroConnection.open(
      device,
      () => {},
      () => {},
    );

    connection.setLighting(slots(1));
    connection.setLighting(slots(2));
    connection.setLighting(slots(3));
    await vi.runAllTimersAsync();

    expect(device.maxInFlight).toBe(1);
    expect(
      device.requests.map((request) => (request.params as Array<{ c: number }>)[0]?.c),
    ).toEqual([1, 3]);
  });

  it("delivers device input and resolves the matching response", async () => {
    const device = new FakeDevice();
    const messages: CodexMicroDeviceMessage[] = [];
    const connection = await CodexMicroConnection.open(
      device,
      (message) => messages.push(message),
      () => {},
    );

    const result = connection.request({ method: "sys.version", params: null });
    device.emit('{"method":"v.oai.hid","params":{"k":"AG01","act":1}}\n');

    await expect(result).resolves.toEqual({ ok: true });
    expect(messages).toEqual([{ type: "key", key: "AG01", action: 1 }]);
  });

  it("times out a silent device without blocking later requests", async () => {
    const device = new FakeDevice();
    device.respond = false;
    const connection = await CodexMicroConnection.open(
      device,
      () => {},
      () => {},
    );

    const first = connection.request({ method: "sys.version", params: null });
    const assertion = expect(first).rejects.toThrow("did not respond");
    await vi.runAllTimersAsync();
    await assertion;

    device.respond = true;
    const second = connection.request({ method: "sys.version", params: null });
    await vi.runAllTimersAsync();
    await expect(second).resolves.toEqual({ ok: true });
  });

  it("reports write failures and stops after close", async () => {
    const device = new FakeDevice();
    const failures: unknown[] = [];
    const messages: CodexMicroDeviceMessage[] = [];
    const connection = await CodexMicroConnection.open(
      device,
      (message) => messages.push(message),
      (error) => failures.push(error),
    );

    device.failWrites = true;
    await expect(connection.request({ method: "sys.version", params: null })).rejects.toThrow();
    expect(failures).toHaveLength(1);

    await connection.close();
    device.emit('{"method":"v.oai.hid","params":{"k":"AG01","act":1}}\n');
    expect(messages).toEqual([]);
    expect(device.opened).toBe(false);
  });
});
