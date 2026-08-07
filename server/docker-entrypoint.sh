#!/bin/sh
set -eu

mkdir -p "${MODEL_STORAGE_DIR:-/data/models}" "${TEMP_DIR:-/data/tmp}"
chown -R node:node "${MODEL_STORAGE_DIR:-/data/models}" "${TEMP_DIR:-/data/tmp}"

exec gosu node "$@"
