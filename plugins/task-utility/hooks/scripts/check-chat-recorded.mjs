#!/usr/bin/env node
// Stop フック: 実質的な会話が docs/chat/ に記録されないままターンが終わるとき、
// 軽量モデルの chat-recorder サブエージェントへの記録委譲を差し戻しで促す。
// docs/chat/ ディレクトリが存在するプロジェクトでのみ働く(プロジェクト単位のオプトイン)。
import fs from 'node:fs';
import path from 'node:path';

// これ未満のユーザー発言数は「単純な一問一答」とみなして口出ししない
const MIN_USER_TURNS = 3;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

// 差し戻しは 1 ストップにつき 1 回まで(記録できない事情があるときの無限ループ防止)
if (input.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
if (!fs.existsSync(path.join(projectDir, 'docs', 'chat'))) process.exit(0);

const transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

let userTurns = 0;
let recorded = false;
for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  const msg = e.message;
  if (!msg || e.isSidechain) continue;

  if (e.type === 'user' && typeof msg.content === 'string') {
    const text = msg.content.trim();
    if (text && !text.startsWith('<') && !e.isMeta) userTurns++;
  } else if (e.type === 'assistant' && Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (
        c.type === 'tool_use' &&
        (c.name === 'Write' || c.name === 'Edit') &&
        typeof c.input?.file_path === 'string' &&
        c.input.file_path.replaceAll('\\', '/').includes('docs/chat/')
      ) {
        recorded = true;
      }
    }
  }
}

if (userTurns < MIN_USER_TURNS || recorded) process.exit(0);

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || '<task-utility plugin root>';
const reason = [
  'この会話はまだ docs/chat/ に記録されていません(task-utility chat スキルの対象です)。',
  '記録はメインコンテキストで行わず、記録専用サブエージェントに委譲してください:',
  'Agent ツールで subagent_type "task-utility:chat-recorder" を起動し、プロンプトに次の情報を含めること。',
  `- トランスクリプト: ${transcriptPath}`,
  `- 抽出コマンド: node "${pluginRoot}/scripts/extract-conversation.mjs" "${transcriptPath}"`,
  `- スキル定義: ${pluginRoot}/skills/chat/SKILL.md`,
  '- ユーザーの GitHub ユーザー名、日付、この会話の成果物(ファイルパス・コミット)、前提となる資料',
  '既に記録済み、または記録に値しない会話だと判断する場合は、その理由をユーザーに一言伝えてから終了して構いません。',
].join('\n');

console.log(JSON.stringify({ decision: 'block', reason }));
