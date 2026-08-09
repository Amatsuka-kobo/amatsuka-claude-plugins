#!/bin/bash
# CLIProxyAPI のインストールスクリプト

# bashrc などに環境変数を設定する関数
set_env() {
  COMMENT="# Claude Code (CLIProxyAPI)"
  EXPORT_ANTHROPIC_AUTH_TOKEN="export ANTHROPIC_AUTH_TOKEN="
  EXPORT_CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY="export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1"

  if ! grep -q "$EXPORT_ANTHROPIC_AUTH_TOKEN" "$2"; then
    if grep -q "$COMMENT" "$2"; then
      sed -i "/$COMMENT/a $EXPORT_ANTHROPIC_AUTH_TOKEN$1" "$2"
    else
      echo "
$COMMENT
$EXPORT_ANTHROPIC_AUTH_TOKEN$1
" >> "$2"
    fi
  fi

  if ! grep -q "$EXPORT_CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY" "$2"; then
    sed -i "/$EXPORT_ANTHROPIC_AUTH_TOKEN/a $EXPORT_CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY" "$2"
  fi

  source "$2"
}

# third-party ディレクトリが存在しない場合は作成
if [ ! -d "$HOME/third-party" ]; then
  mkdir -p "$HOME/third-party"
fi

# 既存のものを削除
if [ -d "$HOME/third-party/cliproxyapi" ]; then
  rm -rf "$HOME/third-party/cliproxyapi"
fi

# CLIProxyAPI のインストール
curl -fsSL https://raw.githubusercontent.com/router-for-me/cliproxyapi-installer/refs/heads/master/cliproxyapi-installer | bash

# パスが通っているかを確認
if [ ! -e "$HOME/.local/bin/cli-proxy-api" ]; then
  # パスを通す
  mv "$HOME/cliproxyapi" "$HOME/third-party/cliproxyapi"
  ln -s "$HOME/third-party/cliproxyapi/cli-proxy-api" "$HOME/.local/bin/cli-proxy-api"
fi

# config ファイルの作成
API_KEY=""
if [ ! -e ./cliproxyapi.config.yaml ]; then
  cp ./cliproxyapi.config.example.yaml ./cliproxyapi.config.yaml

  # API キーの作成と永続化 export
  API_KEY="sk-$(openssl rand -base64 24)"
  sed -i "s|replace-with-a-random-local-key|${API_KEY}|g" ./cliproxyapi.config.yaml
else
  # 既存 API キー取得
  API_KEY=$(grep "sk-" cliproxyapi.config.yaml | sed 's/^.*-[[:space:]]*"//; s/"[[:space:]]*$//')
fi

# 環境変数の設定
if [ -e "$HOME/.profile" ]; then
  set_env "$API_KEY" "$HOME/.profile"
elif [ -e "$HOME/.bash_profile"]; then
  set_env "$API_KEY" "$HOME/.bash_profile"
else
  set_env "$API_KEY" "$HOME/.bashrc"
fi