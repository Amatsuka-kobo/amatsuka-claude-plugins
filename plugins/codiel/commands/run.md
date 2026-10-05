---
description: Issue 番号・確定済み intent 文書のパス・省略のいずれかを起点に、intent の聞き取りから設計・実装・テスト・PR・レビューまでを自律実行する Codiel run を開始・再開する
argument-hint: "[<Issue番号> | <intentパス>](省略時は聞き取りから開始)"
---

引数: $ARGUMENTS

codiel プラグインの orchestrating-runs スキルを Skill ツールで起動して読み、その内容に従って
run を開始(未完了の run があれば再開)してください。
