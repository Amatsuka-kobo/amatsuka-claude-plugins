---
description: 対象プロジェクトに Codiel ハーネス(.codiel/ 配下のディレクトリ・.codiel/config.json・.gitignore・.claude/rules/codiel.md・CLAUDE.md の ## Codiel)を初期化・補完する。対話で聞き取るのは保護パスだけで、ARCHITECTURE は生成しない(作成・更新は metatron が行う)。GOTCHAS は生成しない(台帳の生成は metatron が行う)
---

codiel プラグインの initializing-harness スキルを Skill ツールで起動し、その手順に厳密に従って
対象プロジェクト(カレントディレクトリ)の Codiel ハーネスを初期化してください。
スキルを読まずにファイルを配置・生成することは禁止です。
以前の codiel で作った Raguel の YAML 設定が残っていれば、承認を得て config.json の `raguel` へ移します。
