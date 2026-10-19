import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import { CODEX_MICRO_CONTROL_MAP, CODEX_MICRO_SLOT_COUNT } from "~/codexMicro/controller";
import {
  codexMicroSupport,
  useCodexMicroSlotStore,
  useCodexMicroStore,
  type CodexMicroStatus,
  type CodexMicroSupport,
} from "~/codexMicro/store";
import { useThreadShells } from "~/state/entities";

import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const UNSUPPORTED_MESSAGE: Record<Exclude<CodexMicroSupport, "available">, string> = {
  unsupported:
    "This browser can't use HID devices. Use the desktop app, or Chrome or Edge on a computer.",
  "insecure-context":
    "HID devices need a secure page. Open T3 Code over HTTPS or on localhost to connect.",
};

function statusText(status: CodexMicroStatus) {
  switch (status.phase) {
    case "idle":
      return null;
    case "connecting":
      return "Choose your Codex Micro in the browser prompt…";
    case "disconnecting":
      return "Releasing Codex Micro…";
    case "connected":
      return status.firmwareVersion
        ? `Connected to ${status.productName} · firmware ${status.firmwareVersion}`
        : `Connected to ${status.productName}`;
    case "error":
      return <span className="block text-destructive">{status.message}</span>;
  }
}

export function CodexMicroSettings() {
  // Support cannot change while the page is open.
  const [support] = useState(codexMicroSupport);
  const status = useCodexMicroStore((state) => state.status);
  const connect = useCodexMicroStore((state) => state.connect);
  const disconnect = useCodexMicroStore((state) => state.disconnect);
  const forget = useCodexMicroStore((state) => state.forget);
  const connected = status.phase === "connected";

  return (
    <SettingsSection id="codex-micro-section" title="Codex Micro">
      <SettingsRow
        {...searchableSetting("codex-micro")}
        description="Use a Work Louder Codex Micro attached to this computer over USB or Bluetooth. Agent keys open threads and light up with their status."
        status={support === "available" ? statusText(status) : UNSUPPORTED_MESSAGE[support]}
        control={
          support !== "available" ? null : connected ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void forget()}>
                Forget device
              </Button>
              <Button size="sm" variant="outline" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={status.phase === "connecting" || status.phase === "disconnecting"}
              onClick={() => void connect()}
            >
              {status.phase === "connecting"
                ? "Connecting…"
                : status.phase === "disconnecting"
                  ? "Disconnecting…"
                  : "Connect"}
            </Button>
          )
        }
      />
      {support === "available" ? (
        <>
          <AgentKeysRow />
          <SettingsRow title="Controls" description="Applies to the open thread.">
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 pb-2 text-xs">
              {CODEX_MICRO_CONTROL_MAP.map(({ control, action }) => (
                <div key={control} className="contents">
                  <dt className="text-muted-foreground">{control}</dt>
                  <dd className="text-foreground">{action}</dd>
                </div>
              ))}
            </dl>
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}

function AgentKeysRow() {
  const slots = useCodexMicroSlotStore((state) => state.slots);
  const clearSlots = useCodexMicroSlotStore((state) => state.clearSlots);
  const shells = useThreadShells();
  const titleByKey = new Map(
    shells.map((shell) => [
      scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
      shell.title,
    ]),
  );

  return (
    <SettingsRow
      {...searchableSetting("codex-micro-agent-keys")}
      description="Each key keeps its thread until the thread is archived. Empty keys take your pinned threads first, then your most recent ones."
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={slots.every((slot) => slot === null)}
          onClick={clearSlots}
        >
          Reassign keys
        </Button>
      }
    >
      <ol className="grid gap-1 pb-2 text-xs">
        {Array.from({ length: CODEX_MICRO_SLOT_COUNT }, (_, index) => {
          const key = slots[index] ?? null;
          const title = key === null ? null : (titleByKey.get(key) ?? null);
          return (
            <li key={index} className="flex min-w-0 gap-3">
              <span className="w-3 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
              <span
                className={title === null ? "text-muted-foreground" : "truncate text-foreground"}
              >
                {title ?? (key === null ? "Unassigned" : "Unavailable thread")}
              </span>
            </li>
          );
        })}
      </ol>
    </SettingsRow>
  );
}
