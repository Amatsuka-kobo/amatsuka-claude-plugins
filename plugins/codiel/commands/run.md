---
description: GitHub Issue を起点に設計→実装→テスト→PR→レビューまで自律実行する Codiel run を開始・再開する
argument-hint: <issue番号>
---

Issue 番号: $ARGUMENTS

codiel プラグインの orchestrating-runs スキルを Skill ツールで起動し、その手順に厳密に従って
Issue #$ARGUMENTS の run を開始(未完了 try があれば再開)してください。
スキルを読まずにフェーズを進めることは禁止です。
