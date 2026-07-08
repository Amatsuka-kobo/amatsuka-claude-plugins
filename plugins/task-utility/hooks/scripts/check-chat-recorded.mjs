#!/usr/bin/env node
// Stop フック: 最後の記録イベントより後にユーザー発言が残ったままターンが終わるとき、
// 軽量モデルの chat-recorder サブエージェントへの記録・追記委譲を差し戻しで促す。
// docs/chat/ ディレクトリが存在するプロジェクトでのみ働く(プロジェクト単位のオプトイン)。
import fs from 'node:fs';
import path from 'node:path';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

// 差し戻しは 1 ストップにつき 1 回まで(記録できない事情があるときの無限ループ防止)
if (input.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
if (!fs.existsSync(path.join(projectDir, 'docs', 'chat'))) process.exit(0);

const transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

// 「最後の実質ユーザー発言」と「最後の記録イベント」の行位置を比較する。
// 記録イベントは docs/chat/ への Write/Edit、または chat-recorder へのディスパッチ。
// サブエージェントのトランスクリプトは別ファイルに保存されるため、chat-recorder が
// 行った Write はここからは見えない — ディスパッチ自体を記録の証跡として扱う。
let lastUserTurn = -1;
let lastRecord = -1;
let lineNo = 0;
for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
  lineNo++;
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  const msg = e.message;
  if (!msg || e.isSidechain) continue;

  if (e.type === 'user' && typeof msg.content === 'string') {
    const text = msg.content.trim();
    if (text && !text.startsWith('<') && !e.isMeta) lastUserTurn = lineNo;
  } else if (e.type === 'assistant' && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type !== 'tool_use') continue;
      if (
        (c.name === 'Write' || c.name === 'Edit') &&
        typeof c.input?.file_path === 'string' &&
        c.input.file_path.replaceAll('\\', '/').includes('docs/chat/')
      ) {
        lastRecord = lineNo;
      } else if (c.name === 'Agent' && String(c.input?.subagent_type ?? '').includes('chat-recorder')) {
        lastRecord = lineNo;
      }
    }
  }
}

if (lastUserTurn === -1 || lastUserTurn <= lastRecord) process.exit(0);

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || '<task-utility plugin root>';
const reason = [
  'この会話には docs/chat/ にまだ記録されていないターンがあります(task-utility chat スキルの対象です)。',
  '記録はメインコンテキストで行わず、記録専用サブエージェントに委譲してください:',
  'Agent ツールで subagent_type "task-utility:chat-recorder" を起動し、プロンプトに次の情報を含めること。',
  `- トランスクリプト: ${transcriptPath}`,
  `- 抽出コマンド: node "${pluginRoot}/scripts/extract-conversation.mjs" "${transcriptPath}"`,
  `- スキル定義: ${pluginRoot}/skills/chat/SKILL.md`,
  '- ユーザーの GitHub ユーザー名、日付、この会話の成果物(ファイルパス・コミット)、前提となる資料',
  '- 既存の記録ファイルがあれば新規作成せず、未記録のターンだけをそのファイルに追記するよう指示すること。',
  'トランスクリプトが読めない等、技術的に記録できない場合のみ、その理由をユーザーに一言伝えてから終了して構いません。',
].join('\n');

console.log(JSON.stringify({ decision: 'block', reason }));
