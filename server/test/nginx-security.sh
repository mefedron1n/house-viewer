#!/bin/sh
# Isolated integration check; no host ports, production data or external network.
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fixture_dir=$(mktemp -d /tmp/roomark-nginx-test.XXXXXX)
container_id=
cleanup() {
  if [ -n "$container_id" ]; then docker rm -f "$container_id" >/dev/null; fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT INT TERM
mkdir -p "$fixture_dir/server" "$fixture_dir/data" "$fixture_dir/.git" "$fixture_dir/scripts" "$fixture_dir/vendor/three"
printf 'public page' > "$fixture_dir/index.html"
printf 'public viewer' > "$fixture_dir/viewer.html"
printf 'public script' > "$fixture_dir/scripts/app.js"
printf 'public decoder' > "$fixture_dir/vendor/three/decoder.wasm"
printf 'private fixture' > "$fixture_dir/server/.env"
printf 'private fixture' > "$fixture_dir/server/index.js"
printf 'private fixture' > "$fixture_dir/data/users.json"
printf 'private fixture' > "$fixture_dir/.git/config"
chmod -R a+rX "$fixture_dir"
container_id=$(docker run -d --rm --network none --add-host ifc-api:127.0.0.1 \
  -v "$repo_dir/docker/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$fixture_dir:/usr/share/nginx/html:ro" nginx:1.27-alpine)
docker exec "$container_id" nginx -t
tries=0
until docker exec "$container_id" wget -q -O /dev/null http://127.0.0.1/; do
  tries=$((tries + 1))
  [ "$tries" -lt 20 ] || exit 1
  sleep 0.1
done
check() {
  response=$(docker exec "$container_id" wget -S -O /dev/null "http://127.0.0.1$1" 2>&1 || true)
  case "$response" in
    *"HTTP/1.1 $2 "*) printf 'PASS %s %s\n' "$2" "$1" ;;
    *) printf 'FAIL %s expected %s\n%s\n' "$1" "$2" "$response"; exit 1 ;;
  esac
}
check / 200
check /viewer.html 200
check /rooms/test 200
check /scripts/app.js 200
check /vendor/three/decoder.wasm 200
check /.git/config 404
check /server/.env 404
check /server/index.js 404
check /data/users.json 404
check /server/data/sessions.json 404
check /docker-compose.yml 404
check /docs/security-audit.md 404
check /server/%2eenv 404
check /scripts/../server/index.js 404
# Proxy paths must still reach the unavailable stub upstream, not the static root.
check /api/notes 502
check /api/projects/aaaaaaaaaaaaaaaaaaaaaaaa/model 502
