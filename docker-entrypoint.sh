#!/bin/sh
# Starts Tilorama as an unprivileged user that owns the data folder.
#
# A host folder bind-mounted to /data is often owned by root (Docker creates missing folders as
# root) or by the host's own user (Unraid's appdata is 99:100). Started as root, this script hands
# the folder to PUID:PGID (default 1000:1000) and then drops to that user. Started as non-root
# (docker run --user, rootless setups), it runs the app as-is and the folder must already be
# writable by that user.
set -e

DATA_PATH="${TileCache__Root:-/data}"
# libvips and .NET want a writable home.
export HOME=/tmp

if [ "$(id -u)" = "0" ]; then
    PUID="${PUID:-1000}"
    PGID="${PGID:-1000}"

    mkdir -p "$DATA_PATH"

    # Only walk the whole tree when the top folder isn't ours yet (first start, or PUID changed);
    # everything the app creates afterwards already has the right owner.
    if [ "$(stat -c '%u:%g' "$DATA_PATH")" != "$PUID:$PGID" ]; then
        echo "Setting owner of $DATA_PATH to $PUID:$PGID"
        chown -R "$PUID:$PGID" "$DATA_PATH"
    fi

    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups dotnet /app/Tilorama.Server.dll "$@"
fi

exec dotnet /app/Tilorama.Server.dll "$@"
