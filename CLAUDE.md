# Simple GNOME Shell

GNOME Shell 50 extension (Wayland). It draws the top bar and the Dash to Dock docks as shapes grown out of the screen
edge, and makes menus, notifications, the OSD and the dock's window previews grow out of them. See README.md for the
feature list.

## Layout

- `extension.js` starts the parts in order (bars first, so the rest can grow out of them) and waits while Liquid Glass
  is active.
- `bar.js` (`EdgeBar`), `topBar.js`, `dock.js`: the bars. A bar registers itself in `growth.js` (`addBar`), and
  `growsFrom(source, key)` decides what may grow out of it.
- `growth.js` (`BarGrowth`): the spring animation that grows content out of a bar. `menus.js`, `banners.js` and `osd.js`
  are its hosts. Every `PopupMenu` added to `uiGroup` is hooked by `menus.js` automatically.
- `previews.js`: opens Dash to Dock's own `WindowPreviewMenu` on hover. It imports the class from Dash to Dock's
  installed `windowPreview.js`, so it is the same module instance. It opens without a `PopupMenuManager` (no grab) and
  without `popup()` (no keyboard focus). It patches `shouldShowTooltip` on each app icon to hide the name label, and
  removes the patch on destroy. Being a `PopupMenu`, the growth comes from `menus.js`.
- `labels.js`: the dock's app name labels. It patches `showLabel` and `hideLabel` on each Dash to Dock item
  container (all of a dock's, hooked when the pointer comes onto the dock) to run them through a `BarGrowth`, and removes the patch on
  destroy. The "Dock menus" setting covers it.
- `layout.js`, `shape.js`, `blur.js`, `spring.js`, `frames.js`: geometry, drawing, blur, springs, the per-frame loop.
- `prefs.js` and `schemas/`: settings. After changing the schema, run `glib-compile-schemas schemas`.

Conventions: comments say what holds and why, in plain sentences. Check actors with `isActorValid()` before touching
them, and undo everything in `destroy()`. The shell and Dash to Dock internals in use are listed in README's Limits.

## Testing

- `gjs -m tests/layout.test.js`: unit tests for the shape geometry.
- `tools/run-headless.sh`: a headless shell with the driver extension. It writes a log and screenshots.
- **The VM (the preferred end-to-end test):** `lg-gnome50` in the libvirt *user* session (`qemu:///session`, shown in
  virt-manager under "QEMU/KVM User session"). It runs Fedora 44, GNOME 50, two monitors (1920x1080 primary +
  1280x800), Dash to Dock at the bottom and the user's other extensions. Its files are in `~/VMs/lg-gnome50`.
  - `tools/vm-push.sh` starts the VM if needed, packs and installs this checkout, adds it to the enabled list,
    restarts GDM (which logs `lg` back in) and waits until the extension is ACTIVE.
  - Don't disable or toggle extensions in the VM, this one or others: leave them as they are. (A disable and enable
    in one `shell-eval.sh` call leaves this one INACTIVE while it is still in the enabled list.)
  - `~/VMs/lg-gnome50/shell-eval.sh '<js>'` runs JS in the VM's shell (the `vm-eval@lg.test` extension turns on unsafe
    mode). The extension's parts are at `Main.extensionManager.lookup('simple-gnome-shell@alessandrot').stateObj._parts`.
  - SSH: `ssh -i ~/VMs/lg-gnome50/id_ed25519 -o UserKnownHostsFile=~/VMs/lg-gnome50/known_hosts -p 2222 lg@127.0.0.1`.
    For gsettings and gnome-extensions there, set `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`. Logs:
    `journalctl --user -b`.
  - Screenshots: `virsh -c qemu:///session screenshot lg-gnome50 out.ppm --screen 1` gives the 1920x1080 primary;
    `--screen 0` gives the 1280x800 second monitor.
  - Pointer: create a virtual device with shell-eval
    (`global._vp = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE)`)
    and call `notify_absolute_motion` / `notify_button`. It does not trigger Dash to Dock's edge-pressure reveal, so
    keep windows off the dock (`move_resize_frame`) rather than relying on intellihide.
  - The session comes up in the overview, and `Main.modalCount` is 1 until `Main.overview.hide()`.
  - Launch apps with `Shell.AppSystem.get_default().lookup_app(id).open_new_window(-1)`. Dash to Dock ignores windows
    with `skip_taskbar` (the VM's Firefox window has it).

## Install locally

See README "Install" (`gnome-extensions pack` with every module as `--extra-source`). A new module has to be added
there too. Then load it into the running session with `gext-reload simple-gnome-shell@alessandrot` (the user's script,
`~/GIT/gext-reload`, with its helper extension `gext-reload@alessandrot`), so no log out is needed. Check with
`gnome-extensions info simple-gnome-shell@alessandrot` (State: ACTIVE) and
`journalctl --user -b --since -1min -g "Simple GNOME Shell|JS ERROR"`. The user's notes on it are in Obsidian:
`~/Dokumente/Obsidian/LinuxDocs/Customizations/15-Load-New-GNOME-Extension-Without-Relogin.md`.
