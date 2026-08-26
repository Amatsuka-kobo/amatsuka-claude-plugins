#!/usr/bin/env python3
# フェイルオープン方針: 入力や判定で例外が起きたときは、編集を妨げないため許可する。

import json
import os
import re
import sys
import time
from pathlib import Path

GATE_TOOLS = {
    "Edit",
    "Write",
    "NotebookEdit",
    "mcp__serena__replace_content",
    "mcp__serena__replace_symbol_body",
    "mcp__serena__replace_in_files",
    "mcp__serena__insert_after_symbol",
    "mcp__serena__insert_before_symbol",
    "mcp__serena__rename_symbol",
    "mcp__serena__safe_delete_symbol",
}

DENY_GLOBS = (
    "plugins/*/src/**",
    "plugins/*/build.ts",
    "plugins/codiel/raguel-mcp/src/**",
    "plugins/codiel/raguel-mcp/build.ts",
    "plugins/*/skills/**",
    "plugins/*/agents/**",
    "plugins/*/commands/**",
    "plugins/*/references/**",
    "plugins/*/assets/**",
)

DENIAL = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "delegation-gate: メインセッションでの実装・指示層の編集は運用方針により行わない。"
            "agent-policy の担当表に従い Agent tool で委譲する: 複雑/重要な実装 → "
            "gpt-sol-lead-implementer、通常の実装 → gpt-terra-general-implementer、"
            "軽量な実装 → gpt-luna-light-implementer。Bash 経由の書き込みや他ツールへの切替で"
            "回避しない。ユーザーが直接編集を明示指示した場合のみ、ユーザー自身が "
            "scripts/direct-edit.sh on を実行して一時解除する(2 時間で自動失効)。"
        ),
    }
}


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    parts: list[str] = []
    index = 0
    while index < len(pattern):
        character = pattern[index]
        if character == "*" and index + 1 < len(pattern) and pattern[index + 1] == "*":
            if index + 2 < len(pattern) and pattern[index + 2] == "/":
                parts.append("(?:.*/)?")
                index += 3
            else:
                parts.append(".*")
                index += 2
        elif character == "*":
            parts.append("[^/]*")
            index += 1
        elif character == "?":
            parts.append("[^/]")
            index += 1
        else:
            parts.append(re.escape(character))
            index += 1
    return re.compile("^" + "".join(parts) + "$")


DENY_PATTERNS = tuple(glob_to_regex(pattern) for pattern in DENY_GLOBS)


def is_direct_edit_enabled(project_root: Path) -> bool:
    flag_path = project_root / ".claude" / "delegation-gate.direct"
    if not flag_path.is_file():
        return False

    age = time.time() - flag_path.stat().st_mtime
    return 0 <= age <= 7200


def normalize_path(raw_path: str, project_root: Path, is_absolute: bool) -> str | None:
    path = Path(raw_path)
    if is_absolute:
        if not path.is_absolute():
            raise ValueError("絶対パスではありません")
        resolved_path = path.resolve()
    else:
        resolved_path = (project_root / path).resolve()

    try:
        return resolved_path.relative_to(project_root).as_posix()
    except ValueError:
        return None


def get_target_path(tool_name: str, tool_input: dict[str, object], project_root: Path) -> str | None:
    if tool_name in {"Edit", "Write"}:
        raw_path = tool_input.get("file_path")
        if not isinstance(raw_path, str) or not raw_path:
            raise ValueError("ファイルパスがありません")
        return normalize_path(raw_path, project_root, is_absolute=True)

    if tool_name == "NotebookEdit":
        raw_path = tool_input.get("notebook_path")
        if not isinstance(raw_path, str) or not raw_path:
            raise ValueError("ノートブックのパスがありません")
        return normalize_path(raw_path, project_root, is_absolute=True)

    raw_path = tool_input.get("relative_path")
    if tool_name == "mcp__serena__replace_in_files" and (
        not isinstance(raw_path, str) or not raw_path
    ):
        return ""
    if not isinstance(raw_path, str) or not raw_path:
        raise ValueError("相対パスがありません")
    return normalize_path(raw_path, project_root, is_absolute=False)


def should_deny(hook_input: dict[str, object]) -> bool:
    if hook_input.get("agent_id"):
        return False

    tool_name = hook_input.get("tool_name")
    if not isinstance(tool_name, str):
        raise ValueError("ツール名がありません")

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or hook_input.get("cwd") or os.getcwd()
    if not isinstance(project_dir, str) or not project_dir:
        raise ValueError("プロジェクトルートがありません")
    project_root = Path(project_dir).resolve()

    if is_direct_edit_enabled(project_root):
        return False
    if tool_name not in GATE_TOOLS:
        return False

    tool_input = hook_input.get("tool_input")
    if not isinstance(tool_input, dict):
        raise ValueError("ツール入力の形式が正しくありません")

    target_path = get_target_path(tool_name, tool_input, project_root)
    return target_path == "" or (
        target_path is not None and any(pattern.fullmatch(target_path) for pattern in DENY_PATTERNS)
    )


def main() -> None:
    try:
        hook_input = json.load(sys.stdin)
        if not isinstance(hook_input, dict):
            return
        if should_deny(hook_input):
            sys.stdout.write(json.dumps(DENIAL, ensure_ascii=False) + "\n")
    except Exception:
        return


if __name__ == "__main__":
    main()
