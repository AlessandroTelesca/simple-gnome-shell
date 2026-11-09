# Simple GNOME Shell

The top bar and [Dash to Dock](https://extensions.gnome.org/extension/307/dash-to-dock/) grow out of the screen edge, joined to it by curved flares. Menus, notifications and the volume and brightness popup grow out of the bars the same way. What is behind them is blurred and tinted. Each shape is a few rounded rectangles and small Cairo corners, drawn again only when the shape changes.

This is a fork of [Simple GNOME Shell](https://github.com/AlessandroTelesca/simple-gnome-shell) that adds the blur.

- **Top bar:** centered and shrunk to its buttons, or across the monitor. The bars [Multi Monitors Bar](https://github.com/AlessandroTelesca/multi-monitors-bar_fapv2) adds on other monitors get the same shape.
- **Dock:** on any side of the screen and on every monitor. While it slides away, its shape draws back into the edge.
- **Menus:** top bar menus, and on docks at the top or bottom, app icon and [Dock Tray](https://github.com/AlessandroTelesca/dock-tray) menus, spring out of the bar they were opened from. A menu whose button isn't on a bar keeps the theme's look. A centered top bar and its notification center share their width: whichever is narrower widens to the other. The notification center has a maximum height, past which its notifications scroll, and always stops short of a dock along the bottom of the screen.
- **Notifications and the volume and brightness popup:** grow out of the top bar, or out of the screen edge while the bar is hidden.
- **Blur:** the screen behind each shape is copied, scaled down and back up through a few small offscreens, and drawn back through the shape's outline, with plain Cogl drawing and blend modes: no refraction and no shaders of its own. Three styles: *Smooth* (four taps a pass, gaussian-like), *Fast* (one bilinear tap a pass, cheapest) and *Frosted* (smooth with a fine grain). The tint color and strength are laid over it.
- **Hidden clock:** the tab of [Hide Top Bar: Multi Monitors](https://github.com/AlessandroTelesca/hidetopbar-multimonitor) takes the same color.

Everything is set in the preferences: the blur, its style and strength, the tint color and strength, the color of the text and icons on it, the radii of the outward-rounded corners and the inward-curved flares, the top bar's height and width, the space above and below the dock's apps, and each of the above on or off.

GNOME Shell 50, Wayland.

## Install

```sh
gnome-extensions pack --force \
  --extra-source=layout.js --extra-source=shape.js --extra-source=frames.js --extra-source=spring.js \
  --extra-source=growth.js --extra-source=bar.js --extra-source=topBar.js --extra-source=dock.js \
  --extra-source=menus.js --extra-source=tab.js --extra-source=banners.js --extra-source=osd.js \
  --extra-source=hiddenClock.js --extra-source=generatedStyle.js --extra-source=textColor.js --extra-source=blur.js .
gnome-extensions install --force simple-gnome-shell@alessandrot.shell-extension.zip
```

Then log out and in, and `gnome-extensions enable simple-gnome-shell@alessandrot`.

Liquid Glass draws on the same surfaces, so this extension stays idle for as long as Liquid Glass is active and starts by itself once it is turned off.

## Limits

Where only part of a blurred shape is redrawn, the blur reads back some of the last frame there; the shape is redrawn whole on the next frame, so this lasts a frame at most.

It relies on shell and Dash to Dock internals (`MessageTray._bannerBin`, `OsdWindow._hbox`, `BoxPointer` eases, Dash to Dock's actor names), so an update to either can break it.

## Tests

- `gjs -m tests/layout.test.js` tests the shape geometry.
- `tools/run-headless.sh` runs the extension with your other installed extensions and `tools/driver@simple-gnome-shell.test` in a headless shell on a private session bus, and leaves screenshots and a log. It only reads your settings, and your session isn't touched.

## License

MIT, see `LICENSE`. The growth animation and the bar and dock tracking are adapted from [Liquid Glass](https://github.com/ryohsuke1231/liquid-glass) by Ryosuke Watanabe, also MIT.
