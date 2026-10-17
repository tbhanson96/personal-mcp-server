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
      PERSONAL_MCP_CHATGPT_PROFILE_DIR|PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH|PERSONAL_MCP_CHATGPT_PLUGIN_NAME|PERSONAL_MCP_CHATGPT_HEADLESS|DISPLAY)
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

exec node "$script_dir/refresh-chatgpt-plugin.mjs" "$@"
