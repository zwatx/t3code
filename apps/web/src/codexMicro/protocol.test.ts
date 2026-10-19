import { describe, expect, it } from "vite-plus/test";

import {
  CodexMicroLineDecoder,
  encodeReports,
  encodeRequest,
  nextRequestId,
  parseDeviceMessage,
  threadLightingRequest,
} from "./protocol";

function report(channel: number, bytes: Uint8Array): DataView {
  const payload = new Uint8Array(63);
  payload[0] = channel;
  payload[1] = bytes.length;
  payload.set(bytes, 2);
  return new DataView(payload.buffer);
}

describe("Codex Micro framing", () => {
  it("splits a request into RPC reports that reassemble into one line", () => {
    const message = encodeRequest(
      threadLightingRequest(
        Array.from({ length: 6 }, (_, id) => ({
          id,
          color: 0x0ea5e9,
          brightness: 0.6,
          effect: 4,
          speed: 0.5,
        })),
      ),
      42,
    );
    const reports = encodeReports(message);

    expect(reports.length).toBeGreaterThan(1);
    for (const chunk of reports) {
      expect(chunk.length).toBe(63);
      expect(chunk[0]).toBe(2);
      expect(chunk[1]).toBeLessThanOrEqual(61);
    }
    const decoder = new CodexMicroLineDecoder();
    const lines = reports.flatMap((chunk) => decoder.push(new DataView(chunk.buffer)));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      method: "v.oai.thstatus",
      params: expect.arrayContaining([{ id: 0, c: 0x0ea5e9, b: 0.6, e: 4, s: 0.5 }]),
      id: 42,
    });
  });

  it("sends only ASCII so the firmware parser sees escaped characters", () => {
    const message = encodeRequest({ method: "x", params: { title: "café 🚀" } }, 1);
    expect(/[\u0080-\uffff]/.test(message)).toBe(false);
    expect(JSON.parse(message)).toEqual({ method: "x", params: { title: "café 🚀" }, id: 1 });
  });

  it("keeps request ids inside the firmware range", () => {
    expect(nextRequestId(997)).toBe(998);
    expect(nextRequestId(998)).toBe(0);
  });

  it("reassembles characters split across reports and ignores the log channel", () => {
    const bytes = new TextEncoder().encode('{"method":"v.oai.hid","params":{"k":"é"}}\n');
    const split = bytes.indexOf(0xc3) + 1;
    const decoder = new CodexMicroLineDecoder();

    expect(decoder.push(report(1, new TextEncoder().encode("boot log\n")))).toEqual([]);
    expect(decoder.push(report(2, bytes.subarray(0, split)))).toEqual([]);
    expect(decoder.push(report(2, bytes.subarray(split)))).toEqual([
      '{"method":"v.oai.hid","params":{"k":"é"}}',
    ]);
  });

  it("drops an unterminated runaway line and recovers on the next message", () => {
    const decoder = new CodexMicroLineDecoder();
    const junk = new TextEncoder().encode("x".repeat(61));
    for (let index = 0; index < 100; index += 1) decoder.push(report(2, junk));
    decoder.push(report(2, new TextEncoder().encode("\n")));

    expect(decoder.push(report(2, new TextEncoder().encode('{"id":3,"result":null}\n')))).toEqual([
      '{"id":3,"result":null}',
    ]);
  });
});

describe("Codex Micro device messages", () => {
  it("reads key, joystick, and response messages", () => {
    expect(
      parseDeviceMessage('{"method":"v.oai.hid","params":{"k":"AG02","act":1,"ag":2}}'),
    ).toEqual({ type: "key", key: "AG02", action: 1 });
    expect(parseDeviceMessage('{"m":"v.oai.rad","p":{"a":0.75,"d":0.9}}')).toEqual({
      type: "joystick",
      angle: 0.75,
      distance: 0.9,
    });
    expect(
      parseDeviceMessage('{"result":{"version":"v0.4.1"},"id":917,"method":"sys.version"}'),
    ).toEqual({ type: "response", id: 917, result: { version: "v0.4.1" }, error: null });
    expect(parseDeviceMessage('{"id":5,"error":{"code":-1,"message":"bad"}}')).toMatchObject({
      type: "response",
      id: 5,
      error: "bad",
    });
  });

  it("rejects malformed or unexpected input", () => {
    for (const line of [
      "not json",
      "[1,2]",
      '{"method":"v.oai.hid","params":{"k":"AG00"}}',
      '{"method":"v.oai.hid","params":{"k":7,"act":1}}',
      `{"method":"v.oai.hid","params":{"k":"${"A".repeat(40)}","act":1}}`,
      '{"method":"v.oai.rad","params":{"a":"up","d":1}}',
      '{"method":"other","params":{}}',
    ]) {
      expect(parseDeviceMessage(line)).toBeNull();
    }
  });
});
