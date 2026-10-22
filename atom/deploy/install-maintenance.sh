#!/bin/sh
# Run on the device as root after copying the reviewed core. Does not restart the display.
set -eu
ATOM_ROOT=${ATOM_ROOT:-/home/linaro/atom}
install -d -o root -g root -m 0755 /home/linaro/.local/lib/atom
install -o root -g root -m 0644 "$ATOM_ROOT/system_update.py" /home/linaro/.local/lib/atom/system_update.py
install -m 0644 "$ATOM_ROOT/deploy/atom-update.service" "$ATOM_ROOT/deploy/atom-update.path" "$ATOM_ROOT/deploy/atom-update-recover.service" /etc/systemd/system/
install -d -m 0755 /etc/systemd/system/atom.service.d
printf '[Unit]\nRequires=atom-update-recover.service\nAfter=atom-update-recover.service\n' > /etc/systemd/system/atom.service.d/recovery.conf
systemctl daemon-reload
systemctl enable atom-update-recover.service atom-update.path
systemctl start atom-update-recover.service
systemctl start atom-update.path

# Narrow system actions used by Settings on the supported Debian 10 image.
install -d -m 0755 /etc/polkit-1/localauthority/50-local.d
install -o root -g root -m 0644 "$ATOM_ROOT/deploy/atom-system.pkla" /etc/polkit-1/localauthority/50-local.d/atom-system.pkla
if getent group bluetooth >/dev/null; then usermod -a -G bluetooth linaro; fi
