import type { DesktopDictationState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import {
  CODEX_MICRO_SHORTCUT_MODIFIERS,
  SHORTCUT_NAMED_KEYS,
  WISPR_FLOW_PRESETS,
  detectCodexMicroPlatform,
  modifierLabel,
  orderedModifiers,
  shortcutKeyLabels,
  shortcutsEqual,
  useCodexMicroConfigStore,
  type CodexMicroDictationProvider,
  type CodexMicroShortcut,
} from "~/codexMicro/config";
import {
  DICTATION_DESKTOP_REQUIRED,
  readDictationBridge,
  useCodexMicroDictationStatus,
} from "~/codexMicro/dictation";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Kbd, KbdGroup } from "../ui/kbd";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Toggle } from "../ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const PROVIDER_LABELS: Readonly<Record<CodexMicroDictationProvider, string>> = {
  "wispr-flow": "Wispr Flow",
  custom: "Another app",
};

const LETTER_AND_DIGIT_KEYS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
];

const NO_KEY = "none";
const CUSTOM_PRESET = "custom";

/** Reads what the desktop app can do, again whenever the window regains focus. */
function useDictationCapability() {
  const [bridge] = useState(readDictationBridge);
  const [state, setState] = useState<DesktopDictationState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (bridge === null) return;
    let current = true;
    const refresh = () => {
      bridge.getDictationState().then(
        (next) => {
          if (!current) return;
          setState(next);
          setFailed(false);
        },
        () => {
          if (current) setFailed(true);
        },
      );
    };
    refresh();
    // Accessibility access is granted in System Settings, outside the app.
    window.addEventListener("focus", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
    };
  }, [bridge]);

  return { available: bridge !== null, state, failed };
}

function CapabilityStatus({ provider }: { provider: CodexMicroDictationProvider }) {
  const { available, state, failed } = useDictationCapability();
  const live = useCodexMicroDictationStatus();

  let tone: "ok" | "warn" | "muted" = "muted";
  let text: string;
  let action: { label: string; run: () => void } | null = null;
  if (!available) {
    text = `${DICTATION_DESKTOP_REQUIRED} Other Micro controls work here.`;
  } else if (failed) {
    tone = "warn";
    text = "Couldn't check dictation support.";
  } else if (state === null) {
    text = "Checking dictation support…";
  } else if (!state.supported) {
    tone = "warn";
    text = state.message ?? `Dictation from Codex Micro isn't available on ${state.platform} yet.`;
  } else if (!state.accessibilityGranted) {
    tone = "warn";
    text = "Allow T3 Code under Accessibility so it can press your dictation shortcut.";
    const open = window.desktopBridge?.openSystemSettings;
    if (open) action = { label: "Open Accessibility", run: () => void open("accessibility") };
  } else if (provider === "wispr-flow" && !state.wisprFlowInstalled) {
    tone = "warn";
    text = "Wispr Flow isn't installed. Install it, or choose another dictation app.";
  } else if (live.mode === "holding") {
    tone = "ok";
    text = "Dictating while the key is held.";
  } else if (live.mode === "latched") {
    tone = "ok";
    text = "Dictating hands-free. Press the key again to stop.";
  } else {
    tone = "ok";
    text = provider === "wispr-flow" ? "Ready · Wispr Flow found" : "Ready";
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* The dot rides in the text's first line so it never wraps away from it. */}
      <span role="status" className="min-w-0">
        <span
          aria-hidden
          className={cn(
            "me-2 mb-px inline-block size-1.5 rounded-full align-middle",
            tone === "ok"
              ? "bg-success"
              : tone === "warn"
                ? "bg-warning"
                : "bg-muted-foreground/30",
          )}
        />
        {text}
      </span>
      {action ? (
        <Button size="xs" variant="outline" onClick={action.run}>
          {action.label}
        </Button>
      ) : null}
      {live.error && available && state?.supported ? (
        <span className="basis-full text-destructive">{live.error}</span>
      ) : null}
    </span>
  );
}

export function CodexMicroDictationSettings() {
  const [platform] = useState(detectCodexMicroPlatform);
  const dictation = useCodexMicroConfigStore((state) => state.config.dictation);
  const setDictation = useCodexMicroConfigStore((state) => state.setDictation);
  const presets = WISPR_FLOW_PRESETS[platform];
  const matchedPreset = presets.find(
    (preset) =>
      shortcutsEqual(preset.hold, dictation.holdShortcut) &&
      shortcutsEqual(preset.toggle, dictation.toggleShortcut),
  );
  const [customizing, setCustomizing] = useState(false);
  const wispr = dictation.provider === "wispr-flow";
  const showEditors = !wispr || presets.length === 0 || matchedPreset === undefined || customizing;
  const conflict = shortcutsEqual(dictation.holdShortcut, dictation.toggleShortcut);

  return (
    <SettingsRow
      {...searchableSetting("codex-micro-dictation")}
      title="Dictation"
      description="A key set to Dictate starts your dictation app by pressing its shortcut for you. Hold to talk, double-press for hands-free, and press again to stop."
      status={<CapabilityStatus provider={dictation.provider} />}
      control={
        <Select
          value={dictation.provider}
          onValueChange={(next) => {
            if (next === "wispr-flow" || next === "custom") setDictation({ provider: next });
          }}
        >
          <SelectTrigger aria-label="Dictation app" size="sm" className="w-36">
            <SelectValue>{PROVIDER_LABELS[dictation.provider]}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="wispr-flow">Wispr Flow</SelectItem>
            <SelectItem value="custom">Another app</SelectItem>
          </SelectPopup>
        </Select>
      }
    >
      <div className="space-y-3 pt-1 pb-3">
        {wispr && presets.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Flow shortcut</span>
            <ToggleGroup
              aria-label="Wispr Flow shortcut"
              variant="segmented"
              value={[matchedPreset && !customizing ? matchedPreset.id : CUSTOM_PRESET]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === undefined) return;
                if (value === CUSTOM_PRESET) {
                  setCustomizing(true);
                  return;
                }
                const preset = presets.find((candidate) => candidate.id === value);
                if (!preset) return;
                setCustomizing(false);
                setDictation({ holdShortcut: preset.hold, toggleShortcut: preset.toggle });
              }}
            >
              {presets.map((preset) => (
                <ToggleGroupItem key={preset.id} value={preset.id}>
                  {preset.label}
                </ToggleGroupItem>
              ))}
              <ToggleGroupItem value={CUSTOM_PRESET}>Custom</ToggleGroupItem>
            </ToggleGroup>
          </div>
        ) : null}

        <div className="divide-y divide-border/50 rounded-lg border border-border/60">
          <ShortcutLine
            label="Push to talk"
            hint="Held while the key is held"
            shortcut={dictation.holdShortcut}
            editable={showEditors}
            platform={platform}
            onChange={(holdShortcut) => setDictation({ holdShortcut })}
          />
          <ShortcutLine
            label="Hands-free"
            hint="Pressed to start and to stop"
            shortcut={dictation.toggleShortcut}
            editable={showEditors}
            platform={platform}
            onChange={(toggleShortcut) => setDictation({ toggleShortcut })}
          />
        </div>

        {conflict ? (
          <p role="alert" className="text-xs text-warning">
            Use different shortcuts for push to talk and hands-free.
          </p>
        ) : null}
        <p className="text-xs leading-normal text-muted-foreground">
          {wispr ? (
            <>
              These must match Wispr Flow’s shortcuts in Settings › General › Shortcuts. If you
              changed them in Flow, choose Custom and enter the same keys.{" "}
              <a
                href="https://docs.wisprflow.ai/articles/2612050838-Supported-%26-Unsupported-Keyboard-Hotkey-Shortcuts"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Supported shortcuts
              </a>
            </>
          ) : (
            "Enter the shortcuts your dictation app uses for push-to-talk and hands-free. If the app only has one start/stop shortcut, use it for hands-free; holding the key won't work with that app."
          )}
        </p>
      </div>
    </SettingsRow>
  );
}

function ShortcutLine({
  label,
  hint,
  shortcut,
  editable,
  platform,
  onChange,
}: {
  label: string;
  hint: string;
  shortcut: CodexMicroShortcut;
  editable: boolean;
  platform: ReturnType<typeof detectCodexMicroPlatform>;
  onChange: (shortcut: CodexMicroShortcut) => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 @min-[32rem]/settings-row:flex-row @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-2xs text-muted-foreground">{hint}</div>
      </div>
      {editable ? (
        <ShortcutEditor label={label} shortcut={shortcut} platform={platform} onChange={onChange} />
      ) : (
        <KbdGroup aria-label={shortcutKeyLabels(shortcut, platform).join(" + ")}>
          {shortcutKeyLabels(shortcut, platform).map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      )}
    </div>
  );
}

/**
 * Builds a shortcut from buttons rather than by recording keys, so pressing
 * the dictation app's real shortcut here can't start it.
 */
function ShortcutEditor({
  label,
  shortcut,
  platform,
  onChange,
}: {
  label: string;
  shortcut: CodexMicroShortcut;
  platform: ReturnType<typeof detectCodexMicroPlatform>;
  onChange: (shortcut: CodexMicroShortcut) => void;
}) {
  // The Fn key is only addressable on a Mac.
  const modifiers = CODEX_MICRO_SHORTCUT_MODIFIERS.filter(
    (modifier) => modifier !== "fn" || platform === "mac" || shortcut.modifiers.includes("fn"),
  );
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label={`${label} shortcut`}
    >
      {modifiers.map((modifier) => {
        const pressed = shortcut.modifiers.includes(modifier);
        // A shortcut needs at least one key.
        const last = pressed && shortcut.modifiers.length === 1 && shortcut.key === null;
        return (
          <Toggle
            key={modifier}
            size="xs"
            variant="outline"
            pressed={pressed}
            disabled={last}
            onPressedChange={(next) =>
              onChange({
                ...shortcut,
                modifiers: orderedModifiers(
                  next
                    ? [...shortcut.modifiers, modifier]
                    : shortcut.modifiers.filter((entry) => entry !== modifier),
                ),
              })
            }
          >
            {modifierLabel(modifier, platform)}
          </Toggle>
        );
      })}
      <span aria-hidden className="px-0.5 text-xs text-muted-foreground">
        +
      </span>
      <Select
        value={shortcut.key ?? NO_KEY}
        onValueChange={(next) => {
          if (next === null) return;
          const key = next === NO_KEY ? null : next;
          if (key === null && shortcut.modifiers.length === 0) return;
          onChange({ ...shortcut, key });
        }}
      >
        <SelectTrigger aria-label={`${label} key`} size="xs" className="w-24 min-w-0">
          <SelectValue>{shortcut.key ?? "No key"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={NO_KEY} disabled={shortcut.modifiers.length === 0}>
            No key
          </SelectItem>
          <SelectGroup>
            <SelectGroupLabel>Keys</SelectGroupLabel>
            {SHORTCUT_NAMED_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectGroupLabel>Letters and digits</SelectGroupLabel>
            {LETTER_AND_DIGIT_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {key}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </div>
  );
}
