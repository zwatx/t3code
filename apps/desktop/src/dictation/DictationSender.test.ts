import { describe, expect, it } from "vite-plus/test";
import { isDictationSender } from "./DictationSender.ts";

describe("dictation IPC sender", () => {
  const mainFrame = { url: "t3code://app/settings/integrations" };
  const contents = { id: 7, mainFrame };
  it("accepts only the registered main renderer", () => {
    expect(
      isDictationSender({ sender: { id: 7 }, senderFrame: mainFrame }, contents, "t3code://app/"),
    ).toBe(true);
    expect(
      isDictationSender({ sender: { id: 8 }, senderFrame: mainFrame }, contents, "t3code://app/"),
    ).toBe(false);
    expect(
      isDictationSender(
        { sender: { id: 7 }, senderFrame: { ...mainFrame } },
        contents,
        "t3code://app/",
      ),
    ).toBe(false);
    expect(isDictationSender({ sender: { id: 7 } }, contents, "t3code://app/")).toBe(false);
    expect(isDictationSender(undefined, contents, "t3code://app/")).toBe(false);
  });
  it("checks protocol and host even for null-origin custom schemes", () => {
    for (const url of ["t3code://other/", "t3code-dev://app/", "https://app/", "invalid"]) {
      const frame = { url };
      expect(
        isDictationSender(
          { sender: { id: 7 }, senderFrame: frame },
          { id: 7, mainFrame: frame },
          "t3code://app/",
        ),
      ).toBe(false);
    }
  });
});
