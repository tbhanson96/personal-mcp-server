#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} =~ ^[0-9a-f]{40}$ ]]; then
  release_sha=$1
else
  echo "usage: $0 <full-commit-sha>" >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
unit_source="$repo_dir/deploy/systemd/personal-mcp-server.service"
unit_target="$HOME/.config/systemd/user/personal-mcp-server.service"
image_env="$HOME/.config/personal-mcp-server/deployed-image.env"
image="ghcr.io/tbhanson96/personal-mcp-server:sha-$release_sha"
mkdir -p "$(dirname "$unit_target")" "$(dirname "$image_env")"
old_digest=$(docker inspect personal-mcp-server --format '{{.ImageDigest}}' 2>/dev/null || true)
old_ref=
if [[ $old_digest == sha256:* ]]; then
  old_ref="ghcr.io/tbhanson96/personal-mcp-server@$old_digest"
fi

rollback() {
  local reason=$1
  echo "deployment verification failed: $reason" >&2
  if [[ -n $old_ref ]]; then
    printf 'PERSONAL_MCP_IMAGE=%s\n' "$old_ref" > "$image_env"
    systemctl --user daemon-reload
    systemctl --user restart personal-mcp-server.service || true
    echo "rollback attempted with previous digest $old_digest" >&2
  else
    echo "no previous image digest was available for automatic rollback" >&2
  fi
  exit 1
}

docker pull "$image"
revision=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ $revision == "$release_sha" ]] || rollback "published image revision is '$revision', expected '$release_sha'"

systemd-analyze --user verify "$unit_source"
install -m 0644 "$unit_source" "$unit_target"
printf 'PERSONAL_MCP_IMAGE=%s\n' "$image" > "$image_env"
chmod 0600 "$image_env"
systemctl --user daemon-reload
systemctl --user restart personal-mcp-server.service || rollback "service restart failed"

healthy=false
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3033/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
[[ $healthy == true ]] || rollback "health endpoint did not become ready"

running_revision=$(docker inspect personal-mcp-server --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ $running_revision == "$release_sha" ]] || rollback "running revision is '$running_revision', expected '$release_sha'"
systemctl --user is-active --quiet personal-mcp-server.service || rollback "service is not active"

echo "deployed personal-mcp-server revision $release_sha"
