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
first, then your most recently used ones. **Reassign keys** clears every key so
they refill from that order.

Keys for unavailable environments stay reserved until the environment reconnects.
Use **Reassign keys** to clear those reservations if you have removed an environment.

Key lights show the thread's status: blue while working, a pulsing amber or
indigo when it needs approval or an answer, green when a finished turn is
unread, and red when it failed. The thread you have open glows brighter.

## Other controls

The settings section lists what each action key, the dial, and the joystick do.
They act on the open thread and follow the same rules as their keyboard
shortcuts, so a command that is unavailable on the keyboard does nothing on the
device either.
