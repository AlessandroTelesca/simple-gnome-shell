# Simple GNOME Shell

The top bar and [Dash to Dock](https://extensions.gnome.org/extension/307/dash-to-dock/) grow out of the screen edge in a plain color, joined to it by curved flares. Menus, notifications and the volume and brightness popup grow out of the bars the same way. It uses no shaders, blur or stage copies: each shape is a few rounded rectangles and small Cairo corners, drawn again only when the shape changes.

- **Top bar:** centered and shrunk to its buttons, or across the monitor. The bars [Multi Monitors Bar](https://github.com/AlessandroTelesca/multi-monitors-bar_fapv2) adds on other monitors get the same shape.
- **Dock:** on any side of the screen and on every monitor. While it slides away, its shape draws back into the edge.
- **Menus:** top bar menus, and on docks at the top or bottom, app icon and [Dock Tray](https://github.com/AlessandroTelesca/dock-tray) menus, spring out of the bar they were opened from. A menu whose button isn't on a bar keeps the theme's look.
- **Notifications and the volume and brightness popup:** grow out of the top bar, or out of the screen edge while the bar is hidden.
- **Hidden clock:** the tab of [Hide Top Bar: Multi Monitors](https://github.com/AlessandroTelesca/hidetopbar-multimonitor) takes the same color.

Everything is set in the preferences: color, opacity, the radii of the outward-rounded corners and the inward-curved flares, the top bar's height, the space above and below the dock's apps, and each of the above on or off.

GNOME Shell 50, Wayland.

## Install

```sh
gnome-extensions pack --force \
  --extra-source=layout.js --extra-source=shape.js --extra-source=frames.js --extra-source=spring.js \
  --extra-source=growth.js --extra-source=bar.js --extra-source=topBar.js --extra-source=dock.js \
  --extra-source=menus.js --extra-source=tab.js --extra-source=banners.js --extra-source=osd.js \
  --extra-source=hiddenClock.js .
gnome-extensions install --force simple-gnome-shell@alessandrot.shell-extension.zip
```

Then log out and in, and `gnome-extensions enable simple-gnome-shell@alessandrot`.

Liquid Glass draws on the same surfaces, so this extension stays idle for as long as Liquid Glass is active and starts by itself once it is turned off.

## Limits

It relies on shell and Dash to Dock internals (`MessageTray._bannerBin`, `OsdWindow._hbox`, `BoxPointer` eases, Dash to Dock's actor names), so an update to either can break it.

## Tests

- `gjs -m tests/layout.test.js` tests the shape geometry.
- `tools/run-headless.sh` runs the extension with your other installed extensions and `tools/driver@simple-gnome-shell.test` in a headless shell on a private session bus, and leaves screenshots and a log. It only reads your settings, and your session isn't touched.

## License

MIT, see `LICENSE`. The growth animation and the bar and dock tracking are adapted from [Liquid Glass](https://github.com/ryohsuke1231/liquid-glass) by Ryosuke Watanabe, also MIT.
