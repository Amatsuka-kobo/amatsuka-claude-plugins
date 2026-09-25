# 固定データの採取手順

固定データは Playwright 1.63.0 と Chromium で一度だけ採取する。一時スクリプトから Playwright を読み込み、各 `.html` を `page.setContent` に渡してから `page.ariaSnapshotJSON()` の戻り値を `JSON.stringify(value, null, 2)` で同名の `.json` に保存する。JSON は手で編集しない。

通常モードでは `aria-hidden` 要素は戻り値に含まれず、`ariaHidden` フィールドは AI モードでのみ現れる。Chromium の起動に OS 共有ライブラリが必要な場合は、その依存関係を環境で利用可能にするか、採取コマンドの実行時だけ `LD_LIBRARY_PATH` を設定する。
