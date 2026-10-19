# Codex Micro

T3 Code can use a Work Louder Codex Micro as a thread controller. Its six agent
keys open threads and light up with each thread's status, and its action keys,
dial, and joystick run common commands.

## Connect

Open **Settings → Integrations → Codex Micro** and choose **Connect**, then
pick the device in the prompt. It works over USB or Bluetooth in the desktop
app and in Chrome or Edge. Other browsers, the mobile app, and pages served over
plain HTTP from another machine cannot reach HID devices.

The device connects to the computer you are using, even when T3 Code is
connected to a remote environment. T3 Code never claims the device on its own:
connect again after reloading or restarting the app. **Disconnect** turns the
key lights off and releases the device; **Forget device** also removes the
browser's permission to use it.

Only one app should drive the key lights. Quit or pause other Codex Micro
software, such as the ChatGPT desktop app, while T3 Code is connected.

## Agent keys

Each agent key keeps its thread until the thread is archived, so keys do not
move when a thread starts or finishes. Empty keys take your pinned threads
first, then your most recently used ones. To put a specific thread on a key,
select the key under **Controls** and choose the thread; if that thread was on
another key, the two swap. **Reassign all agent keys** clears every key so they
refill from that order.

Keys for unavailable environments stay reserved until the environment reconnects.
Use **Reassign all agent keys** to clear those reservations if you have removed
an environment.

Key lights show the thread's status: blue while working, a pulsing amber or
indigo when it needs approval or an answer, violet when a plan is ready, green
when a finished turn is unread, and red when it failed. The thread you have open
glows brighter.

## Controls

**Controls** shows the Micro's layout. Select a key, the dial, or the joystick
to change what it does; while the device is connected, pressing a control on it
selects it too. Settings are saved in this browser or desktop app and apply
right away.

By default:

| Control       | Action                                     |
| ------------- | ------------------------------------------ |
| Key 1 – Key 4 | New thread, send, stop, command palette    |
| Wide key      | Dictate                                    |
| Key 5         | Toggle diff                                |
| Dial          | Turn for reasoning effort; press to choose |
| Joystick      | Up and down step through the agent keys    |

Any key or dial press can be set to a command, to **Dictate**, or to no action.
The dial can instead step through the agent keys, and each joystick direction
can run a command. Commands act on the open thread and follow the same rules as
their keyboard shortcuts, so a command that is unavailable on the keyboard does
nothing on the device either. **Reset controls** restores these defaults and
leaves agent key threads alone.

## Dictation

A key set to **Dictate** starts your dictation app by pressing the app's own
global shortcut for you. T3 Code does not record or receive audio. It first
moves focus to the open thread's message box, and does not start when no thread
is open or its message box cannot take text, so dictated text never lands in
the terminal or another field.

- **Hold** the key to dictate until you let go.
- **Double-press** to keep dictating hands-free.
- **Press once** while hands-free to stop.

Dictation needs the T3 Code desktop app on macOS, with T3 Code allowed under
**System Settings → Privacy & Security → Accessibility**. In a browser the other
controls still work.

Wispr Flow is the default app. Its documented shortcuts are Fn to hold and
Fn + Space for hands-free, or Control + Option and Control + Option + Space on
keyboards without an Apple Fn key. The shortcuts in T3 Code must match the ones
in Wispr Flow under **Settings → General → Shortcuts**; if you changed them
there, choose **Custom** and enter the same keys.

To use another dictation app, choose **Another app** and enter the shortcuts
that app uses. An app with only one start/stop shortcut works with
double-press; set that shortcut as the hands-free shortcut.

Dictation stops when you disconnect the Micro, leave the T3 Code window, or
change these settings, so a shortcut is never left held down.
