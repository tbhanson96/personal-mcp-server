#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} =~ ^[0-9a-f]{40}$ ]]; then
  release_sha=$1
else
  echo "usage: $0 <full-commit-sha> [--refresh-chatgpt]" >&2
  exit 2
fi

refresh_chatgpt=false
if [[ ${2:-} == --refresh-chatgpt ]]; then
  refresh_chatgpt=true
elif [[ -n ${2:-} ]]; then
  echo "usage: $0 <full-commit-sha> [--refresh-chatgpt]" >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ $(git -C "$repo_dir" rev-parse HEAD) == "$release_sha" ]] || {
  echo "refusing deployment: repository HEAD is not $release_sha" >&2
  exit 1
}
git -C "$repo_dir" diff --quiet && git -C "$repo_dir" diff --cached --quiet || {
  echo "refusing deployment: tracked worktree changes are present" >&2
  exit 1
}

unit_source="$repo_dir/deploy/systemd/personal-mcp-server.service"
unit_target="$HOME/.config/systemd/user/personal-mcp-server.service"
image_env="$HOME/.config/personal-mcp-server/deployed-image.env"
image="ghcr.io/tbhanson96/personal-mcp-server:sha-$release_sha"
mkdir -p "$(dirname "$unit_target")" "$(dirname "$image_env")"
old_digest=$(docker inspect personal-mcp-server --format '{{.ImageDigest}}' 2>/dev/null || true)
old_revision=$(docker inspect personal-mcp-server --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)
old_ref=
if [[ $old_digest == sha256:* ]]; then
  old_ref="ghcr.io/tbhanson96/personal-mcp-server@$old_digest"
fi

manifest_after="$repo_dir/config/tool-schema-manifest.json"
manifest_tmp=$(mktemp -d "$repo_dir/.git/chatgpt-manifest.XXXXXX")
trap 'rm -rf -- "$manifest_tmp"' EXIT
manifest_before="$manifest_tmp/before.json"
manifest_changed=unknown

"$repo_dir/node_modules/.bin/tsx" "$repo_dir/scripts/generate-tool-schema-manifest.ts" --check "$manifest_after"
if [[ $old_revision =~ ^[0-9a-f]{40}$ ]] && git -C "$repo_dir" cat-file -e "$old_revision^{commit}" 2>/dev/null; then
  old_source="$manifest_tmp/old-source"
  mkdir -p "$old_source"
  git -C "$repo_dir" archive "$old_revision" | tar -x -C "$old_source"
  if "$repo_dir/node_modules/.bin/tsx" "$repo_dir/scripts/generate-tool-schema-manifest.ts" --source-root "$old_source" > "$manifest_before"; then
    if cmp -s "$manifest_before" "$manifest_after"; then
      manifest_changed=false
    else
      manifest_changed=true
    fi
  fi
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

refresh_state_dir="$HOME/.local/state/personal-mcp-server/chatgpt-refresh"
pending_before="$refresh_state_dir/pending-before.json"
pending_after="$refresh_state_dir/pending-after.json"
if [[ -f $pending_before ]]; then
  manifest_before="$pending_before"
  if cmp -s "$pending_before" "$manifest_after"; then
    manifest_changed=false
  else
    manifest_changed=true
  fi
elif [[ $manifest_changed == true ]]; then
  mkdir -p "$refresh_state_dir"
  chmod 0700 "$refresh_state_dir"
  install -m 0600 "$manifest_before" "$pending_before"
  manifest_before="$pending_before"
fi
if [[ $manifest_changed == true ]]; then
  install -m 0600 "$manifest_after" "$pending_after"
fi

if [[ $manifest_changed == false ]]; then
  echo "ChatGPT plugin refresh skipped: advertised tool schema manifest is unchanged"
elif [[ $manifest_changed == unknown ]]; then
  echo "ChatGPT plugin refresh not run: previous deployed manifest could not be reconstructed" >&2
  echo "Compare and refresh manually using the chatgpt-plugin-refresh skill if metadata changed" >&2
elif [[ $refresh_chatgpt == false ]]; then
  echo "ChatGPT plugin refresh is eligible because advertised tool metadata changed" >&2
  echo "Re-run this exact verified deployment with --refresh-chatgpt, or invoke the chatgpt-plugin-refresh skill with the persisted pending manifests" >&2
else
  if "$repo_dir/skills/chatgpt-plugin-refresh/scripts/run-refresh.sh" \
    --before-manifest "$manifest_before" \
    --after-manifest "$manifest_after"; then
    unlink "$pending_before" 2>/dev/null || true
    unlink "$pending_after" 2>/dev/null || true
    echo "ChatGPT plugin metadata refreshed; start a new conversation for affected tools"
  else
    refresh_exit=$?
    echo "deployment succeeded, but ChatGPT plugin refresh requires follow-up (exit $refresh_exit)" >&2
    exit "$refresh_exit"
  fi
fi
