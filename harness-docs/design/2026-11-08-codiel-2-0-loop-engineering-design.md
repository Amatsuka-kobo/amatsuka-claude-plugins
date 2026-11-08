# codiel 2.0 設計書: Epic ごとのセッションを自動で起動して回す Loop Engineering モードと、Jev が ASK を裁定する Auto Ask モード

- 日付: 2026-11-08
- 対象: plugins/codiel(raguel-mcp を含む)
- バージョン: 1.2.0 → 2.0.0(メジャー。ユーザーが確認済み)。実装中は 2.0.0-dev とする。1.2 が未リリースなら 1.2.0-dev から上げる。予定表の表記は「Cosiel 2.0」で、Codiel 2.0 と確かめた
- 前提: 1.1 の設計書(`harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`)、1.2 の設計書(`harness-docs/design/2026-11-08-codiel-1-2-workflow-modes-design.md`)、両プラグインとの食い違い(`harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`)。ADR-005・ADR-011・ADR-012・ADR-014

## 0. 決まったこと

ユーザーと次を決めた。再検討しない。

| 番号 | 対象 | 決定 |
| --- | --- | --- |
| D1 | Loop | ユーザーの実現したいこと(Epic)を起点にユーザーストーリーマッピングを行い、ストーリーごとに Workflow Intents を起票する。各 intent と Issue の状態を管理し、必要なら新しいストーリーやタスクを起票しながら、全ストーリーを完結させる |
| D2 | Loop | 既定で止まる場面は 7 つとする。新しい画面名が決まるとき、金銭が絡む実装や判断、法的判断、取り消せない操作、セキュリティと個人情報、ユーザーの意図を変える判断、新しい外部依存の追加。この 7 つは Auto Ask が有効でも人に回す |
| D3 | Loop | ユーザーは起動時と Loop の途中で次を行える。その Loop だけの止まる条件を足す。個別のストーリーやタスクに状態を付け、Loop にその項目を飛ばさせるか、そこで止まらせる。別の Epic を足す。対応中の Epic にストーリーを足す |
| D4 | Loop | Epic の範囲外のストーリーが必要だと AI が判断したときは、自分では足さず、別 Epic として起票するかをユーザーに仰ぐ |
| D5 | Loop | Loop のセッションを経ずに人が直接加えた変化も取り込む。対象は、ストーリーの追加、対応中のストーリーへのタスクの追加、優先度の変更、非対応の指定である。これらへの対応では止まらない |
| D6 | Loop | ストーリーの親 PR はベースブランチへ出し、人がマージする |
| D7 | Loop | 各ストーリーの intent の承認と discuss は、起動時のストーリーマッピングの合意で代える。discuss の論点は ASK として扱い、Auto Ask が有効なら Jev が選び、無効ならそこで止まってユーザーに聞く |
| D8 | Loop | 1 つのセッションで扱う Epic は 1 つとし、Epic 全体を 1 つの run にする。ストーリーとサブ intent は run 内の state として管理し、個別の run にはしない |
| D9 | Loop | Epic のセッションは Workflow を起動し、ストーリーを入れ子にして、1.2 の Workflow を子として呼ぶ |
| D10 | Loop | 別の Epic は別のセッションで扱う。そのセッションは人の手ではなく自動で起動する |
| D11 | Loop | Epic のセッションが人に聞く内容は、全体を見るセッションに集める。全体を見るセッションがユーザーに聞き、答えを返す |
| D12 | Loop | Epic のセッションは、許可モード `auto` で起動する。設定では変えない |
| D13 | Auto Ask | Jev を必須とするモードとする。ASK になったら、ユーザーへの確認の代わりに Jev の判断で run を続ける。問いは LLM の主観が入らず、中立な立場で判断できる形にする |
| D14 | Auto Ask | 通常の run・Dynamic Workflow・Loop のどれでも、起動時の指定(例: `--auto-ask`)で有効にできる |
| D15 | Auto Ask | Jev の答えの自信度が低いときは、その ASK を人に回す。しきい値は設定で変えられる |
| D16 | STOP | STOP では、ユーザーが判断できる選択肢を生成して判断を仰ぐ。Jev が有効なら、どれが推奨かを Jev に判断させる。問いは Auto Ask と同じく、LLM の主観が入らない形にする |
| D17 | Loop | Epic Issue にはラベル `epic` を、1.1 の `codiel` と併記する。ストーリー Issue とサブ Issue は、1.2 の `story`・`subtask` を併記する |

D2 のうち、新しい画面名・金銭・法的判断の 3 つはユーザーが挙げ、残りの 4 つは執筆者の提案をユーザーが選んだ。

## 1. 前提: バックグラウンドセッションと Workflow の性質

### 1.1 2026-11-08 の試験で確かめたこと

このリポジトリの対話セッションから、Claude Code 2.1.319 の `claude --bg` で試験用のセッションを 3 回起動して確かめた(試験の成果物は片付け済み)。

| 確かめたこと | 結果 |
| --- | --- |
| セッションの Bash から別のセッションを起動できるか | `claude --bg --name <名前> --permission-mode <モード> "<プロンプト>"` で起動できた。`claude agents --json` に `kind: background` で載る |
| 許可モードの影響 | `acceptEdits` では許可の確認で止まった(`claude agents --json` の `waitingFor: "permission prompt"`)。`auto` では一度も確認が出なかった(codiel の run が無い状態での試験) |
| 使えるツール | Workflow・Agent・Skill・AskUserQuestion・ListAgents・EnterWorktree をそのまま呼べた。SendMessage は ToolSearch で読み込んで使えた |
| メインのチェックアウトで起動したときの書き込み | Claude Code が即座に拒否した(「This background session hasn't isolated its changes yet. Call EnterWorktree first …」) |
| `git worktree add` で作った worktree の中で起動したとき | 拒否は 1 件も無かった。自分の worktree への書き込み、別の worktree の作成と書き込みとコミット、`git -C <メイン>` の読み取り、メインのチェックアウトの git に載らない場所への書き込み(Write と node のスクリプト)、メインを作業ディレクトリにした読み取りが、すべて通った |
| Bash の `cd` | 次の呼び出しに持ち越されなかった(「Shell cwd was reset to …」) |
| Workflow | 許可の確認なしで起動し、完了の通知を受けて結果を得た |
| セッション間のやり取り | SendMessage で、起動元のセッションへ結果を送れた。起動元が登録した「手すきになったら知らせる」通知(`notify_when_idle`)も届いた |
| 対話セッション自身の一覧 | `claude agents --json` は、対話セッション自身も `kind: interactive` と名前つきで返した |

### 1.2 公式ドキュメントで確かめたこと

| 性質 | 内容 | 出典 |
| --- | --- | --- |
| hook の `ask` | auto モードでも、PreToolUse の hook が返す `ask` は許可の確認に送られ、自動判定は裁かない。理由の文が Claude に見えるのは `deny` のときである | code.claude.com/docs/en/hooks.md の「PreToolUse ask decisions in auto mode」 |
| 手すきのセッションへのメッセージ | 受け手が手すきなら、そのメッセージで新しいターンを始める | cross-session-messaging.md |
| メッセージの保留 | 受け手の許可モードと、送り手が名乗る区分によって、メッセージが保留されることがある。送り手が bypass を名乗るときに保留が起きる | cross-session-messaging.md の「Control inbound messages」 |
| 一覧の既定 | `claude agents --json` の既定の出力は、動いているセッションと、作業中か止まっているバックグラウンドのセッションだけである。終わったものは `--all` で出る | agent-view.md |
| エージェントチーム | 実験的な機能で既定は無効。`/resume` でメンバーが戻らない。メンバーごとの worktree の記述が無い | agent-teams.md |

エージェントチームは、上の理由で使わない。Workflow とサブエージェントの性質は、1.2 の 1.1 のとおりである(Workflow のエージェントはユーザーと話せない、サブエージェントは Workflow を使えない)。

## 2. 全体の構成: 全体のセッションと Epic のセッション

```
全体のセッション(ユーザーが話す対話セッション。run を持たない)
  ├─ Epic の聞き取りとストーリーマッピング(ユーザーと対話)
  ├─ Epic の worktree の用意と、Epic のセッションの起動(claude --bg --permission-mode auto)
  ├─ Epic のセッションが手すきになった知らせを受け、未回答の問いを集めてユーザーに聞き、答えを返す
  └─ ユーザーの指示(保留・非対応など)を Epic のセッションへ伝える

Epic のセッション(バックグラウンド。Epic ごとに 1 つ。Epic の run を 1 つ持つ)
  ├─ .codiel/epics/<Epic>/ の worktree(Epic のブランチ)を作業ディレクトリにして動く
  ├─ ストーリーごとに Workflow を起動し、並列に進める
  │    └─ ストーリーの Workflow は、1.2 の Workflow を子として呼ぶ
  ├─ チェックポイントで、人が加えた変化とストーリーのマージを取り込む
  └─ 人に聞く内容を state に記録し、手すきになって待つ
```

- 全体のセッションは、ユーザーが `/codiel:loop`(新設のコマンド)で始める。
- 全体のセッションでは run を作らない。

## 3. 全体のセッション

### 3.1 始める前の確かめ

- 全体のセッションの許可モードが `bypassPermissions` なら、始めずに理由を報告する。Epic のセッションへ送る答えが保留されるためである(1.2 の表)。
- メインのチェックアウトに active な run があれば、始めずに理由を報告する。stop-guard と各 hook は、`cwd` が属する作業ツリーの run を見る(4.1)ので、全体のセッションにその run のガードが当たるためである。
- 全体のセッションは、Epic の worktree へ `cd` しない。パスを指定して読む。

### 3.2 Epic の聞き取りとストーリーマッピングはユーザーと行う

- Epic の聞き取りでは、ユーザーの言葉を原文のまま記録する。intent の ASIS / TOBE と同じ扱いにする。
- AI がストーリーマップの案を示し、ユーザーと詰める。マップには次を含める。
  - ユーザーの活動の並び(バックボーン)と、活動ごとのストーリー
  - ストーリーごとの文(「〜として、〜したい。なぜなら〜」の形)、受け入れ基準、依存、優先度
  - その Loop だけの止まる条件(D3)
- ユーザーがマップを承認したら、その範囲のストーリーは intent の承認と discuss のユーザーとの対話を省く(D7)。
- マップの承認を、その Epic の中の起票・ラベルの付与・Epic の範囲内のストーリーとタスクの追加の承認として扱う。`references/intent-common.md:15` の「外部から見える操作は、ユーザーの明示承認を得るまで行わない」を、Loop ではこの形で満たすと改める。
- github モードでは、承認の後に Epic Issue とストーリー Issue を起票し、Sub-issues でつなぐ。つなぐ手順は 1.2 の 2.5 と同じにする。
- ラベルは、Epic Issue に `codiel` と `epic`、ストーリー Issue に `codiel` と `story`、サブ Issue に `codiel` と `subtask` を付ける(D17)。`epic` のラベルが無ければ、`codiel:init` か起票の前に作るかを聞く(1.2 の 2.5 と同じ扱い)。
- 人が作った既存の Epic Issue から始めるときは、その番号を `/codiel:loop <Epic Issue の番号>` で渡す(github モードだけ)。
  - Epic Issue に `codiel` と `epic` が無ければ、聞かずに足す。
  - 配下のサブ Issue をストーリーの案として取り込み、ストーリーマッピングの材料にする。既定はすべてを取り込み、ユーザーが外すものを選べる。
  - 取り込むものに `codiel` と `story` が無ければ、マップの承認後に足す。外したものにはラベルを付けない。

### 3.3 Epic の worktree を作ってから Epic のセッションを起動する

1. 全体のセッションが、Epic のブランチ `codiel/epic-<Epic の slug>` と worktree `.codiel/epics/<Epic の slug>` を、ベースブランチから作る。`.codiel/epics/` は、初めて作るときに `.git/info/exclude` に足す(現行の `.codiel/worktrees/` と同じ扱い)。
2. その worktree に Epic 文書 `docs/intents/epics/<Epic の slug>.md` を書いてコミットする。
3. その worktree を作業ディレクトリにして、Epic のセッションを起動する。

```
( cd <Epic の worktree> && CODIEL_LOOP_SESSION=1 claude --bg --name codiel-epic-<Epic の slug> --permission-mode auto "/codiel:run --loop <Epic 文書のパス>" )
```

- Epic の worktree は `.codiel/worktrees/<a>/<b>` の形の外に置く。hook がストーリーやサブの worktree と取り違えないためである(現行の `WORKTREE_REL_RE`。`guard-write.ts:47`)。メインのチェックアウトへの解決は 4.1 のとおり `findMainRoot` を広げて行う。
- Epic のセッションがストーリーやサブの worktree を作るときは、メインのチェックアウトを基準にした絶対パス(`<メイン>/.codiel/worktrees/<Epic>/<ストーリー>` など)を使う。Epic のセッションの `cwd` は Epic の worktree なので、相対パスを指定すると、Epic の worktree の中に入れ子で作られてしまう。試験では、Epic の worktree の中で起動したセッションが、メインの下の `.codiel/worktrees/` に worktree を作って書き込めた(1.1)。
- `--auto-ask` は `/codiel:loop --auto-ask` で受け、起動の引数で Epic のセッションへ渡す。
- 許可モードは `auto` に固定する(D12)。

### 3.4 Epic のセッションが手すきになったら、未回答の問いを集めて聞く

- 全体のセッションは、各 Epic のセッションに `notify_when_idle` の知らせを登録する。知らせは 1 回きりなので、受けるたびに登録し直す。
- 知らせを受けたら、その Epic の run の state にある未回答の問い(4.6)を読み、AskUserQuestion でユーザーに聞く。
- 答えは SendMessage で `codiel-epic-<Epic の slug>` へ送る。手すきのセッションは、メッセージを受けて新しいターンを始める(1.2 の表)。
- Epic のセッションの一覧は、`.codiel/runs/` の `mode: loop` の run を正とする。セッションの ID は `claude agents --json --all` の名前から引く。
- 全体のセッションを始め直したときは、一覧の全 Epic の未回答の問いを集めて聞き、知らせを登録し直す。
- Epic のセッションが手すきなのに、run が active で、待ちも未回答の問いも無いときは、`claude --resume <ID> --bg` で再開させる。
- Epic のセッションが許可の確認で止まっている(`claude agents --json` の `waitingFor`)ときは、その旨をユーザーに知らせる。4.8 で hook の `ask` を無くすので、起きない想定である。

### 3.5 ユーザーの指示を Epic のセッションへ伝える

- ユーザーが全体のセッションで、保留・非対応・優先度の変更・ストーリーの追加・止まる条件の追加を指示したら、全体のセッションは SendMessage で Epic のセッションへ伝える。
- Epic のセッションは、受けた指示を次のチェックポイントで Epic 文書に反映する(4.5)。
- 全体のセッションは Epic 文書を直接書き換えない。Epic のセッションの書き換えとぶつかるためである。

### 3.6 別の Epic を足す

- ユーザーが全体のセッションで新しい Epic を始めると、3.2 と 3.3 の手順で、もう 1 つの Epic のセッションが起動する。
- Epic のセッション同士は、別々の worktree とブランチで動くので、git の操作はぶつからない。
- 2 つの Epic が同じファイルを変えたときの衝突は、ストーリーの親 PR をマージする時点で起き、マージする人が解消する。

## 4. Epic のセッション

### 4.1 run を作業ツリーに結びつけ、作業ツリーごとに active な run を 1 つにする

- `codiel-state` のルートは、1.1 のとおり全コマンドで `findMainRoot` で解決する。`.codiel/runs/` はメインのチェックアウトにだけ置く。
- ただし現行の `findMainRoot`(`src/hooks/lib.ts:641,654-659`)は、パスが `/.codiel/worktrees/` を含むときだけ、その手前をメインとして返す。含まなければ `findProjectRoot`(`:630-638`)に回り、`.codiel/` がある最も近い祖先で止まる。`.codiel/config.json` は git で共有されるので、Epic の worktree の checkout にも `.codiel/` があり、探索は Epic の worktree 自身で止まる。そこで次を改める。
  - `findMainRoot` の正規表現を、`/.codiel/worktrees/` に加えて `/.codiel/epics/` も含むときに、その手前を返す形にする。
  - Raguel の `resolveProjectRoot`(`raguel-mcp/src/project/root.ts:14,27-38`。同じ規則の独立の実装)も同じコミットで追随させ、2 つの実装の結果を比べるテストを置く。
  - guard-write は、`.codiel/epics/<slug>/` の下への書き込みを、Epic の worktree のルートを基準に判定する。`WORKTREE_REL_RE` とは別の正規表現を足し、Epic の worktree の中の相対パスを取り直す。現行の worktree の扱い(`guard-write.ts:47,320`)と同じく、`.codiel/` の免除(`:362,452,509`)で素通りさせない。一方、メインの `.codiel/runs/<Epic>/try-<n>/` の下(`questions/`・`waits/`)への書き込みは、従来どおり `:509` の免除で通す。
- 文脈が圧縮された後に読み直す手順(`skills/orchestrating-runs/SKILL.md:232-234`)では、要約に slug が無いときに `get --active` を呼び、2 件以上なら人に確かめている。Loop では Epic が複数動くので、`get --active` に作業ツリーで絞る引数を足し、Epic のセッションは自分の `cwd` の作業ツリーに結びついた run を読む。人には確かめない。
- 別の Epic は別のセッションで同時に動くので、「リポジトリ全体で active な run は 1 つ」の制限(`src/codiel-state.ts:892-903`)を、「作業ツリーごとに active な run は 1 つ」に改める。
  - state に、run を始めた作業ツリーのルートのパス(`worktreeRoot`)を記録する。
  - `init` は、同じ作業ツリーに active な run があるときだけ断る。
- hook は、次の順で判定に使う state を選ぶ。
  1. 書き込み先のパスか、コマンドの作業ディレクトリの候補(`cd` の行き先・サブシェルの `cd`・`git -C`)を見る。それが、ある run の進みの表に記録した worktree の下なら、そのストーリーかサブの state を使う。
  2. それ以外は、hook の入力の `cwd` から作業ツリーのルートを求め、`worktreeRoot` がそのルートと一致する run を使う。Epic のセッションでは、Epic の worktree が `worktreeRoot` である。
  3. どれにも当たらなければ、run は無いものとして扱う。
- 作業ツリーの照合は実体パスで行う。`init` は `worktreeRoot` を実体パスで記録し、hook も `cwd` を `realpathOrAncestor` で実体にしてから照合する(guard-write の worktree の照合と同じ。`guard-write.ts:312-321`)。symlink を含む作業ディレクトリで照合が外れ、run が無いものとして扱われるのを防ぐ。
- `CODIEL_LOOP_SESSION=1` か、`cwd` が `.codiel/epics/` の下なのに 3 に落ちたときは、run が無いものとして通さず、4.8 と同じく `deny` と理由にする。
- Raguel の設定と記録の保護(`guard-write.ts:294-305` の `raguelTarget`、`guard-bash.ts:1204-1210` の `writesRaguelFiles`)だけは、作業ツリーによらず、リポジトリの中に active か awaiting_human の run が 1 つでもあれば当てる。保護する 2 つ(`.codiel/config.json` と `~/.raguel/cases/<projectId>`)は、作業ツリーをまたいで共有される。全体のセッションには run が無いが、そこからの書き換えも止める必要がある。
- stop-guard も、入力の `cwd` が属する作業ツリーの run だけを見る。メインセッションでは `cwd` が `cd` に追随するので、Epic のセッションは自分の worktree の外へ単独の `cd` をしない(サブシェルか `git -C` を使う)。
- 1.2 までの run は、`worktreeRoot` がメインのチェックアウトである run として、そのまま動く。`worktreeRoot` の無い state は、メインのチェックアウトの run と見なす。

### 4.2 Epic の run の形

- Epic の run は、`init --epic <Epic 文書のパス> --slug <Epic の slug>` で作る。intent の無い run とする。
  - `mode` は `loop`、`branch` は `codiel/epic-<Epic の slug>`、`worktreeRoot` は Epic の worktree とする。
  - Epic 文書のパスは `docs/intents/epics/<slug>.md` で、現行の `--intent` の形の検査(`codiel-state.ts:862-866`)は当てない。
  - 現行の `init` は、try-1 で `codiel/<slug>` のブランチが既にあれば失敗する(`codiel-state.ts:953-956`)。Epic のブランチは全体のセッションが先に作る(3.3)ので、`--epic` のときはこの検査を反転させ、`codiel/epic-<slug>` が存在することを求める。
- Epic の run は、ステージ表に足す新しいゲート無しのフェーズ `loop` だけを使い、ほかのフェーズは `SKIPPED` で作る。
  - `loop` は discuss と `workflow` の間に足す。`loop` の `stage` は 3、`workflow` は 4 となり、design 以降はさらに 1 ずつ大きくなる。Raguel の表(`raguel-mcp/src/codiel/phases.ts`)と 2 者比較のテストを同じコミットで追随させる。Raguel の表にはゲート付きのフェーズの行だけがあるので、`loop` の行は足さず、後ろの `stage` だけを直す。
  - 標準の run と Workflow モードの親 run では、`loop` を `SKIPPED` で作る。`readState` は、欠けた `loop` のキーを `SKIPPED` で補う。
- Epic の run は PR を作らない。全ストーリーが終わったら(4.9)、`complete-phase loop` の後に `close --reason loop-complete` で `completed` にする。`awaiting_outcome` は経ない。
  - 現行の `close` は、`branch` が null、intent が passed、それ以外のフェーズが pending であることを求める(`codiel-state.ts:1439-1452`)。`mode: loop` の run では、これらの代わりに `loop` が passed であることを求める分岐を足す。
- Epic の state には、ストーリーごとの進みの表、問いの一覧(4.6)、チェックポイントの写し(4.5)を置く。

### 4.3 ストーリーとサブ intent は Epic の run の中の state として持つ

| 単位 | state の置き場 | Raguel の run ID |
| --- | --- | --- |
| Epic | `.codiel/runs/<Epic>/try-<n>/state.json` | 無し(Epic 自体はゲートを通らない) |
| ストーリー | `.../stories/<ストーリー>/state.json` | `<Epic>-try-<n>-t<j>`。やり直すと `-r<m>` を付ける |
| サブ intent | `.../stories/<ストーリー>/subs/<サブ>/state.json` | `<Epic>-try-<n>-t<j>-s<k>`。やり直すと `-r<m>` を付ける |

- `j` と `k` は登録順の番号である。slug は 40 文字までなので、run ID は 64 文字の上限に収まる。
- ストーリーの state のフェーズ構成は、1.2 の Workflow モードの親 run と同じにする。サブの state は 1.2 のサブの state と同じである。
- `codiel-state` に `--story <ストーリーの slug>` を足し、1.2 の `--sub` と組み合わせて使う。基準は次のとおりとする。

| 基準 | `--story` | `--story --sub` |
| --- | --- | --- |
| state の置き場 | メインのチェックアウト | メインのチェックアウト |
| HEAD の照合と差分 | ストーリーの worktree | サブの worktree |
| pass-gate の検査 9 の文書の置き場 | `<runsDir>/<Epic>/<ストーリー>/` | `<runsDir>/<Epic>/<ストーリー>/<サブ>/` |
| 連続性の検査で `workflow` の開始に許すコミット | `<runsDir>/<Epic>/<ストーリー>/agenda.md`・`discussion.md` | — |

- worktree とブランチ:
  - ストーリー: worktree `.codiel/worktrees/<Epic>/<ストーリー>`、ブランチ `codiel/<ストーリー>`(ベースブランチから。D6)
  - サブ: worktree `.codiel/worktrees/<Epic>/<ストーリー>--<サブ>`、ブランチ `codiel/<ストーリー>--<サブ>`
  - ストーリーの slug は、既存の `codiel/<slug>` のブランチと重ならないものにする。作るときに確かめる。
- Epic の state の進みの表には、ストーリーごとの番号・slug・worktree・ブランチ・run ID・PR の URL・進みを記録する。進みは、未着手 / 実行中 / マージ待ち / マージ済み / 人の判断待ち / 保留 / 非対応 / 中止 のどれかとする。サブの進みはストーリーの state の表に置く(1.2 の 3.2)。
- 書き手は、表ごとに 1 体に限る。
  - Epic の state(ストーリーの進みの表・問いの一覧・チェックポイントの写し)を書くのは、Epic のセッションだけである。
  - ストーリーの state とサブの進みの表を書くのは、そのストーリーの Workflow が動いている間は、Workflow の中のストーリーの担当エージェントだけである。1.2 で「Workflow の外のオーケストレーター」が書く表を、Loop ではストーリーの担当エージェントが書く。
  - ストーリーの Workflow が動いている間、Epic のセッションはそのストーリーとサブの state を書かない。動いていない間だけ、`resume` などで書く。
  - 問いの記録(4.6)は、ストーリーの担当エージェントも Epic のセッションも行う。問いはファイルを 1 件ずつ足し、Epic の state の問いの一覧への登録は、Epic のセッションが Workflow の戻りの後にまとめて行う。
- hook と guard-github-mcp は、進みの表に記録した worktree のパスとブランチ名から、ストーリーとサブの state を引く。
- ストーリーのやり直しは、新設の `codiel-state story-reset --story <slug> --from <フェーズ>` で行う。1.2 の `sub-reset` と同じ形で、前の state を `archive/` に残し、run ID に `-r<m>` を付ける。

### 4.4 ストーリーごとに Workflow を起動し、並列に進める

Epic のセッションは、次のサイクルを、全ストーリーが終わるまで繰り返す。

1. チェックポイント(4.5)。
2. 着手できるストーリーを集める。条件は次のすべてである。
   - 依存先のストーリーが、ベースブランチにマージ済みである。
   - 進みが、未着手か実行中(人の判断を受けて再開できる状態)である。保留・非対応・中止・人の判断待ち・マージ待ちは除く。
3. 着手できるストーリーごとに、ストーリーの Workflow(`workflows/story.js`)を起動する。同時に動かすストーリーの数は、`.codiel/config.json` の新しいキー(例: `loop.maxParallelStories`、既定 2)で抑える。Workflow ごとに同時 16 エージェントまで動くので、合計の負荷を抑えるためである。
4. 起動した Workflow ごとに `wait-add --kind workflow` で待ちを記録し、ターンを終える。どれかの Workflow が戻ったら、手順 1 から続ける。
5. 着手できるストーリーも動いている Workflow も無いときは、4.7 のとおり待つ。

ストーリーの Workflow のスクリプトは、1 つのストーリーを次の順で進める。

| 工程 | 内容 |
| --- | --- |
| intent の起票 | ストーリーの担当エージェントが、分解の聞き取りを行わない Workflow Intents で、ストーリーの親 intent とサブ intent を作る。入力はストーリーマップと Epic の原文である。サブの規模もここで決める。Epic Issue から取り込んだストーリーに、`codiel` と `subtask` が付いたサブ Issue があれば、その分け方を使い、無ければ分解する。github モードではサブ Issue を `codiel` と `subtask` を付けて起票し、つなぐ(1.2 の 2.5)。ストーリーのブランチにコミットする |
| discuss | 論点を ASK として扱う(D7)。Auto Ask が有効なら Jev が選ぶ。無効なら、論点を問いとして記録し(4.6)、このストーリーの Workflow を `awaiting-human` で終える |
| workflow | 1.2 の 3.5〜3.8 のサイクルを、スクリプトの中で回す。実装とレビューと修正は、1.2 の Workflow を `workflow()` の子として呼ぶ。1.2 でオーケストレーターが行う仕事(マージ・`sub-reset`・進みの表の更新)は、スクリプトが起動するストーリーの担当エージェントが行う。サブが人の判断を待つときは、そのサブを問いとして記録し、独立したサブは進める。進められるサブが無くなったら、Workflow を `awaiting-human` で終える |
| 後工程 | ストーリーの担当エージェントが、test-loop → intent-sync → pr → review → fix-loop → triage → finalize を進める。review の観点ごとのレビュアーは、スクリプトが並列に起動する |

- 1.2 の Workflow は子からさらに子を呼ばないので、子としてそのまま使える。Workflow の子の中からは、さらに子を呼べない。
- 1.2 の規則のうち「メインの作業ツリー」を基準にするもの(親ブランチの fetch と fast-forward と local のマージ、テストの保護、`workflow-` の待ちの間の書き込みの制限)は、Loop では「ストーリーの worktree」と読み替える。ストーリーのブランチは、ストーリーの worktree にチェックアウトされているためである。メインのチェックアウトは利用者のもので、Loop は触らない。
- ストーリーの intent の工程と、Loop の triage・チェックポイントでの起票は、run の中で行う。現行の hook は `gh issue create` を triage でだけ許す(`src/hooks/lib.ts:50-54`)。そこで次のように改める。
  - フェーズの許可: `ghPostPhaseProblem` に `mode` を渡し、判定に使う state がストーリーの intent フェーズか、Epic の run の `loop` フェーズのときも許す。guard-bash と guard-github-mcp は同じ関数を使うので、フェーズの許可は 1 箇所の変更で両方に効く。
  - ラベルの検査: `ghPostPhaseProblem` はコマンドの引数を見ない(`lib.ts:43-46`)ので、1.1 の 3.2 と同じく各 hook に置く(guard-bash は `gh` の引数、guard-github-mcp は `labels` の引数)。Loop の run(`mode: loop`)では `gh issue create` にも `codiel` を求め、標準の run の triage では求めない。
- 子の Workflow と親の Workflow は、同時 16 エージェントの上限を共有する。
- ストーリーの state を書くのは、ある時点でそのストーリーを担当する 1 体だけとする。
- ストーリーの親 intent の `## ASIS` と `## TOBE` には、Epic 文書の原文を要約せずに写し、出所の行(「出所: Epic 文書 `<パス>` の原文」と日付・話者)を添える。マッピングの会話にそのストーリーについてのユーザーの言葉があれば、それも話者と日付を添えて記録する。ストーリーのブランチはベースブランチから作り、Epic 文書が含まれないため、原文をストーリーの intent の中で完結させる。サブ intent は 1.2 のとおり親(ストーリー)を参照する。
- triage では、medium と low の所見を、そのストーリーの配下のタスクとして起票する(github では `codiel` と `subtask` を付けたサブ Issue、local では intent の草案)。Loop が対応するタスクなので、1.1 の triage と違い `codiel` を付ける。Loop の run の中の `gh issue create` に `codiel` が無ければ、hook が拒否する。マップの承認を起票の承認として扱う(3.2)。AI が起票したことが分かる印を付け、人が非対応にできるようにする。
- AI が Epic の範囲内で新しいストーリーが必要だと判断したときも、同じくマップの承認で足し、印を付ける。範囲外なら 4.6 の問いにする(D4)。
- ストーリーの finalize の後、進みを「マージ待ち」にする。

### 4.5 チェックポイントで人の変化とマージを取り込み、止まらずに反映する

- チェックポイントは、各サイクルの始め(4.4 の手順 1)とする。動いている Workflow は止めない。
- 手順:
  1. Epic の worktree に、人が直接書き換えた未コミットの Epic 文書があれば、「人の変更」としてコミットする。
  2. github モードでは、リモートの Epic のブランチを fetch してマージする。Epic 文書が衝突したら、人の変更を正とせずに問い(4.6)にして、その回の取り込みを見送る。
  3. 全体のセッションから受けた指示(3.5)を Epic 文書に書く。
  4. Epic 文書と、github モードでは Epic Issue 配下の Issue とラベルを読み、Epic の state の写しと比べて変化を見つける。Loop 自身が加えた変更は state に記録しておき、人の変化と区別する。github モードで読む Issue は、`codiel` ラベルが付いたものだけに限る。
     - ストーリーの追加: Epic Issue のサブ Issue で、`codiel` と `story` が付いたもの。
     - タスクの追加: ストーリー Issue のサブ Issue で、`codiel` と `subtask` が付いたもの。
     - `codiel` が付いていない Issue は、Epic Issue の配下にあっても取り込まない。全体のセッションで進み具合を報告するときに、取り込まなかった Issue の番号だけを示す。
  5. マージ待ちのストーリーのマージを確かめる。github モードでは `gh pr view`、local モードでは `git merge-base --is-ancestor <ストーリーのブランチ> <ベースブランチ>` で確かめる。マージされていれば進みを「マージ済み」にし、ストーリーとそのサブの run ID に結末(approved)を記録する。PR が閉じられていれば、問い(4.6)にする。
  6. Epic 文書の変更をコミットし、github モードでは Epic のブランチを push する。
- 変化ごとの扱いは次のとおりである。D5 の 4 種類(ストーリーの追加・タスクの追加・優先度の変更・非対応)では止まらない。D3 の「そこで止まらせる」状態だけが、意図して止まる。

| 変化 | 扱い |
| --- | --- |
| ストーリーの追加 | 処理の順序に加える。ストーリーの文は、人が書いた原文として扱う |
| 対応中のストーリーへのタスクの追加 | そのストーリーに、サブ intent として加える。次のサイクルで着手する |
| 優先度の変更 | 処理の順序を並べ替える |
| 非対応の指定 | まだ始めていなければ外す。対応中なら、そのストーリーの Workflow が戻った後に、進みを「非対応」にして worktree を片付ける。ブランチは残す |
| 保留の指定(D3) | 外されるまで飛ばす |
| 要確認の指定(D3) | その項目の手前で止まり、人の判断を待つ。他の独立したストーリーは進める |
| 止まる条件の追加(D3) | 次のサイクルから当てる(4.8) |

- 人が Loop の状態を変える手段は、全体のセッションへの指示(推奨)、github モードの Issue とラベル、Epic 文書の直接の編集(Epic の worktree の中か、リモートの Epic のブランチ)の 3 つである。
- 予定表の「IntentやIssueの状態」のうち、intent の状態は Epic 文書のストーリーとタスクの一覧で表す。intent の frontmatter の `status` には、Loop の状態を書かない。ストーリーの intent はストーリーのブランチにしか無く、着手前のストーリーにはまだ intent が無いためである。

### 4.6 人に聞く内容は問いの一覧に記録し、手すきになって待つ

- Epic の state に、問いの一覧を置く。一覧には問いごとの ID・対象(Epic / ストーリー / サブ)・種類・状態(未回答 / 回答済み)を記録し、問いの全文(問い・選択肢と帰結・評価 ID)は `.codiel/runs/<Epic>/try-<n>/questions/<ID>.md` に書く。
- 対象がストーリーかサブなら、その state を `mark-ask` で `awaiting_human` にする。対象が Epic(範囲外のストーリーなど)なら、Epic の run は active のままにする。
- 人に聞く場面:
  - D2 の 7 つの場面と、その Loop だけの止まる条件(4.8)
  - Auto Ask が無効なときの ASK と discuss の論点、Auto Ask が人に回した ASK(5.1)
  - STOP(6 章)
  - 試行回数の上限超過、`failed` の 2 回目、解消できないコンフリクト(1.2 の 3.6・3.8)
  - Epic の範囲外のストーリー(D4)、閉じられたストーリーの PR(4.5)、Epic 文書の衝突(4.5)
- 答えを受けたら(3.4)、Epic のセッションは答えを問いのファイルに書き、問いを回答済みにする。該当するストーリーの Workflow が動いている間は、ストーリーとサブの state を書かない(4.3)。Workflow が戻った後に、該当する state を `resume` して、次のサイクルで続きから進める。ASK の「このまま承認」と STOP の「誤検知として続ける」は、Epic のセッションが Workflow の外で `record_outcome` と `pass-gate --human-approved` を済ませてから再開させる。
- 中止を選ばれたときは、そのストーリーの部分だけを止め、進みを「中止」にする。Epic の run は止めない。1.2 では親 run ごと止めたが、Loop ではストーリーが親に当たるためである。
- 中止したストーリーは、ユーザーが全体のセッションで再開を指示したときだけ、`story-reset` で作り直して再開する。STOP を妥当として止めたストーリーの再開は、ユーザーの再開の指示を人の承認として扱う(現行の「STOP の後の try は人の承認の後」と同じ考え方)。

### 4.7 待つことしかないときは、待ちを記録してターンを終える

- 残りのストーリーがすべて、マージ待ちか人の判断待ちのとき、Epic のセッションは待ちを記録してターンを終える。stop-guard は、待ちがあれば止めない。
- `wait-add` に種類(`workflow` / `question` / `merge`)を足す。全体のセッションと再開の手順が、何を待っているかを見分けるためである。`--task-id` は現行どおり任意である。
- 待ちから戻る手段:
  - 全体のセッションからの SendMessage(答え・指示・再確認の依頼)。
  - ストーリーの Workflow の完了の通知。
- マージ待ちだけが残ったときの再確認は、ユーザーが全体のセッションで求めたときに、全体のセッションから Epic のセッションへ依頼する。定期的に確かめる仕組みは設けない。
- セッションのプロセスが止まるか再起動すると、動いていた Workflow は続かない(agent-view.md・workflows.md)。Epic のセッションは、起こされるたびに、`workflow` の種類の待ちに対応する Workflow がまだ動いているかを、自分のセッションのタスクの一覧で確かめる。動いていなければ、ストーリーとサブの state から続きの Workflow を起動し直す(同じセッションの中なら `resumeFromRunId` を使う)。全体のセッションは、Epic のセッションが手すきなのに `workflow` の待ちが残っていると知ったら、立て直しを SendMessage で依頼する。
- バックグラウンドセッションでは、利用上限に当たったとき Workflow は待たず、当たったエージェントが失敗する(workflows.md の「When a run hits your usage limit」)。1 回のストーリーの Workflow で、複数のサブが同時に `failed`(`agent()` が null)になったときは、利用上限を疑う。1.2 の `failed` のやり直しの回数に数えず、そのストーリーを人の判断待ちにして「利用上限で止まった可能性がある。再開するか」を問いにする。

### 4.8 止まる場面の検知と、Loop の hook は `ask` を出さないこと

**Loop の run では、hook は `ask` を出さず、`deny` と理由を返す**。auto モードでも hook の `ask` は許可の確認に送られ(1.2 の表)、人のいない Epic のセッションが止まるためである。

- 対象は、判定に使う state の `mode` が `loop` の run(Epic・ストーリー・サブ)である。1.1 と 1.2 の run の `ask` は変えない。
- 理由の文には、「この操作には人の判断が必要である。問いを記録して(4.6)、次の作業へ進む」旨を書く。Claude は `deny` の理由を読めるので、問いを記録できる。
- 1.2 の「テストのファイルへの書き込みは ask」「`workflow-` の待ちの間はメインの `.codiel/` の外を ask」も、Loop では同じく `deny` と理由になる。
- hook の入力の JSON を読めなかったときは `cwd` も分からないので、環境変数だけで Loop かどうかを決める。
- hook が state を読めなかったときや `.codiel/config.json` が不正なときの安全側の `ask`(`guard-write.ts:384-388,407-411,511-516`、`guard-bash.ts:1237-1242`、`guard-github-mcp.ts:58-63`)は、`mode` を読む前に出る。そこで Loop かどうかを state に依らずに決める。全体のセッションが Epic のセッションを起動するときに環境変数 `CODIEL_LOOP_SESSION=1` を渡し(hook はセッションの子プロセスとして環境変数を受け継ぐ)、加えて `cwd` が `.codiel/epics/` の下かを見る。どちらかに当たれば、これらの経路でも `deny` にする。

止まる場面は、次のように検知する。

- 機械的に判定できるもの:
  - 新しい画面名: design.md の「影響を受ける機能単位」の候補の行と、軽量のサブの test-spec での仕様のディレクトリの決定(1.2 の 3.6)
  - 新しい外部依存: Raguel の `code/new-dependency`
  - 取り消せない操作とセキュリティ: Raguel の `code/destructive-ops`・`common/secrets`・`code/protected-paths`(どれも封じた STOP で、STOP は常に人に回る)、`plan/irreversible-ops`(既定は info)、`code/unsafe-exec`・`common/injection-marker`(封じた ASK)。Bash で行う取り消せない操作(force push など)は、現行の guard-bash が拒否する
  - ユーザーの意図を変える判断: Epic の範囲外のストーリー(D4)、承認済みの受け入れ基準の変更(intent-sync)、原文と派生文の食い違い(finalize)、持続層の制約との衝突(review の high)、テストの削除(`code/test-deletion`)
- 金銭・法的判断・個人情報は、コードだけでは判定しきれない。次の 2 つを重ねて検知する。
  - 担い手が design と dev-plan を書くとき、作業の契約(1.1)の求めに応じて、止まる場面に当たる箇所を理由付きで列挙する。1.1 の作業の契約に、この項目を足す。
  - Raguel が、止まる場面ごとの問いを内容判定に足す。Jev が有効なら Jev で判定し、無効なら語彙のルールで判定する。
- その Loop だけの止まる条件(Epic 文書の該当のセクション)は、上の 2 つと同じ経路で判定する。条件の文を、作業の契約と Raguel の内容判定の入力に渡す。
- 止まる場面に当たる所見は、Raguel の ruleId を変えずに、Auto Ask のツールにある対応表(ruleId → 止まる場面の種類)で見分ける。対応表は重大度によらず当てる。`plan/irreversible-ops` のように既定が info のルールも、Loop では当たれば止まる場面として扱う。

### 4.9 Loop の完了

- 全ストーリーの進みが、マージ済みか非対応か中止になったとき、Epic の `loop` フェーズを閉じ、`close --reason loop-complete` で Epic の run を終える。
- 全体のセッションは、手すきの知らせで完了を知る。Epic 文書をベースブランチへ入れる PR を出すかをユーザーに聞き、Epic のセッションを片付ける(`claude rm`)。

## 5. Auto Ask モード

### 5.1 Jev に任せる確認と、人に回す確認を分ける

- `--auto-ask` は `TYPESAFE_API_KEY` が無ければ起動時に断る。Jev を必須にするのはこのモードだけで、codiel 全体での Jev の扱い(ADR-012 の推奨依存)は変えない。Anthropic 以外の外部 API の必須依存は ADR-005 で認められている。
- Auto Ask を有効にしたかは、`init` で state の `autoAsk` に固定する。Loop では、Epic の run の値をストーリーとサブに引き継ぐ。
- 確認の場面ごとの扱いは次のとおりとする。

| 場面 | 扱い |
| --- | --- |
| Raguel の ASK(修正して再提出 / このまま承認 / 中止) | Jev。ただし次の ruleId の ASK は人: `common/resubmission-loop`(行き詰まり)、`code/test-deletion`(テストは仕様)、`code/unsafe-exec`・`common/injection-marker`(セキュリティ)、止まる場面の対応表に当たるもの |
| Loop の discuss の論点 | Jev |
| pr の前の、run の外のファイルの扱い | Jev |
| 前の try の ADR 候補を写す前の確認(`skills/orchestrating-runs/references/adr-candidates.md:57`) | Jev |
| 持続層の領域名の決定(intent-sync で `domains` が空のとき) | Jev |
| triage の起票の判断(通常の run と Dynamic Workflow) | Jev。Loop ではマップの承認で起票する(4.4) |
| intent の承認ゲート | 対象外(通常の run では人。Loop ではマップの承認で代える) |
| 新しい画面名の決定 | 人(D2) |
| 受け入れ基準の変更の確認(intent-sync)と、原文と派生文の食い違い(finalize) | 人(D2 のユーザーの意図を変える判断) |
| broken のテストの修正の承認 | 人(テストは仕様であり、書き換えは意図を変えうる) |
| 評価の前の未コミットの変更の確認(`skills/raguel-gating/references/uncommitted-changes.md:8`)と、起票の前の未コミットの変更の確認(`skills/capturing-intent/references/uncommitted-changes.md`) | 人(想定外の変更は Jev に判断させない) |
| degraded の ASK・evaluate の失敗・委譲の出し直しの失敗・試行回数の上限超過 | 人(評価の基盤の失敗と、行き詰まりは Jev に任せない) |
| ドメインマップと空きブランチの確認 | 人(環境の設定) |
| STOP | 人(6 章) |

- Jev の呼び出しが失敗したとき、または答えの自信度がしきい値を下回ったとき(D15)は、その確認を人に回す。
- Dynamic Workflow と Loop では、エージェントが自分で Jev の裁定を受けて進む。1.2 の 3.6 の「止まって返す」は、人に回すものだけになる。
- `assets/rules/codiel.md` の規則 3 を改める。ASK の部分は「Auto Ask が有効なら Raguel の手順で Jev の裁定を受ける」とする。STOP の部分は「Loop ではそのストーリーだけを止める」とする。既存のプロジェクトへの届け方は、1.1 の 2.5(`codiel:init` の差分の提示)と同じにする。

### 5.2 Jev の「このまま承認」は、人の承認と区別して pass-gate が受ける

- 現行の pass-gate は、verdict が PROCEED でなければ `--human-approved` を求め、ASK には ruling `as-is` の結末の記録を求める(`codiel-state.ts:1148-1156`、`src/raguel-records.ts:433-444`)。Raguel の `record_outcome` は `as-is` を「ASK の評価 + approved」にだけ許す(`raguel-mcp/src/tools/recordOutcome.ts:56-71`)。
- Jev が「このまま承認」を選んだときは、次の形で通す。
  - Raguel の `record_outcome` に、新しい ruling `jev-as-is` を足す。条件は `as-is` と同じ(ASK の評価 + approved)とする。
  - `pass-gate` に `--jev-approved` を足す。`--verdict ASK` のときだけ受け付け、結末の記録に `jev-as-is` があることを検査 7 で確かめる。
  - state のフェーズには `jevApproved: true` を記録し、`humanApproved` とは分ける。
- Jev が「修正して再提出」を選んだときは、現行の裁定 A と同じく state を変えずに直して評価し直す。裁定の記録には `jev-revise` を使う。
- Jev は STOP を扱わないので、`init` の未解決の STOP の検査(`codiel-state.ts:905-942`)と `isOpenStop`(`src/raguel-records.ts:488-497`)は変えない。
- `jev-as-is` を読む側も揃える。
  - Raguel の `Ruling` の型(`raguel-mcp/src/core/types.ts:200`)に足す。
  - 裁定済みの印(`raguel-mcp/src/casefile/store.ts:429` の `hasRuling`)に `jev-as-is` を含める。含めないと、Jev が承認した評価が `common/resubmission-loop` の比較の相手に残り(`rules/common/resubmissionLoop.ts:34`)、後の評価で人へ回る。
  - `jev-as-is` と `jev-revise` からは判例を作らない(`raguel-mcp/src/tools/recordOutcome.ts:150-170` の判例の条件から外す)。現行は内容判定が ok なら ruling を問わず判例を作る(`:154-155`)。Jev の裁定が判例になると、次の評価の `precedent/failure-match`(`raguel-mcp/src/core/pipeline.ts:426-445`)を経て Jev の判断に戻る自己強化が起きるためである。

### 5.3 問いはコードが組み立て、Claude は事実の引用だけを渡す

D13 の「LLM の主観が入らない聞き方」は、次の 3 点で担保する。

- 問いはコードが組み立てる。
  - Raguel MCP に、確認を Jev に裁定させる新しいツールを足す。
  - Raguel の ASK では、評価の記録(所見の ruleId と message、`decisionPoint`、objective、評価対象の抜粋)から問いを作る。
  - 評価を伴わない確認では、確認の種類ごとの固定の型に、Claude が渡した事実を当てはめる。Claude が渡すのは、出典付きの引用だけである。
- 判断の基準は、ユーザーの原文と、持続層の意図的な制約と、ADR に限る。原文の当たらない確認(run の外のファイル・triage・領域名)では、確認の種類ごとの型が定める事実(run の intent の範囲・プロジェクトの規約)を基準にする。原文と制約は、要約せずに引用して渡す。
- 選択肢は対称に並べる。
  - 各選択肢に帰結を同じ形式で添える。
  - 推奨の印や「〜すべき」といった評価語を付けない。
  - Jev に渡す並び順は、確認の種類ごとに固定し、Claude の好みで並べ替えない。
- Raguel の Jev の呼び出し(`raguel-mcp/src/context/jev.ts:22-33`)は、現行では noul と score の問いだけを扱う。`choice` の問いを足す。
- 自信度は、Jev の `choice` の答えの `confidence` で判定する。SDK の答えには選択肢ごとの `probabilities` もある(`@typesafe-ai/sdk` 0.6.0 の `ChoiceResponse`)ので、最上位と次点の差を補助に使ってよい。
- 問いの全文、Jev の答え、自信度、採った選択肢を Raguel のケースファイルに残し、後から人が監査できるようにする。
- `.codiel/config.json` の `raguel` に、Auto Ask のしきい値のキーを足す。未知のキーがあると読み込みエラーになる(`raguel-mcp/src/config/schema.ts`)ため、スキーマも更新する。

### 5.4 選択肢の作者が LLM である点は残る

Loop の discuss の論点では、選択肢そのものを `agenda.md` を書く LLM が作る。問いの文面をコードが組み立てても、選択肢の立て方の偏りは残る。選択肢ごとに帰結を対称の形式で書かせ、形式をツールが検査するところまでを対策とし、残りは既知の限界とする。

## 6. STOP の選択肢

- STOP の意味は変えない。STOP は人が決め、評価をやり直して verdict を上書きしない。
- 選択肢は、現行の 2 つ(誤検知として続ける / 妥当として止める)に、所見から生成した直し方の案を足す。直し方の案は「妥当と認めて止め、やり直すときにこの直し方を取る」という形にし、STOP の後に同じ評価を直して通す道は作らない。carry-over の例外(`skills/orchestrating-runs/references/phase-carry-over.md`)は現行どおり残す。
- 直し方の案は、Auto Ask と同じく、所見と評価の記録から対称の形式で並べる。
- Jev が有効なら、5.3 と同じ組み立て方の問いで推奨を 1 つ選ばせる。
  - Jev に渡す問いでは、選択肢を固定の順に並べ、推奨の印を付けない(5.3 の規則)。
  - 人に示すときは、Jev の答えを受けた後の表示として、AskUserQuestion の規律に合わせて Jev が選んだ案を先頭に置き、「Jev の推奨」と明記する。Jev が無効なら推奨を付けない。
- `casefile/tampered` の STOP は、現行どおり選択肢を出さずに理由を報告して止める。
- 通常の run と Dynamic Workflow では、「妥当として止める」は現行どおり run を止め、直し方の案は次の try に引き継ぐ。Loop では、そのストーリーを「中止」にし、直し方の案はユーザーが再開を指示したときの `story-reset` に引き継ぐ(4.6)。

## 7. 現行コードとの接点と変更

| 対象 | 現行の挙動 | 2.0 での変更 |
| --- | --- | --- |
| `src/codiel-state.ts` の `init`(`:855-962`) | `--intent` が必須で `docs/intents/` 直下に限る。`branch` は `codiel/<slug>` で、try-1 で既にあれば失敗する。リポジトリ全体で active な run は 1 つ | `--epic` で intent の無い Epic の run を作る。`branch` は `codiel/epic-<slug>` で、既にあることを求める。作業ツリーごとに 1 つにする。`worktreeRoot` を実体パスで記録する |
| `guard-write.ts:294-305` の `raguelTarget`、`guard-bash.ts:1204-1210` の `writesRaguelFiles` | run があるときだけ Raguel の設定と記録の書き換えを拒否する | 作業ツリーによらず、リポジトリの中に active か awaiting_human の run があれば当てる(4.1) |
| `STAGES`・`readState` | 1.2 で `workflow` を足した表 | `loop` を `workflow` の前に足す。欠けたキーを `SKIPPED` で補う |
| `findActiveRun`(`:363-377`) | updatedAt が最新の 1 件 | `cwd` の作業ツリーに結びついた run を返す(4.1) |
| `close`(`:1439-1452`) | `branch` が null、intent が passed、ほかのフェーズが pending のときだけ終える | `mode: loop` では `loop` が passed であることを求める分岐を足し、`--reason loop-complete` で `completed` にする |
| `get --active` と読み直しの手順(`skills/orchestrating-runs/SKILL.md:232-234`) | 2 件以上なら人に確かめる | 作業ツリーで絞る引数を足し、Epic のセッションは自分の作業ツリーの run を読む |
| `src/hooks/lib.ts` の `findMainRoot`(`:641,654-659`)と `findProjectRoot`(`:630-638`) | `/.codiel/worktrees/` を含むときだけ手前をメインとする | `/.codiel/epics/` も含める(4.1) |
| `raguel-mcp/src/project/root.ts` の `resolveProjectRoot`(`:14,27-38`) | `findMainRoot` と同じ規則の独立の実装 | 同じコミットで追随させ、2 つの実装を比べるテストを置く |
| `src/hooks/lib.ts` の `ghPostPhaseProblem`(`:46-59`) | Issue の作成は triage だけ | ストーリーの intent フェーズと、Epic の `loop` フェーズでも許し、`codiel` ラベルを求める(4.4) |
| hook の安全側の `ask`(`guard-write.ts:384-388,407-411,511-516`、`guard-bash.ts:1237-1242`、`guard-github-mcp.ts:58-63`) | state を読めないときに `ask` | `CODIEL_LOOP_SESSION=1` か `cwd` が `.codiel/epics/` の下なら `deny`(4.8) |
| `mark-ask`・`resume`・`set-domain`・`wait-*` | run 全体 | `--story`(と `--sub`)で対象を絞る。`wait-add` に種類を足す |
| `pass-gate`(`:1113-1200`) | `--human-approved` | `--jev-approved` を足す(5.2)。`--story` の基準(4.3) |
| 新設 | — | `--epic`・`--story`・`story-reset`・進みの表・問いの一覧・`worktreeRoot`・`autoAsk` |
| `src/raguel-records.ts`(`:433-444,488-497`) | ruling `as-is` を検査する | `jev-as-is` を受ける |
| `src/hooks/stop-guard.ts`・`guard-write.ts`・`guard-bash.ts`・`guard-github-mcp.ts`・`lib.ts` | run を 1 つ選んで判定する。`ask` を返す | 4.1 の順で state を選ぶ。`mode: loop` では `ask` を `deny` と理由に変える(4.8)。`loop` フェーズでの Epic のブランチの push と Epic 文書への書き込みを許す。ストーリーのブランチの PR を進みの表から引く |
| `raguel-mcp/src/codiel/phases.ts` と 2 者比較のテスト | 1.2 で `workflow` を足した表 | `loop` の分だけ後ろの `stage` を 1 ずつ大きくする |
| `raguel-mcp/src/tools/recordOutcome.ts`(`:22-25,56-80,150-170`)と `core/types.ts:200` の `Ruling` | ruling は `as-is`・`false-positive`・`revise`。判例は `false-positive` か内容判定が ok のときに作る | `jev-as-is`・`jev-revise` を足す。`jev-as-is` と `jev-revise` からは判例を作らない |
| `raguel-mcp/src/casefile/store.ts:429` の `hasRuling` | `as-is`・`false-positive` を裁定済みとする | `jev-as-is` も裁定済みとする |
| `raguel-mcp/src/context/jev.ts`(`:22-33`) | noul と score の問い | `choice` の問いを足す |
| Raguel の新しいツール | — | 確認を Jev に裁定させるツール、STOP の推奨を選ばせるツール、止まる場面の対応表、止まる場面の内容判定の問い |
| `raguel-mcp/src/config/schema.ts` | 未知のキーを拒む | Auto Ask のしきい値のキーを足す |
| `skills/raguel-gating/references/outcome-sync.md` | トップレベルの run だけを同期する | Loop のストーリーの結末は、Epic のセッションのチェックポイントで記録する(4.5) |
| `references/intent-common.md:15` | 外部から見える操作は明示承認の後 | Loop ではマップの承認で満たすと書き足す |
| `assets/rules/codiel.md` の規則 3(`:31-34`) | ASK は人を待ち、STOP は run を止める | 5.1 のとおり改める |

## 8. 私の判断

次はユーザーとの合意ではなく、この設計書の執筆者(オーケストレーター)の判断である。

| 番号 | 判断 | 判断の軸 |
| --- | --- | --- |
| J1 | 全体のセッションでは run を作らず、Epic の一覧は `.codiel/runs/` の `mode: loop` を正とする | `claude agents --json` の既定の出力には、終わったセッションが出ない |
| J2 | Epic の worktree を `.codiel/epics/<slug>` に置き、その中で Epic のセッションを起動する | 試験で、`git worktree add` の worktree の中で起動したセッションは、別の worktree とメインの操作を拒否されなかった。`.codiel/worktrees/<a>/<b>` の形の外に置けば、hook が取り違えない |
| J3 | 「active な run は 1 つ」を作業ツリーごとに改め、hook は 4.1 の順で state を選ぶ | D10 で、別の Epic のセッションが同じリポジトリで同時に動く |
| J4 | Epic のセッションから全体のセッションへメッセージを送らず、全体のセッションが手すきの知らせを受けて state を読む | Epic のセッションが全体のセッションの名前を知る必要が無くなる。全体のセッションを始め直しても、宛先が古くならない |
| J5 | 問いの正本は Epic の state の問いの一覧と `questions/` のファイルに置く | `mark-ask` には問いの全文を入れられない。Epic に当たる問いでは、Epic の run を `awaiting_human` にしたくない |
| J6 | Loop の run では hook の `ask` を `deny` と理由に変える | auto モードでも hook の `ask` は許可の確認に送られ、人のいないセッションが止まる。`deny` の理由は Claude に見えるので、問いの記録へ回せる |
| J7 | ストーリーごとに Workflow を起動し、同時に動かす数を設定で抑える | 1 つの Workflow で全ストーリーを回すと、1 つのストーリーの問いが Workflow の終わりまで全体のセッションへ届かない |
| J8 | ストーリーの intent に Epic の原文を写す | ストーリーのブランチはベースブランチから作り、Epic 文書を含まない。原文を参照のマーカーにすると、ストーリーのブランチの上で照合できない |
| J9 | Loop の状態は Epic 文書の一覧(と github のラベル)で管理し、intent の frontmatter には書かない | ストーリーの intent はストーリーのブランチにしか無く、着手前のストーリーには intent が無い |
| J10 | 全体のセッションは Epic 文書を書かず、指示を Epic のセッションへ伝える | Epic 文書を書くのを Epic のセッションだけにして、書き換えの衝突を避ける |
| J11 | ストーリーの中止は、そのストーリーだけを止め、再開はユーザーの指示で `story-reset` する | 1 つのストーリーの中止で、独立した他のストーリーまで止めない。STOP の後の再開に人の承認を通す |
| J12 | Jev の「このまま承認」は `--jev-approved` と `jev-as-is` で通し、人の承認と分けて記録する | 非 PROCEED のゲートを人の承認なしに通すことを、記録の上で区別して監査できるようにする |
| J13 | 試行回数の上限超過・再提出のループ・テストの削除・セキュリティの ASK は、Auto Ask でも人に回す | Jev に「続行」を選ばせ続けるとループが止まらない。テストとセキュリティは意図と安全に関わる |
| J14 | 止まる場面は、ruleId を変えず、Auto Ask のツールの対応表で見分ける | ruleId を変えると、設定と判例の照合が外れる |
| J15 | 非対応にしたストーリーのブランチは残し、worktree だけを片付ける | ラベル 1 つで未マージの作業を消さない |
| J16 | `/codiel:loop` は、bypassPermissions のときと、メインのチェックアウトに active な run があるときは始めない | 答えのメッセージが保留される。メインの run のガードが全体のセッションに当たる |
| J17 | `codiel` が付いていない Issue は取り込まず、番号だけを報告する | D17 のラベルで codiel の対象を区切った。ラベルの付け忘れは、報告を見た人が直せる |

## 9. 採らなかった案

ユーザーが選ばなかった案と、調べた上で使わなかった仕組みを残す。再提案しない。

- ストーリーの親 PR を Epic 用のブランチへ出し、オーケストレーターがマージする案
- ストーリーごとに intent の承認と discuss をユーザーと行う案
- ストーリーごとに run を持たせる案(案 A)
- Epic で 1 つの run にし、サブエージェントの中で Agent ツールを使って並列化する案(案 B2)
- 人が `claude --worktree` で Epic ごとのセッションを手で起動する案
- Claude Code のエージェントチームを土台にする案
- Epic を 1 つずつ順に片付け、同時に動かさない案
- Epic のセッションの質問に、人が各セッションを開いて答える案
- Epic のセッションの許可モードを、全体のセッションに合わせる案
- Auto Ask を Loop の中だけで使えるようにする案
- Jev の自信度が低くても、常に Jev の答えに従う案
- ユーザーが足したストーリーに、短い聞き取りと承認を通してから取り込む案(D5 で止まらないと決めた)

## 10. 影響範囲

| 層 | 対象 |
| --- | --- |
| 指示層 | `commands/loop.md`(新設。全体のセッション)、`commands/run.md`(`--loop`・`--auto-ask`)、全体のセッションのスキルと Epic のセッションのスキル(新設。名前はビルダーが決める)、`skills/orchestrating-runs/`、`skills/capturing-intent/`、`skills/raguel-gating/`(Auto Ask・STOP の選択肢・Jev の裁定)と `references/outcome-sync.md`、`skills/facilitating-design-discussions/`・`skills/preparing-design-agendas/`(論点を ASK として扱う)、`skills/filing-followup-issues/`(Loop の triage) |
| 同梱スクリプト | `workflows/story.js`(新設) |
| 参照層 | `references/intent-format.md`(Epic 文書の書式・ストーリーの intent の原文の写し方。`docs/format-change-checklist.md` を追随させる)、`references/intent-common.md`(Loop の起票の承認)、1.1 の作業の契約(止まる場面の列挙) |
| 素材 | `assets/rules/codiel.md`(規則 3) |
| 実装層 | 7 章の表のとおり |
| Raguel | 7 章の表のとおり。`docs/raguel-contract.md` を改め、`raguelContract` の値は、ruling の追加が既存の記録の読み方を変えないので上げない |
| ワークスペースの設定 | `.codiel/config.json` の `loop.maxParallelStories`(新しいキー) |
| 文書 | `README.md`、`docs/DESIGN.md`、`docs/skill-flowcharts.md`、ルートの `README.md` |
| 配布宣言 | `.claude-plugin/plugin.json` と `package.json` を 2.0.0-dev にし、リリース時に 2.0.0 にする |
| 他のプラグイン(別の改修) | agent-policy と better-agentics の G3・G4・G9・G11(両プラグインとの食い違いの文書) |
| ARCHITECTURE | 全体のセッションと Epic のセッションの構成、run を作業ツリーに結びつけること、Loop の hook が `ask` を出さないこと、Auto Ask の問いの組み立て方は ADR の候補になる。`metatron:updating-architecture` を起動して扱う |

## 11. 確かめる事項

実装計画の最初に、次を確かめる小さな試作(スパイク)を置く。1.2 の設計書の 8 章の項目も前提に含む。記号は 1.2 の項目と区別するため `2.0-S<番号>` とする。

| 記号 | 確かめること | 結果が想定と違うときの扱い |
| --- | --- | --- |
| 2.0-S1 | 手すきのバックグラウンドセッションが、SendMessage を受けて新しいターンを始めるか(公式ドキュメントでは始める) | 始めないなら、全体のセッションが `claude --resume <ID> --bg` で、答えをプロンプトにして再開させる |
| 2.0-S2 | `claude --bg` の起動のプロンプトに、スラッシュコマンドを渡せるか | 渡せないなら、プロンプトでスキルの起動を指示する |
| 2.0-S3 | Loop の run で hook が `deny` を返したとき、Epic のセッションと Workflow のエージェントが理由を読んで問いを記録できるか | 記録できないなら、hook が問いを直接記録する |
| 2.0-S4 | `auto` の許可モードで、codiel の操作(`git push`・`gh pr create`・`gh pr merge`・`gh issue create`・Raguel MCP)が自動判定で通るか | 拒否されるものがあれば、プロジェクトの許可の設定に足す手順を `codiel:init` に加える |
| 2.0-S5 | バックグラウンドセッションと、その中の Raguel MCP に、全体のセッションの環境変数(`TYPESAFE_API_KEY`)が引き継がれるか | 引き継がれないなら、`--auto-ask` の起動時の検査を Epic のセッションの中でも行い、無ければ問いにして止める |
| 2.0-S6 | 複数の Epic のセッションの Raguel MCP(別プロセス)が、同じケースファイルの置き場に同時に追記したときの挙動(1.2 の S3 をプロセス間へ広げる) | 壊れるなら、ケースファイルの置き場を Epic ごとに分ける |
| 2.0-S7 | Jev の `choice` の `confidence` に、拮抗の判定に使える値の幅があるか | 使えなければ、`probabilities` の差を主にする |
| 2.0-S8 | GitHub で、Issue の closed の理由(not planned)とラベルを `gh` で読めるか | 読めなければ、非対応はラベルだけで表す |
| 2.0-S9 | Epic の worktree の中で起動したセッションが、メインの下の `.codiel/worktrees/` に作った worktree へ書き込めるか(1.1 の試験では通った。公式ドキュメントは「セッションを始めたディレクトリの下に `git worktree add` で作った worktree」を通すと書く) | 拒否されるなら、プロジェクトの設定の `worktree.bgIsolation: "none"` を `codiel:init` で足す手順にする |
| 2.0-S10 | `CODIEL_LOOP_SESSION=1` を付けて起動したバックグラウンドセッションで、hook の子プロセスがこの環境変数を受け取るか | 受け取らないなら、`cwd` が `.codiel/epics/` の下かだけで判定する |

## 12. 既知の限界

- Loop の進みは、ストーリーの親 PR を人がマージする速さに縛られる(D6)。マージの再確認は、ユーザーが全体のセッションで求めたときに行う。
- 金銭・法的判断・個人情報の検知は、担い手の宣言と Raguel の判定に頼るので、漏れはありうる。
- discuss の論点の選択肢は LLM が作る(5.4)。
- Epic のセッションは `auto` の許可モードで動くので、許可の判断は Claude Code の自動判定と codiel の hook に委ねられる。Loop の hook は人に聞かずに拒否するので、偽陽性の拒否は問いとして全体のセッションに届くまで進まない。
- 複数の Epic が同じファイルを変えたときの衝突は、マージの時点まで見えない。同じ Epic の中でも、並列のストーリーがそれぞれの intent-sync で同じ持続層のファイル(`docs/intents/design/<種別>.md`・`domains/<領域>.md`)を書くので、後からマージする PR で衝突する。解消はマージする人が行う。
- バックグラウンドセッションは利用上限に当たっても待たないので、上限に当たるとストーリーが人の判断待ちに溜まる(4.7)。
- ストーリーを中止すると、再開は `story-reset` によるやり直しになる。
- 全体のセッションが開かれていない間は、問いに答える人がいないので、該当するストーリーは待ち続ける。

## 13. ビルダーに任せること

- 全体のセッションと Epic のセッションのスキルの名前と分け方。
- Epic 文書の書式の細目と、ストーリーマップの表し方。
- Loop の状態(保留・要確認・優先度)を表すラベルの名前と色。どれも `codiel` と併記する。
- 問いのファイルの書式と、問いの ID の付け方。
- Auto Ask の問いの型(確認の種類ごと)と、しきい値の既定値。
- STOP で直し方の案を生成する手順。
- `loop.maxParallelStories` の既定値の見直し。

## 出典

- ユーザーの予定表(2026-11-08 の会話で貼り付け): 「Loop Engineeringモード ユーザーの実現したいこと(Epic)を起点に、それを実現するためのユーザーストーリーマッピングを行う。その後ストーリー毎のWorkflow Intentsを起票。各IntentやIssueの状態を管理しながら、必要であれば新しいストーリーや新しいタスクを起票しながら全ストーリーを完結させるUltracode。ユーザーが介入するためのIntentやIssueの状態を決め、起動時及びループの途中で規定外の状態を設定できるようにする。」「Auto Askモード Jevを必須とするモード。ASKステータスになった場合、ユーザーへの確認ではなくJevの判断でRunを継続する。LLMの主観が入った質問の仕方ではなく中立な立場による判断が行えるような質問の仕方にする必要がある。」「STOPステータス時、ユーザーが判断できる選択肢を生成して判断を仰ぐようにする。Jev有効時、選択肢のうちどれが推奨かをJevに判断させる。Auto Askモードと同じくLLMの主観が入らない質問の仕方をする必要がある。」
- ユーザーの補足(同日): 止まる場面として「新しい画面名がdesignで決定されたとき」「金銭が絡む実装や判断を行うとき」「法的判断が必要なとき」。「Loopセッションを経ずとも人の手でできる状態変化も取り込むようにしたいです。これらに対応する判断で止まる必要はないです。」「1セッション1Epic」「別Epicの対応を別セッションの起動によって対応する」「別セッションに分ける操作を人の手で行うのは私が想像しているLoop Engineeringとは離れています。」
- Claude Code の仕様: https://code.claude.com/docs/en/hooks.md 、https://code.claude.com/docs/en/agent-teams.md 、https://code.claude.com/docs/en/agent-view.md 、https://code.claude.com/docs/en/cross-session-messaging.md 、https://code.claude.com/docs/en/worktrees.md (2026-11-08 に取得)、Claude Code 2.1.319 の `claude --help`
- 試験: 2026-11-08 にこのリポジトリで起動した試験用のバックグラウンドセッション 3 つ(片付け済み)
- 会話記録: `docs/chat/2026/1107/phyllis998/2356-codiel-1-1-to-2-0-design-kickoff.md`
