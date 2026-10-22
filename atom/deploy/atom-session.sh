#!/bin/sh
export DISPLAY="${DISPLAY:-:0}"
openbox --sm-disable --config-file /home/linaro/atom/deploy/atom-openbox.xml &
window_manager_pid=$!
trap 'kill "$window_manager_pid" 2>/dev/null || true' EXIT HUP INT TERM
while kill -0 "$window_manager_pid" 2>/dev/null; do
    /home/linaro/atom/deploy/start-atom.sh >> /tmp/atom-kiosk.log 2>&1
    sleep 2
done
