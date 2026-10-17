#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
config_file=${PERSONAL_MCP_CHATGPT_CONFIG_FILE:-$config_root/personal-mcp-server/chatgpt-refresh.env}

if [[ -f $config_file ]]; then
  while IFS= read -r config_line || [[ -n $config_line ]]; do
    [[ -z $config_line || $config_line == \#* ]] && continue
    [[ $config_line == *=* ]] || {
      echo "invalid ChatGPT refresh config line in $config_file" >&2
      exit 2
    }
    config_key=${config_line%%=*}
    config_value=${config_line#*=}
    case $config_key in
      PERSONAL_MCP_CHATGPT_PROFILE_DIR|PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH|PERSONAL_MCP_CHATGPT_PLUGIN_NAME|PERSONAL_MCP_CHATGPT_HEADLESS)
        ;;
      *)
        echo "unsupported ChatGPT refresh config key: $config_key" >&2
        exit 2
        ;;
    esac
    if [[ ! -v $config_key ]]; then
      printf -v "$config_key" '%s' "$config_value"
      export "$config_key"
    fi
  done < "$config_file"
fi

if [[ ! -v PERSONAL_MCP_CHATGPT_HEADLESS ]]; then
  PERSONAL_MCP_CHATGPT_HEADLESS=0
fi
for refresh_arg in "$@"; do
  [[ $refresh_arg == --headed ]] && PERSONAL_MCP_CHATGPT_HEADLESS=0
  [[ $refresh_arg == --headless ]] && PERSONAL_MCP_CHATGPT_HEADLESS=1
done
export PERSONAL_MCP_CHATGPT_HEADLESS

headed=false
case $PERSONAL_MCP_CHATGPT_HEADLESS in
  0) headed=true ;;
  1) ;;
  *)
    echo "PERSONAL_MCP_CHATGPT_HEADLESS must be 0 or 1" >&2
    exit 2
    ;;
esac

if [[ $headed == true && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]; then
  command -v xvfb-run >/dev/null 2>&1 || {
    echo "headed ChatGPT refresh requires xvfb-run when no graphical display is active" >&2
    exit 20
  }
  exec xvfb-run -a -s "-screen 0 1280x800x24 -nolisten tcp" \
    node "$script_dir/refresh-chatgpt-plugin.mjs" "$@"
fi

exec node "$script_dir/refresh-chatgpt-plugin.mjs" "$@"
