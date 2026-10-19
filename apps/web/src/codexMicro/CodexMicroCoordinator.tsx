import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useEffectEvent } from "react";

import { dispatchAppCommand } from "~/appCommandBus";
import { isCommandPaletteOpen, openCommandPalette } from "~/commandPaletteBus";
import { environmentCatalog } from "~/connection/catalog";
import { resolveThreadLastVisitedAt, resolveThreadStatusPill } from "~/components/Sidebar.logic";
import { useThreadRouteRef } from "~/hooks/useThreadRouteTarget";
import { useThreadShells } from "~/state/entities";
import { environmentShell } from "~/state/shell";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";

import {
  CODEX_MICRO_SLOT_COUNT,
  CodexMicroJoystickTracker,
  CodexMicroKeyTracker,
  adjacentSlot,
  assignSlots,
  slotLighting,
} from "./controller";
import type { CodexMicroDeviceMessage, CodexMicroSlotLighting } from "./protocol";
import {
  readCodexMicroConnection,
  subscribeCodexMicroMessages,
  useCodexMicroSlotStore,
  useCodexMicroStore,
} from "./store";

/** Drives a connected Codex Micro. Mounts nothing until the user connects one. */
export function CodexMicroCoordinator() {
  const connected = useCodexMicroStore((state) => state.status.phase === "connected");
  return connected ? <CodexMicroBridge /> : null;
}

function CodexMicroBridge() {
  const navigate = useNavigate();
  const shells = useThreadShells();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const routeThreadRef = useThreadRouteRef();
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const storedSlots = useCodexMicroSlotStore((state) => state.slots);
  const setSlots = useCodexMicroSlotStore((state) => state.setSlots);
  const removableMissingKeys = useAtomValue(
    Atom.make((get) => {
      const catalog = get(environmentCatalog.catalogValueAtom);
      return new Set(
        storedSlots.filter((key): key is string => {
          if (key === null) return false;
          const ref = parseScopedThreadKey(key);
          if (ref === null) return true;
          // Discovery can publish a ready catalog before the primary arrives.
          if (!catalog.entries.has(ref.environmentId)) return false;
          return get(environmentShell.stateValueAtom(ref.environmentId)).status === "live";
        }),
      );
    }),
  );

  const shellByKey = new Map(
    shells
      .filter((shell) => shell.archivedAt === null && shell.deletedAt === null)
      .map((shell) => [scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)), shell]),
  );
  // Pinned threads first, then the most recently messaged.
  const candidates = [...shellByKey.entries()]
    .toSorted(([, a], [, b]) => {
      if ((a.pinnedAt === null) !== (b.pinnedAt === null)) return a.pinnedAt === null ? 1 : -1;
      const aAt = a.latestUserMessageAt ?? a.createdAt;
      const bAt = b.latestUserMessageAt ?? b.createdAt;
      return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
    })
    .map(([key]) => key);
  // An offline environment's absent thread is not evidence of deletion.
  const slots = assignSlots(storedSlots, candidates, new Set(shellByKey.keys()), (key) =>
    removableMissingKeys.has(key),
  );
  const slotsSignature = JSON.stringify(slots);

  useEffect(() => {
    if (slotsSignature !== JSON.stringify(useCodexMicroSlotStore.getState().slots)) {
      setSlots(JSON.parse(slotsSignature) as Array<string | null>);
    }
  }, [setSlots, slotsSignature]);

  const lighting = Array.from({ length: CODEX_MICRO_SLOT_COUNT }, (_, id) => {
    const key = slots[id] ?? null;
    const shell = key === null ? undefined : shellByKey.get(key);
    if (key === null || shell === undefined) {
      return slotLighting(id, { assigned: false, status: null, active: false });
    }
    const lastVisitedAt = resolveThreadLastVisitedAt(shell.lastVisitedAt, lastVisitedById[key]);
    const pill = resolveThreadStatusPill({
      thread: { ...shell, ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }) },
    });
    return slotLighting(id, {
      assigned: true,
      status: pill?.label ?? null,
      active: key === routeThreadKey,
    });
  });
  const lightingSignature = JSON.stringify(lighting);

  useEffect(() => {
    readCodexMicroConnection()?.setLighting(
      JSON.parse(lightingSignature) as CodexMicroSlotLighting[],
    );
  }, [lightingSignature]);

  const openThread = (key: string | null) => {
    const ref = key === null ? null : parseScopedThreadKey(key);
    if (ref === null) return;
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const onMessage = useEffectEvent(
    (
      message: CodexMicroDeviceMessage,
      keys: CodexMicroKeyTracker,
      joystick: CodexMicroJoystickTracker,
    ) => {
      if (message.type === "joystick") {
        const direction = joystick.handle(message.angle, message.distance);
        if (direction !== null) openThread(adjacentSlot(slots, routeThreadKey, direction));
        return;
      }
      if (message.type !== "key") return;
      const action = keys.handle(message.key, message.action);
      if (action === null) return;
      if (action.type === "slot") {
        openThread(slots[action.slot] ?? null);
      } else if (action.command === "commandPalette.toggle") {
        if (!isCommandPaletteOpen()) openCommandPalette();
      } else {
        dispatchAppCommand(action.command);
      }
    },
  );

  useEffect(() => {
    const keys = new CodexMicroKeyTracker();
    const joystick = new CodexMicroJoystickTracker();
    return subscribeCodexMicroMessages((message) => onMessage(message, keys, joystick));
  }, []);

  return null;
}
