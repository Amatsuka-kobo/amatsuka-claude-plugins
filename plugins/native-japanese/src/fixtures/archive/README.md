# archive のテスト用データ

- `pkg.tgz`: `package/a.node`(312 バイト)と `package/package.json`(160 バイト)を置いたディレクトリで `tar czf pkg.tgz -C <dir> package` を実行して作った。
- `dict.zip`: Python の `zipfile.ZipFile.writestr` で作った。`lindera-ipadic/` の下に deflate の `NOTICE.txt` と `extra.bin`、stored の `metadata.json`、入れ子の `sub/NOTICE.txt` を置き、`lindera-ipadic/../evil.txt` と `/abs/NOTICE.txt` を加えた。
- `ipadic.zip`: Python の `zipfile.ZipFile.writestr` で、実物の IPADIC の zip と同じ 10 個の名前を `lindera-ipadic/` の下に deflate で置いた。中身は `<名前> stub\n` の 4 回の繰り返しで、`morph-runtime.test.ts` の取得のテストが使う。
- 各ファイルの中身は `archive.test.ts` の期待値と一致させている。作り直したらテストの期待値も合わせる。
