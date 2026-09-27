---
description: Issue 番号・確定済み intent 文書のパス・省略のいずれかを起点に、intent の聞き取りから設計・実装・テスト・PR・レビューまでを自律実行する Codiel run を開始・再開する
argument-hint: "[<Issue番号> | <intentパス>](省略時は聞き取りから開始)"
---

引数: $ARGUMENTS

codiel プラグインの orchestrating-runs スキルを Skill ツールで起動し、その手順に厳密に従って
run を開始(未完了の run があれば再開)してください。引数が Issue 番号か intent 文書のパスか
省略かの判定と、それぞれの扱いは orchestrating-runs と capturing-intent の手順に従ってください。
スキルを読まずにフェーズを進めることは禁止です。
