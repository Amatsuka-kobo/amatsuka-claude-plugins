#!/bin/bash
# mdbase-lsp のインストールスクリプト

# インストール済みか確認
if [ -e "$HOME/.local/bin/mdbase-lsp" ]; then
  echo "mdbase-lsp is already installed."
else
  # インストール処理

  # 必要パッケージ
  packages=(
    "git"
    "build-essential"
    "rustup"
  )

  missing_packages=()

  # 必要パッケージの存在確認
  for pkg in "${packages[@]}"; do
    # dpkg-query でパッケージの状態を確認
    dpkg-query -s "$pkg" >/dev/null 2>&1

    # 戻り値が 0 (正常終了) の場合はインストール済み
    if [ $? -eq 0 ]; then
      echo "[OK] $pkg is installed."
    else
      echo "[NG] $pkg is NOT installed."
      missing_packages+=("$pkg")
    fi
  done

  # 未インストールのパッケージが存在する場合の処理
  if [ ${#missing_packages[@]} -gt 0 ]; then
    sudo apt upgrade && sudo apt update
    echo "Installing missing packages: ${missing_packages[@]}"
    sudo apt install -y "${missing_packages[@]}"
  fi

  # .local/bin ディレクトリが存在しない場合は作成
  if [ ! -d "$HOME/.local/bin" ]; then
    mkdir -p "$HOME/.local/bin"
  fi

  # third-party ディレクトリが存在しない場合は作成
  if [ ! -d "$HOME/third-party" ]; then
    mkdir -p "$HOME/third-party"
  fi

  # rust のインストール
  rustup default stable

  # mdbase-lsp をインストール
  cd "$HOME/third-party"
  git clone https://github.com/callumalpass/mdbase-lsp.git
  git clone https://github.com/callumalpass/mdbase-rs.git
  cd mdbase-lsp
  cargo build --release
fi