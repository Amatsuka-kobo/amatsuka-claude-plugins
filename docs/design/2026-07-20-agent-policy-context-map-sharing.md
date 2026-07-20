# agent-policy context-map 共有先の設計課題メモ

- 作成日: 2026-07-20
- ステータス: **論点整理まで。設計・決定は後日**（ユーザー依頼により別途検討する）
- 関連: `plugins/agent-policy/`（2026-07-20 main マージ済み）, `docs/design/2026-07-19-agent-policy-design.md`, `docs/design/2026-07-20-agent-policy-token-cost-analysis.md`
- 発端: skill-reviewer(実装時の Task 15)の任意 Minor 指摘 —「claude-only の共有先『Fable / Opus』は Opus の自己共有を含み冗長」。ユーザーが「検討事項あり」として保留。加えて「**Sol に共有するか否か**の観点も含めて」検討したいとの要望。

---

## 1. 現状（実装済みの記述）

context-map の「共有先」に関する記述は現在4箇所に散在している。いずれも変更時は同期が必要。

| 箇所 | 現在の記述 | 作成者 |
|---|---|---|
| `skills/with-codex/SKILL.md:53` | 作成した context-map は **Fable / Opus** に必ず共有する | 作成者=GPT Sol |
| `skills/claude-only/SKILL.md:47` | 作成した context-map は **Fable / Opus** に必ず共有する | 作成者=Opus |
| `references/context-map-guide.md:7` | オーケストレーター(**Fable / Opus**)へ共有する材料とする | — |
| `assets/context-map-template.md:106` | このファイルは **Fable / Opus** に共有し、全体整合性の判断材料とする | — |

補足: テンプレートの Open Questions 表(`context-map-template.md:71-72`)の「誰に確認すべきか」列にも `Fable / Opus`・`GPT Sol / Opus` があり、共有先の考え方と整合させるべきか要検討。

## 2. 論点

### 論点A: 作成者を共有先に含める冗長性
- **claude-only**: 作成者は Opus。「Fable / Opus に共有」は **Opus → Opus の自己共有**を含み冗長。→「Fable に共有」で足りるのでは(skill-reviewer の当初指摘)。
- **with-codex**: 作成者は GPT Sol。同じ論理なら「Sol は既に持っている」ので、共有先として Sol を挙げるのは冗長。現状の「Fable / Opus」には Sol が入っていないので一見問題ないが、論点B・Cと合わせて整理が要る。

### 論点B: Sol に共有するか否か（ユーザー明示の観点）
「Sol に共有するか」は文脈で2つの意味がある:
1. **with-codex で作成者=Sol の場合** → Sol は自分で作ったので共有不要(自己共有・論点A と同じ)。
2. **下流の設計・実装担当としての Sol** → context-map は「詳細設計・WBS を作る者」が消費する。with-codex では Sol がその役(フロー step 3)なので Sol は作成者かつ主要消費者。しかし、
   - GPT 不在フォールバックなどで **別のエージェント(Fable/Opus)が map を作成**した場合、その map を Sol に**下流共有**すべきか?という問いが生じる。
   - 逆に、Sol が設計中に map を更新したら、その更新版を Fable/Opus に**上流再共有**すべきか?

### 論点C: 「上流共有(オーケストレーター向け)」と「下流共有(設計・実装向け)」の区別
現状の「Fable / Opus に共有」は**上流共有**(全体整合性の判断材料として最上位へ上げる)を意図している。別に**下流共有**(実際に設計・実装する者が map を参照する)がある。この2方向を分けて定義すべき:
- **上流(必須)**: Fable(最終承認の判断材料)、Opus(補足修正・中間統括)。※作成者自身は除く。
- **下流(必要に応じて)**: 詳細設計・WBS を作る者(with-codex=Sol / claude-only=Opus)。実装者(Terra/Luna/Sonnet)は原則、自己完結ブリーフで足りるので **map 全体は渡さない**(必要な断片のみ)。

### 論点D: トークンコストとの相互作用（重要）
`docs/design/2026-07-20-agent-policy-token-cost-analysis.md` の知見と直結する。
- context-map 全体を多数の下流エージェントに共有すると、各エージェントの**毎ターンの文脈が map のサイズ分だけ増える**(1ターン単価が上がる)。
- したがって共有先は「全体像が本当に要るエージェント(オーケストレーター・設計担当)」に限り、機械的実装者には**渡さない or 関連断片のみ**にするのがコスト面でも正しい。
- 「必ず共有する」という強い語が、不要な広域共有を促していないか要検討。

## 3. 決定に向けた選択肢（未決・比較のみ）

| 選択肢 | claude-only の共有先 | with-codex の共有先 | 備考 |
|---|---|---|---|
| (1) 現状維持 | Fable / Opus | Fable / Opus | 冗長(Opus 自己共有)が残る |
| (2) 作成者を除く最小化 | **Fable** のみ | **Fable / Opus**（Sol は作成者なので除外のまま） | skill-reviewer 案の一般化 |
| (3) 上流/下流を明示分離 | 上流=Fable / 下流=(Opus が設計継続) | 上流=Fable / Opus / 下流=Sol(設計時) | 役割ベースで最も厳密だが記述が増える |

## 4. 決めるべきこと（後日）

1. 論点A: 作成者を共有先から外すか(claude-only を「Fable」に、with-codex の考え方も統一)。
2. 論点B: 「Sol に共有」を、作成者としての自己共有(不要)と下流共有(フォールバック時に要る)に分けて定義するか。
3. 論点C: 上流共有/下流共有の2方向を context-map-guide に明記するか。
4. 論点D: 「必ず共有」の対象を「全体像が要るエージェントのみ」に絞り、実装者への広域共有を避ける旨をコスト観点で明記するか。
5. 変更する場合、§1 の4箇所 + テンプレート Open Questions 表を同期する。

---

*このメモは後日、context-map の共有モデル(誰に・どの方向へ・どこまで渡すか)を設計する際の出発点とする。トークンコスト分析(`2026-07-20-agent-policy-token-cost-analysis.md`)と併せて検討すること。*
