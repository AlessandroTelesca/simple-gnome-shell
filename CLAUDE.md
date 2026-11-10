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
- `dockBar.js` (`DockBar`): the "top bar in the dock" mode. It moves the containers of `Main.panel.statusArea`'s buttons
  into two boxes it adds to each horizontal dock's `dashtodockDashContainer`, and puts them back when the dock goes
  (Dash to Dock rebuilds its docks), the mode is turned off or the extension stops. It patches `open` on the buttons'
  menus to tell the dash before a menu opens, and removes the patch when a button goes back. `setTopBarsHidden()` in
  `topBar.js` holds the top bars' boxes hidden meanwhile. The theme's `#panel .panel-button` rules are given again
  for `.simple-gnome-shell-dock-bar` in `stylesheet.css`.
- `labels.js`: the dock's app name labels. It patches `showLabel` and `hideLabel` on each Dash to Dock item
  container (all of a dock's, hooked when the pointer comes onto the dock) to run them through a `BarGrowth`, and removes the patch on
  destroy. The "Dock menus" setting covers it.
- `indicators.js`: hides the icons on the control center button listed in `hidden-indicators`. Their owners show
  them again on every state change, so each hidden icon has a `notify::visible` handler that hides it again.
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

## Install locally and reload

1. Pack and install as in README "Install" (`gnome-extensions pack` with every module as `--extra-source`, then
   `gnome-extensions install --force simple-gnome-shell@alessandrot.shell-extension.zip`). A new module has to be added
   to that command too.
2. Load it into the running session with **`gext-reload simple-gnome-shell@alessandrot`**. On Wayland the shell can't
   restart in place, and an install alone only takes effect at the next login.

### `gext-reload`: the user's reload script

- Script: `~/.local/bin/gext-reload`. Source: `~/GIT/gext-reload` (github.com/AlessandroTelesca/gext-reload).
- It needs its helper extension `gext-reload@alessandrot` to be ACTIVE. The helper is enabled, so it runs from every
  login.
- How it works:
  - It copies the *installed* extension to `$XDG_RUNTIME_DIR/gext-reload/<timestamp>/gnome-shell/extensions/<uuid>`. The shell caches module
    code by path, so a new path loads fresh code.
  - In the copy it renames every `GObject.registerClass` class and `GTypeName` to `<Name>_r<timestamp>`. This avoids
    `Type name … is already registered`.
  - It calls the helper's D-Bus method `io.github.alessandrotelesca.GextReload.Reload(uuid, dir)`. The helper unloads
    the running extension and loads the copy. `org.gnome.Shell.Eval` is blocked on the real session, which is why
    the helper exists.
- Without the helper, the script prints a Looking Glass line (also copied to the clipboard). The user runs it with
  Super+R, `lg`, paste into the Evaluator, Enter.
- The copy is gone after logout, and the next login loads the installed version. Old code stays in memory until
  logout.
- Check the result:
  - `gnome-extensions info simple-gnome-shell@alessandrot` shows State: ACTIVE.
  - `journalctl --user -b --since -1min -g "Simple GNOME Shell|JS ERROR"` shows no errors.
- Risks:
  - A reload runs the code in the live shell. A JS error only puts the extension in ERROR, but a Clutter layout
    error aborts the shell and logs the user out.
  - Anything `destroy()` doesn't undo is left behind by a reload. Patched functions and signal handlers are the
    usual cases.
  - So test risky changes in the VM (above) first.
- If the session crashed:
  - Find the cause: `journalctl -b -g "Clutter-ERROR|ClutterBoxLayout|JS ERROR"`.
  - Then `gnome-extensions disable <uuid>` and `gsettings set org.gnome.shell disable-user-extensions false`.
- The user's full notes: `~/Dokumente/Obsidian/LinuxDocs/Customizations/15-Load-New-GNOME-Extension-Without-Relogin.md`.
