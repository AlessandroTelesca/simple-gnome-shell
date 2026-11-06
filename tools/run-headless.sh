#!/usr/bin/env bash
# Runs the extension with your other extensions and the test driver in a headless GNOME Shell on a private session bus,
# with its own config, data and cache directories: the real session's dconf database, extensions and screen are not
# touched. Only reads your settings, which it copies into the private session. Prints the output directory (shell.log,
# shots/).
#
#   SGS_MONITORS  virtual monitor modes separated by spaces (default: "1920x1080 1920x1080")
#   SGS_STEPS     the driver's steps to run, comma separated (default: all)
#   SGS_TIMEOUT   seconds before the shell is killed (default: 150)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
uuid=simple-gnome-shell@alessandrot
drv=driver@simple-gnome-shell.test
out=${1:-$(mktemp -d -t sgs-XXXXXX)}
user_ext=$HOME/.local/share/gnome-shell/extensions
# firefox-keepalive is left out: it would start Firefox. It only handles windows.
others="dash-to-dock@micxgx.gmail.com hidetopbar@mathieu.bidon.ca hidetopbar-multimonitor@alessandrot
multi-monitors-bar@frederykabryan dock-tray@alessandrot media-controller@naimur hide-datemenu-clocks-weather@alessandrot
hide-spotify-tray@alessandrot notification-configurator@exposedcat wack-lockscreen-clock@rinzler69-wastaken.github.com"

ext="$out/data/gnome-shell/extensions"
mkdir -p "$out"/{config,cache,shots} "$ext"
rm -rf "${ext:?}"/* "$out"/shots/*
mkdir "$ext/$uuid"
(cd "$repo" && cp -r metadata.json ./*.js stylesheet.css schemas "$ext/$uuid/")
glib-compile-schemas "$ext/$uuid/schemas"
cp -r "$here/$drv" "$ext/"
enabled="'$drv', '$uuid', 'appindicatorsupport@rgcjonas.gmail.com'"
for other in $others; do
  cp -r "$user_ext/$other" "$ext/"
  enabled="$enabled, '$other'"
done
# Installed but not enabled, for the check that the two do not run at once.
[ -d "$user_ext/liquid-glass@thinkingcoding1231.gmail.com" ] && cp -r "$user_ext/liquid-glass@thinkingcoding1231.gmail.com" "$ext/"

dconf dump /org/gnome/shell/extensions/ | awk '
  /^\[/ { skip = ($0 ~ /^\[liquid-glass/) }
  !skip' > "$out/settings.ini"
favorites=$(gsettings get org.gnome.shell favorite-apps)

export XDG_CONFIG_HOME="$out/config" XDG_DATA_HOME="$out/data" XDG_CACHE_HOME="$out/cache"
# Short, since a Wayland socket path is limited to 108 bytes.
XDG_RUNTIME_DIR=$(mktemp -d /tmp/sgsrt.XXXXXX)
export XDG_RUNTIME_DIR SGS_OUT="$out/shots" SGS_STEPS="${SGS_STEPS:-}"
[ -n "$SGS_STEPS" ] || unset SGS_STEPS
export XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_DESKTOP=gnome
unset WAYLAND_DISPLAY DISPLAY

monitors=""
for mode in ${SGS_MONITORS:-1920x1080 1920x1080}; do monitors="$monitors --virtual-monitor $mode"; done

dbus-run-session -- bash -c "
  dconf load /org/gnome/shell/extensions/ < '$out/settings.ini'
  gsettings set org.gnome.shell favorite-apps \"$favorites\"
  gsettings set org.gnome.shell enabled-extensions \"[$enabled]\"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell welcome-dialog-last-shown-version '9999'
  exec timeout ${SGS_TIMEOUT:-150} gnome-shell --headless --wayland $monitors --wayland-display sgs-$$
" >"$out/shell.log" 2>&1 || true
fusermount3 -u "$XDG_RUNTIME_DIR/doc" 2>/dev/null || true
rm -rf "$XDG_RUNTIME_DIR" 2>/dev/null || true
echo "$out"
