# 環境構築

ここでプラグイン開発を行う際の環境構築手順です。

## LSP

Claude Code で効率よく開発を行うため、以下の LSP プラグインを有効化しています。

- pyright (Python)
- vtsls (TypeScript/JavaScript)
- bash-language-server (ShellScript)
- mdbase-lsp (Markdown)

これらを使用するには、各言語を扱う言語サーバーをインストールする必要があります。

## pyright (Python)

Python 用の言語サーバーインストール手順です。

```bash
npm install -g pyright
```

## vtsls (TypeScript/JavaScript)

TypeScript/JavaScript 用の言語サーバーインストール手順です。

```bash
npm install -g @vtsls/language-server
```

## bash-language-server (ShellScript)

ShellScript 用の言語サーバーインストール手順です。

```bash
npm install -g bash-language-server
```

## mdbase-lsp (Markdown)

Markdown 用の言語サーバーインストール手順です。
GitHub から外部リポジトリを clone し、ビルドして、パスを通す必要があります。
ビルドには Rust の実行環境と C 言語のコンパイラが必要です。
前提環境をインストールし、mdbase-lspのインストールまで行うスクリプトを実行してください。

```bash
scripts/install-mdbase.sh
```
