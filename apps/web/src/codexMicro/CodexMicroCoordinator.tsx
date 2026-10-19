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
import { toastManager } from "~/components/ui/toast";
import { useUiStateStore } from "~/uiStateStore";

import { useCodexMicroConfigStore, type CodexMicroCommand } from "./config";
import {
  CODEX_MICRO_SLOT_COUNT,
  CodexMicroJoystickTracker,
  CodexMicroKeyTracker,
  adjacentSlot,
  assignSlots,
  compareSlotCandidates,
  slotLighting,
} from "./controller";
import {
  CodexMicroDictationGesture,
  DICTATION_NEEDS_COMPOSER,
  codexMicroDictationChannel,
  gestureMode,
  isDictationStart,
  useCodexMicroDictationStatus,
} from "./dictation";
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
  const candidates = [...shellByKey.entries()]
    .toSorted(([, a], [, b]) => compareSlotCandidates(a, b))
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

  const runCommand = (command: CodexMicroCommand) => {
    if (command === "commandPalette.toggle") {
      if (!isCommandPaletteOpen()) openCommandPalette();
      return;
    }
    dispatchAppCommand(command);
  };

  const onMessage = useEffectEvent(
    (
      message: CodexMicroDeviceMessage,
      keys: CodexMicroKeyTracker,
      joystick: CodexMicroJoystickTracker,
      dictation: CodexMicroDictationGesture,
    ) => {
      const config = useCodexMicroConfigStore.getState().config;
      if (message.type === "joystick") {
        const direction = joystick.handle(message.angle, message.distance);
        if (direction === null) return;
        const action = config.joystick[direction];
        if (action.type === "thread") {
          openThread(adjacentSlot(slots, routeThreadKey, action.direction));
        } else if (action.type === "command") {
          runCommand(action.command);
        }
        return;
      }
      if (message.type !== "key") return;
      const action = keys.handle(message.key, message.action, config);
      if (action === null) return;
      switch (action.type) {
        case "slot":
          openThread(slots[action.slot] ?? null);
          return;
        case "thread":
          openThread(adjacentSlot(slots, routeThreadKey, action.direction));
          return;
        case "command":
          runCommand(action.command);
          return;
        case "dictation":
          if (action.phase === "press") dictation.press(action.key, config.dictation);
          else dictation.release(action.key);
          return;
      }
    },
  );

  useEffect(() => {
    const keys = new CodexMicroKeyTracker();
    const joystick = new CodexMicroJoystickTracker();
    let disposed = false;
    let lastNotice: { message: string; at: number } | null = null;
    // A held key retries on every press; one toast per problem is enough.
    const notify = (title: string, message: string) => {
      const now = Date.now();
      if (lastNotice?.message === message && now - lastNotice.at < 10_000) return;
      lastNotice = { message, at: now };
      toastManager.add({ type: "error", title, description: message });
    };
    const canStart = () => {
      if (dispatchAppCommand("composer.focus")) return true;
      notify("Dictation didn't start", DICTATION_NEEDS_COMPOSER);
      return false;
    };
    const owner = codexMicroDictationChannel.open((result, action, generation, config) => {
      dictation.handleResult(result, action, generation, config);
      useCodexMicroDictationStatus.setState({ error: result.ok ? null : result.message });
      if (result.ok || result.message === null) return;
      notify(
        isDictationStart(action) ? "Dictation didn't start" : "Dictation didn't stop",
        result.message,
      );
    }, canStart);
    const dictation = new CodexMicroDictationGesture(owner.send, {
      // Dictation types into whatever has focus, so it only starts once the
      // open thread's message field has it.
      canStart,
      onChange: (phase) => useCodexMicroDictationStatus.setState({ mode: gestureMode(phase) }),
    });
    const unsubscribeMessages = subscribeCodexMicroMessages((message) =>
      onMessage(message, keys, joystick, dictation),
    );
    // Never leave a dictation shortcut held or a hands-free session running
    // once the window or its settings change underneath it.
    const unsubscribeConfig = useCodexMicroConfigStore.subscribe((state, previous) => {
      if (state.config !== previous.config) dictation.cancel();
    });
    // Focus moving into an embedded preview also blurs the window; only
    // leaving the app counts.
    const onBlur = () => {
      setTimeout(() => {
        if (!disposed && !document.hasFocus()) dictation.cancel();
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      disposed = true;
      window.removeEventListener("blur", onBlur);
      unsubscribeConfig();
      unsubscribeMessages();
      // Releases queue ahead of any later session's start; then this session goes quiet.
      dictation.cancel();
      owner.dispose();
      useCodexMicroDictationStatus.setState({ mode: "idle" });
      keys.reset();
      joystick.reset();
    };
  }, []);

  return null;
}
