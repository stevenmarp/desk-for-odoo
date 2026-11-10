#!/bin/bash
R="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$R/app"
for pid in $(ss -ltnp "sport = :9555" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill $pid; done
for i in $(seq 1 30); do ss -ltn "sport = :9555" | grep -q 9555 || break; sleep 0.5; done
unset ELECTRON_RUN_AS_NODE ELECTRON_NO_ATTACH_CONSOLE
export DESK_WORKSPACE="$R/workspace"
setsid nohup ./node_modules/electron/dist/electron . --remote-debugging-port=9555 --ozone-platform=x11 </dev/null > "$R/workspace/desk-app.log" 2>&1 &
echo "started $!"
