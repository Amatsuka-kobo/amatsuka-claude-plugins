# tiny-report-check Skill Description Optimization

- 日付: 2026-08-10
- 参加者: phyllis98, AI (Claude Sonnet 5)
- 成果物: None (optimization request only)
- 前提: None

---

## セッション1: Skill Description Refinement

# phyllis98

> You are optimizing a skill description for a Claude Code skill called "tiny-report-check". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.
>
> The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.
>
> Here's the current description:
> <current_description>
> "Use this skill only when the user asks about quantum physics."
> </current_description>
>
> Current scores (Train: 2/3):
> <scores_summary>
> FAILED TO TRIGGER (should have triggered but didn't):
>   - "What is quantum superposition?" (triggered 0/1 times)
>
> PREVIOUS ATTEMPTS (do NOT repeat these — try something structurally different):
>
> <attempt train=2/3>
> Description: "Use this skill only when the user asks about quantum physics."
> Train results:
>   [PASS] "Explain quantum entanglement simply" (triggered 1/1)
>   [PASS] "Write a friendly greeting" (triggered 0/1)
>   [FAIL] "What is quantum superposition?" (triggered 0/1)
> </attempt>
>
> </scores_summary>
>
> Skill content (for context on what the skill does):
> <skill_content>
> ---
> name: tiny-report-check
> description: Use this skill only when the user asks about quantum physics.
> ---
>
> # Tiny report check
>
> Provide a concise answer.
>
> </skill_content>
>
> Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:
>
> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.
>
> Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters — descriptions over that will be truncated, so stay comfortably under it.
>
> Here are some tips that we've found to work well in writing these descriptions:
> - The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
> - The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
> - The description competes with other skills for Claude's attention — make it distinctive and immediately recognizable.
> - If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.
>
> I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end. 
>
> Please respond with only the new description text in <new_description> tags, nothing else.

# AI

ユーザーが tiny-report-check スキルの説明文を最適化するよう要求している。現在の説明「Use this skill only when the user asks about quantum physics.」は 2/3 のテストケースしかパスしており、「What is quantum superposition?」というクエリで誤検出を失敗している。

ユーザーの指示に従い、構造的に異なるアプローチで改善された説明文を生成する。説明文は以下の条件を満たす必要がある:
- 100～200 語程度
- 1024 文字以下
- 命令形（「Use this skill for」の形式）
- ユーザー意図に焦点（実装詳細ではなく）
- 過度なオーバーフィッティングを避ける
- 既試案の構造と異なるアプローチ

生成する説明は `<new_description>` タグで囲んで返す。


## セッション 1: tiny-report-check スキルの説明文最適化

# USER

> Reply with exactly the word PONG and nothing else.

# AI

PONG
