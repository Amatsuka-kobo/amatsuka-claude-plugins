---
description: 対象プロジェクトに Codiel ハーネス(.codiel/ 配下のディレクトリ・raguel.config.yaml・CLAUDE.md の運用ルール節)を初期化・補完する。対話で聞き取るのはドメイン分割と保護パスだけで、ARCHITECTURE が無ければドメインマップだけの最小構成を生成する(技術スタックや規約まで含む ARCHITECTURE が要るときは /metatron:init を先に使う)。GOTCHAS は生成せず、失敗を記録する時点で台帳ごと作られる
---

codiel プラグインの initializing-harness スキルを Skill ツールで起動し、その手順に厳密に従って
対象プロジェクト(カレントディレクトリ)の Codiel ハーネスを初期化してください。
スキルを読まずにファイルを配置・生成することは禁止です。
