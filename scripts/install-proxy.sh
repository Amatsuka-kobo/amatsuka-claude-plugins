#!/bin/bash
# CLIProxyAPI のインストールスクリプト

# インストール済みか確認
if [ -e "$HOME/.local/bin/cli-proxy-api" ]; then
  echo "CLIProxyAPI is already installed."
else
  # インストール処理

  # third-party ディレクトリが存在しない場合は作成
  if [ ! -d "$HOME/third-party" ]; then
    mkdir -p "$HOME/third-party"
  fi

  # CLIProxyAPI のインストール
  curl -fsSL https://raw.githubusercontent.com/router-for-me/cliproxyapi-installer/refs/heads/master/cliproxyapi-installer | bash
  mv "$HOME/cliproxyapi" "$HOME/third-party/cliproxyapi"
  ln -s "$HOME/third-party/cliproxyapi/cli-proxy-api" "$HOME/.local/bin/cli-proxy-api"
fi

# config ファイルの作成
if [ ! -e ./cliproxyapi.config.yaml ]; then
  cp ./cliproxyapi.config.example.yaml ./cliproxyapi.config.yaml

  # API キーの作成と永続化 export
  API_KEY="sk-$(openssl rand -base64 24)"
  sed -i "s|replace-with-a-random-local-key|${API_KEY}|g" ./cliproxyapi.config.yaml

  EXPORT="
# Claude Code (CLIProxyAPI)
export ANTHROPIC_AUTH_TOKEN=${API_KEY}
"
  if [ -e "$HOME/.profile" ]; then
    echo "$EXPORT" >> "$HOME/.profile"
    source "$HOME/.profile"
  elif [ -e "$HOME/.bash_profile"]; then
    echo "$EXPORT" >> "$HOME/.bash_profile"
    source "$HOME/.bash_profile"
  else
    echo "$EXPORT" >> "$HOME/.bashrc"
    source "$HOME/.bashrc"
  fi
fi