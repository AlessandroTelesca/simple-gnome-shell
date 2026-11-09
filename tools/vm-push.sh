#!/usr/bin/env bash
# Installs this checkout into the lg-gnome50 test VM (libvirt user session, see ~/VMs/lg-gnome50/create-vm.sh),
# makes sure it is in the enabled list, without touching the other extensions, and restarts the VM's GNOME session:
# Wayland has no in-place shell restart, and GDM logs the user back in. While Liquid Glass is active, this one waits.
#   VM_DIR  the VM's directory, with its SSH key and known_hosts (default: ~/VMs/lg-gnome50)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
vm=${VM_DIR:-$HOME/VMs/lg-gnome50}
uuid=simple-gnome-shell@alessandrot
opts=(-i "$vm/id_ed25519" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$vm/known_hosts")

virsh --connect qemu:///session domstate lg-gnome50 | grep -q running ||
  virsh --connect qemu:///session start lg-gnome50

out=$(mktemp -d)
extra=()
for f in "$repo"/*.js; do
  [ "$(basename "$f")" = extension.js ] || [ "$(basename "$f")" = prefs.js ] || extra+=(--extra-source="$f")
done
gnome-extensions pack --force "${extra[@]}" --schema="$repo/schemas/org.gnome.shell.extensions.simple-gnome-shell.gschema.xml" \
  --out-dir="$out" "$repo"
zip=$out/$uuid.shell-extension.zip
scp "${opts[@]}" -P 2222 "$zip" lg@127.0.0.1:/tmp/sgs.zip
ssh "${opts[@]}" -p 2222 lg@127.0.0.1 bash -s <<EOF
set -e
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u)/bus
gnome-extensions install --force /tmp/sgs.zip
list=\$(gsettings get org.gnome.shell enabled-extensions)
case "\$list" in
  *$uuid*) ;;
  "@as []"|"[]") list="['$uuid']" ;;
  *) list="\${list%]}, '$uuid']" ;;
esac
gsettings set org.gnome.shell enabled-extensions "\$list"
sudo systemd-run --on-active=1 systemctl restart gdm >/dev/null
EOF
rm -rf "$out"
echo "Installed; waiting for the VM's session to come back..."
sleep 10
for _ in $(seq 1 30); do
  state=$(ssh "${opts[@]}" -p 2222 lg@127.0.0.1 \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gnome-extensions info $uuid 2>/dev/null | sed -n 's/ *State: //p'" || true)
  if [ "$state" = ACTIVE ]; then
    sleep 5
    echo "Simple GNOME Shell is running in the VM."
    exit 0
  fi
  sleep 3
done
echo "The VM's session did not come back with Simple GNOME Shell active (state: ${state:-?})." >&2
exit 1
