#!/bin/sh
# Optional: Chinese pinyin input for USB/Bluetooth keyboards (fcitx 4 + Google Pinyin from the Debian buster archive).
# Idempotent; run on the device as linaro:  sh /home/linaro/atom/deploy/install-keyboard-input.sh
# Takes effect when the kiosk browser restarts (start-atom.sh enables fcitx when it is installed).
set -eu
PKGS='fcitx fcitx-frontend-gtk3 fcitx-ui-classic fcitx-googlepinyin fcitx-config-common fcitx-module-x11 fcitx-module-dbus'
# ATOM_APT_MIRROR (e.g. https://mirrors.aliyun.com/debian-archive) uses a mirror for this install only; the
# system's apt sources are not changed. archive.debian.org can be too slow to finish from mainland China.
set --
if [ -n "${ATOM_APT_MIRROR:-}" ]; then
    list=$(mktemp)
    printf 'deb %s/debian buster main\ndeb %s/debian buster-updates main\ndeb %s/debian-security buster/updates main\n' "$ATOM_APT_MIRROR" "$ATOM_APT_MIRROR" "$ATOM_APT_MIRROR" > "$list"
    trap 'rm -f "$list"' EXIT
    set -- -o Dir::Etc::SourceList="$list" -o Dir::Etc::SourceParts=/dev/null
fi
if ! dpkg -s $PKGS >/dev/null 2>&1; then
    sudo apt-get "$@" -o Acquire::Check-Valid-Until=false update
    sudo DEBIAN_FRONTEND=noninteractive apt-get "$@" install -y --no-install-recommends $PKGS
fi
conf="$HOME/.config/fcitx"
mkdir -p "$conf"
# English keyboard first (inactive by default), pinyin second: Ctrl+Space toggles.
[ -f "$conf/profile" ] || printf '[Profile]\nIMName=googlepinyin\nEnabledIMList=fcitx-keyboard-us:True,googlepinyin:True\n' > "$conf/profile"
# Fullscreen kiosk: no floating status bar or trigger tips, only the candidate list while composing.
cat > "$conf/config" <<'EOF'
[Hotkey]
TriggerKey=CTRL_SPACE
[Program]
ShareStateAmongWindow=All
[Output]
[Appearance]
HideMainWindow=All
ShowInputWindowAfterTriggering=False
ShowInputSpeed=False
ShowVersion=False
EOF
echo 'Keyboard input installed. Restart the kiosk browser (pkill -f chromium-bin) to enable it.'
