#!/bin/sh
set -eu
# Root-owned device configuration. The default keeps the transparent board's EGL path.
if [ -r /etc/default/atom-kiosk ]; then . /etc/default/atom-kiosk; fi
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export XMODIFIERS=@im=none
export GTK_IM_MODULE=none
export QT_IM_MODULE=none
mkdir -p "$HOME/.cache/atom-chromium"
i=0
until curl -fsS http://127.0.0.1:8770/api/health >/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 30 ] || exit 1
    sleep 1
done
xset s off -dpms s noblank 2>/dev/null || true
export LD_LIBRARY_PATH="/usr/lib/chromium:/usr/lib/chromium/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
case "${ATOM_GRAPHICS:-egl}" in
    egl) set -- --use-gl=egl --ignore-gpu-blocklist --enable-features=VaapiVideoDecoder --enable-accelerated-video-decode --enable-gpu-rasterization "$@" ;;
    software) set -- --disable-gpu --use-gl=swiftshader --disable-gpu-compositing "$@" ;;
    *) echo 'Unknown ATOM_GRAPHICS profile' >&2; exit 1 ;;
esac
# Diagnostics are off by default and must stay on loopback when temporarily enabled.
if [ "${ATOM_DEBUG:-0}" = 1 ]; then set -- --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 "$@"; fi
exec /usr/lib/chromium/chromium-bin \
    --no-sandbox \
    --user-data-dir="$HOME/.cache/atom-chromium" \
    --no-first-run --disable-session-crashed-bubble \
    --force-device-scale-factor=1 --window-position=0,0 \
    --window-size=480,360 "$@" --kiosk http://127.0.0.1:8770/
