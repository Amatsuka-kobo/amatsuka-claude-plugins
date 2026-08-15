#!/bin/bash
# mdbase-lsp のインストール / 更新スクリプト
#
# 初回は各リポジトリを clone し、2 回目以降は pull して再ビルドする。
# mdbase-lsp は Cargo.toml で mdbase-rs を path 依存 (../mdbase-rs) として
# 参照するため、両リポジトリを同じ親ディレクトリに並べて配置する必要がある。
#
# 依存はバージョン完全一致 (=X.Y.Z) で固定されているため、両リポジトリの
# main を単純に追うと上流の更新タイミングによっては噛み合わない。
# そのため mdbase-lsp が要求する版を読み取り、mdbase-rs 側をその版に合わせる。

set -euo pipefail

THIRD_PARTY_DIR="$HOME/third-party"
BIN_DIR="$HOME/.local/bin"
LSP_DIR="$THIRD_PARTY_DIR/mdbase-lsp"
RS_DIR="$THIRD_PARTY_DIR/mdbase-rs"

LSP_URL="https://github.com/callumalpass/mdbase-lsp.git"
RS_URL="https://github.com/callumalpass/mdbase-rs.git"

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
  if dpkg-query -s "$pkg" >/dev/null 2>&1; then
    echo "[OK] $pkg is installed."
  else
    echo "[NG] $pkg is NOT installed."
    missing_packages+=("$pkg")
  fi
done

# 未インストールのパッケージが存在する場合の処理
if [ ${#missing_packages[@]} -gt 0 ]; then
  sudo apt update && sudo apt upgrade -y
  echo "Installing missing packages: ${missing_packages[*]}"
  sudo apt install -y "${missing_packages[@]}"
fi

# 必要なディレクトリを作成
mkdir -p "$BIN_DIR" "$THIRD_PARTY_DIR"

# rust のインストール
rustup default stable

# リポジトリを取得し、デフォルトブランチの最新へ更新する
sync_repo() {
  local dir="$1" url="$2" name
  name="$(basename "$dir")"

  if [ ! -d "$dir/.git" ]; then
    echo "==> Cloning $name"
    git clone "$url" "$dir"
    return
  fi

  echo "==> Updating $name"

  # ローカル変更があると pull が失敗するため、事前に検知して中断する
  if [ -n "$(git -C "$dir" status --porcelain)" ]; then
    echo "[ERROR] $name has local changes. Commit or stash them, then re-run." >&2
    exit 1
  fi

  local branch
  branch="$(git -C "$dir" symbolic-ref --quiet --short HEAD || true)"
  if [ -z "$branch" ]; then
    # detached HEAD (前回の版合わせなど) はデフォルトブランチへ戻す
    branch="$(git -C "$dir" remote show origin | sed -n 's/.*HEAD branch: //p')"
    echo "    detached HEAD detected; checking out $branch"
    git -C "$dir" checkout "$branch"
  fi

  git -C "$dir" pull --ff-only origin "$branch"
}

# mdbase-lsp が要求する mdbase のバージョンを取り出す
# 例: mdbase = { path = "../mdbase-rs", version = "=0.4.0-rc.2" } -> 0.4.0-rc.2
required_mdbase_version() {
  sed -n 's/^mdbase[[:space:]]*=.*version[[:space:]]*=[[:space:]]*"=\([^"]*\)".*/\1/p' \
    "$LSP_DIR/Cargo.toml" | head -1
}

# mdbase-rs 側を、要求されたバージョンを宣言している commit に合わせる
align_mdbase_rs() {
  local want="$1" current commit

  if [ -z "$want" ]; then
    echo "    no pinned version found in mdbase-lsp; using mdbase-rs as-is"
    return
  fi

  current="$(sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$RS_DIR/Cargo.toml" | head -1)"
  if [ "$current" = "$want" ]; then
    echo "    mdbase-rs $current matches the required version"
    return
  fi

  echo "    mdbase-lsp requires mdbase $want but mdbase-rs is $current; searching history"

  # Cargo.toml の version 行の変更履歴から、目的の版を導入した commit を探す
  commit="$(
    git -C "$RS_DIR" log --format='%H' -L '/^version/,+1:Cargo.toml' 2>/dev/null |
      while read -r sha; do
        # -L 出力は commit ハッシュと diff が混在するため、ハッシュ行だけを見る
        case "$sha" in
          [0-9a-f]*) ;;
          *) continue ;;
        esac
        if [ "$(git -C "$RS_DIR" show "$sha:Cargo.toml" 2>/dev/null |
                sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)" = "$want" ]; then
          echo "$sha"
          break
        fi
      done
  )"

  if [ -z "$commit" ]; then
    echo "[ERROR] could not find a mdbase-rs commit declaring version $want." >&2
    echo "        The upstream repositories may be temporarily out of sync." >&2
    echo "        Check https://github.com/callumalpass/mdbase-rs for a matching release." >&2
    exit 1
  fi

  echo "    checking out mdbase-rs at ${commit:0:7} (version $want)"
  git -C "$RS_DIR" checkout --quiet "$commit"
}

# mdbase-lsp を先に更新する (要求バージョンの読み取り元になるため)
sync_repo "$LSP_DIR" "$LSP_URL"
sync_repo "$RS_DIR" "$RS_URL"

# mdbase-rs を mdbase-lsp の要求に合わせる
echo "==> Aligning mdbase-rs with mdbase-lsp"
align_mdbase_rs "$(required_mdbase_version)"

# mdbase-lsp をビルド
echo "==> Building mdbase-lsp"
cargo build --release --manifest-path "$LSP_DIR/Cargo.toml"

# ビルド成果物へのシンボリックリンクを張り直す
ln -sf "$LSP_DIR/target/release/mdbase-lsp" "$BIN_DIR/mdbase-lsp"

echo "==> Done"
echo "    mdbase-lsp $(sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$LSP_DIR/Cargo.toml" | head -1)"
echo "    mdbase     $(sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$RS_DIR/Cargo.toml" | head -1)"
echo "    installed at $BIN_DIR/mdbase-lsp"
