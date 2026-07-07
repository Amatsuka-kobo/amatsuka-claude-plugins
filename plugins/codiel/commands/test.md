---
description: Codiel のテスト仕様(.codiel/specs/)に基づく回帰テストを単独実行する
argument-hint: "[unit-id...](省略時は全 unit)"
---

対象 unit: $ARGUMENTS(空なら全 unit)

codiel プラグインの running-regression-tests スキルを Skill ツールで起動して従ってください。ただし単独実行モードです:

- run 中でなくても実行できます(state 遷移・record-attempt は行いません)
- codiel-tester サブエージェントに「対象 unit のスクリプト実行(必要ならスクリプト安定化)と
  結果レポート作成」をディスパッチしてください
- レポートは `.codiel/reports/test-run-<ISO日時>.md` に保存し、サマリを報告してください
- NG があってもコード修正はディスパッチせず、報告のみ行ってください
- 起動時に raguel-gating スキルの「outcome の自動同期」を実行してください
