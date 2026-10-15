#!/bin/sh
set -eu
umask 077
export HOME=/data/home
export XDG_RUNTIME_DIR=/data/runtime
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
Xvfb :99 -screen 0 1800x1400x24 -nolisten tcp &
xvfb_pid=$!
sleep 1
# Keep the display and session bus alive until Electron has flushed its cofre.
eval "$(dbus-launch --sh-syntax)"
openbox >/dev/null 2>&1 &
wm_pid=$!
/app/node_modules/electron/dist/electron /app/browser/main.cjs "$@" &
app_pid=$!
trap 'kill -TERM "$app_pid" 2>/dev/null || true' TERM INT
set +e
wait "$app_pid"
code=$?
if kill -0 "$app_pid" 2>/dev/null; then
  wait "$app_pid"
  code=$?
fi
kill "$wm_pid" "$xvfb_pid" "$DBUS_SESSION_BUS_PID" 2>/dev/null || true
exit "$code"
