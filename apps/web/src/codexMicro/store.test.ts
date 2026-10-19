import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CodexMicroConnection, type HidApi, type HidDevice } from "./connection";
import type { CodexMicroDeviceMessage } from "./protocol";
import { subscribeCodexMicroMessages, useCodexMicroStore } from "./store";

const { readHidApi } = vi.hoisted(() => ({ readHidApi: vi.fn() }));
vi.mock("./connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connection")>()),
  readHidApi,
}));

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function setup() {
  const device = {
    productName: "Codex Micro",
    forget: vi.fn(async () => {}),
  } as unknown as HidDevice;
  const hid = Object.assign(new EventTarget(), {
    requestDevice: vi.fn(async () => [device]),
  });
  readHidApi.mockReturnValue(hid as HidApi);
  const transport = {
    device,
    request: vi.fn(async () => ({ version: "v0.4.1" })),
    finalLighting: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  let emitMessage: (message: CodexMicroDeviceMessage) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  vi.spyOn(CodexMicroConnection, "open").mockImplementation(
    async (_device, onMessage, onFailure) => {
      emitMessage = onMessage;
      fail = onFailure;
      return { ...transport } as unknown as CodexMicroConnection;
    },
  );
  return {
    device,
    hid,
    transport,
    emit: (message: CodexMicroDeviceMessage) => emitMessage(message),
    failure: () => fail,
  };
}

describe("Codex Micro ownership", () => {
  beforeEach(() => {
    useCodexMicroStore.setState({ status: { phase: "idle" } });
  });
  afterEach(async () => {
    await useCodexMicroStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  it("blocks reconnect and repeated teardown until lighting and close have finished", async () => {
    const { hid, transport, failure } = setup();
    const lights = deferred();
    const closeStarted = deferred();
    const closeFinished = deferred();
    transport.finalLighting.mockReturnValueOnce(lights.promise);
    transport.close.mockImplementationOnce(() => {
      closeStarted.resolve();
      return closeFinished.promise;
    });
    await useCodexMicroStore.getState().connect();
    const oldFailure = failure();
    const first = useCodexMicroStore.getState().disconnect();
    const second = useCodexMicroStore.getState().disconnect();
    await useCodexMicroStore.getState().connect();
    expect(useCodexMicroStore.getState().status.phase).toBe("disconnecting");
    expect(hid.requestDevice).toHaveBeenCalledTimes(1);
    lights.resolve();
    await closeStarted.promise;
    await useCodexMicroStore.getState().connect();
    expect(hid.requestDevice).toHaveBeenCalledTimes(1);
    closeFinished.resolve();
    await Promise.all([first, second]);
    expect(transport.close).toHaveBeenCalledTimes(1);
    await useCodexMicroStore.getState().connect();
    expect(hid.requestDevice).toHaveBeenCalledTimes(2);
    oldFailure(new Error("Late failure from the closed connection"));
    expect(useCodexMicroStore.getState().status.phase).toBe("connected");
  });

  it("stops routing input as soon as disconnect begins", async () => {
    const { transport, emit } = setup();
    const messages: CodexMicroDeviceMessage[] = [];
    const unsubscribe = subscribeCodexMicroMessages((message) => messages.push(message));
    const press = { type: "key", key: "ACT07", action: 1 } as const;
    const lights = deferred();
    transport.finalLighting.mockReturnValueOnce(lights.promise);
    await useCodexMicroStore.getState().connect();
    emit(press);
    const disconnecting = useCodexMicroStore.getState().disconnect();
    emit(press);
    expect(messages).toEqual([press]);
    lights.resolve();
    await disconnecting;
    unsubscribe();
  });

  it("keeps reconnect disabled until permission revocation finishes", async () => {
    const { device, hid } = setup();
    const revoked = deferred();
    vi.mocked(device.forget!).mockReturnValueOnce(revoked.promise);
    await useCodexMicroStore.getState().connect();
    const forgetting = useCodexMicroStore.getState().forget();
    await useCodexMicroStore.getState().connect();
    expect(hid.requestDevice).toHaveBeenCalledTimes(1);
    expect(useCodexMicroStore.getState().status.phase).toBe("disconnecting");
    revoked.resolve();
    await forgetting;
    expect(device.forget).toHaveBeenCalledTimes(1);
    expect(useCodexMicroStore.getState().status.phase).toBe("idle");
  });
});
