#!/usr/bin/env python3
"""native-japanese の 2 つの時点で同じ題材を claude -p に書かせ、指定した型の件数を比べる。

使い方:
  native_japanese_ab.py run --before <ref> --after <ref|WORKTREE> --prompts <json> --patterns <json> --out <dir>
                            [--models opus,sonnet] [--runs 2] [--workers 6] [--timeout 300]
  native_japanese_ab.py report --patterns <json> --out <dir> [--show <型の id>]
  native_japanese_ab.py --self-check

run は採取の後に report も出す。保存済みの応答は採り直さないので、中断した採取は同じ引数で続けられる。
report は応答の本文を <out>/text/<before|after>/<モデル>/<題材>-<回>.txt にも書き出す。
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PLUGIN = "plugins/native-japanese"
LABELS = ("before", "after")


def repo_root():
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(out.stdout.strip())


def export_plugin(ref, dest):
    """ref の時点のプラグインを dest に複製する。WORKTREE は作業ツリーをそのまま写す。"""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    root = repo_root()
    if ref == "WORKTREE":
        shutil.copytree(root / PLUGIN, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules"))
        return
    archive = subprocess.run(["git", "-C", str(root), "archive", ref, PLUGIN], capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", str(dest), "--strip-components=2"], input=archive.stdout, check=True)


def parse_stream(text):
    """stream-json の出力から、最後の応答の本文と Skill ツールの起動の有無を取り出す。"""
    result, skill = None, False
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "result" and not event.get("is_error"):
            result = event.get("result")
        for block in (event.get("message") or {}).get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Skill":
                skill = True
    return result, skill


def sample(job):
    path, plugin_dir, cwd, model, prompt, timeout = job
    if path.exists() and parse_stream(path.read_text())[0]:
        return "skip"
    cmd = [
        "claude", "-p", prompt,
        "--plugin-dir", str(plugin_dir),
        "--setting-sources", "project",
        "--strict-mcp-config",
        "--output-format", "stream-json", "--verbose",
        "--no-session-persistence",
        "--model", model,
    ]
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return "timeout"
    path.write_text(proc.stdout)
    return "ok" if parse_stream(proc.stdout)[0] else "error"


def run(args):
    out = Path(args.out).resolve()
    prompts = json.loads(Path(args.prompts).read_text())
    cwd = out / "cwd"
    cwd.mkdir(parents=True, exist_ok=True)
    refs = {"before": args.before, "after": args.after}
    jobs = []
    for label in LABELS:
        export_plugin(refs[label], out / "plugin" / label)
        for model in args.models.split(","):
            for item in prompts:
                for n in range(1, args.runs + 1):
                    path = out / "raw" / label / model / f"{item['id']}-{n}.jsonl"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    jobs.append((path, out / "plugin" / label, cwd, model, item["prompt"], args.timeout))
    (out / "refs.json").write_text(json.dumps(refs))
    with ThreadPoolExecutor(args.workers) as pool:
        states = list(pool.map(sample, jobs))
    for state in sorted(set(states)):
        print(f"{state}: {states.count(state)}", file=sys.stderr)
    report(args)


def count(texts, patterns):
    """型ごとに、一致の件数と、一致を 1 件以上含む応答の本数を返す。"""
    rows = []
    for item in patterns:
        regex = re.compile(item["regex"])
        hits = [len(regex.findall(text)) for text in texts]
        rows.append((item["id"], sum(hits), sum(1 for h in hits if h)))
    return rows


def load(out, label):
    texts, skills, failed = [], 0, 0
    for path in sorted((out / "raw" / label).glob("*/*.jsonl")):
        text, skill = parse_stream(path.read_text())
        if text is None:
            failed += 1
            continue
        texts.append((path, text))
        skills += skill
    return texts, skills, failed


def report(args):
    out = Path(args.out).resolve()
    patterns = json.loads(Path(args.patterns).read_text())
    data = {label: load(out, label) for label in LABELS}
    if args.show:
        regex = re.compile(next(p["regex"] for p in patterns if p["id"] == args.show))
        for label in LABELS:
            for path, text in data[label][0]:
                for sentence in re.split(r"(?<=[。\n])", text):
                    if regex.search(sentence):
                        print(f"{label}\t{path.parent.name}/{path.stem}\t{sentence.strip()}")
        return
    for label in LABELS:
        for path, text in data[label][0]:
            dest = out / "text" / label / path.parent.name / f"{path.stem}.txt"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text)
    refs = json.loads((out / "refs.json").read_text()) if (out / "refs.json").exists() else {}
    print("| 項目 | before | after |")
    print("| --- | --- | --- |")
    print(f"| 時点 | {refs.get('before', '?')} | {refs.get('after', '?')} |")
    cells = {label: (len(t), sum(len(x[1]) for x in t), s, f) for label, (t, s, f) in data.items()}
    for i, name in enumerate(("応答の本数", "文字数", "Skill を起動した本数", "失敗した本数")):
        print(f"| {name} | {cells['before'][i]} | {cells['after'][i]} |")
    counted = {label: count([x[1] for x in data[label][0]], patterns) for label in LABELS}
    for (pid, b_hits, b_docs), (_, a_hits, a_docs) in zip(counted["before"], counted["after"]):
        print(f"| {pid}(件数 / 含む本数) | {b_hits} / {b_docs} | {a_hits} / {a_docs} |")


def self_check():
    stream = "\n".join([
        json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Skill"}]}}),
        "壊れた行",
        json.dumps({"type": "result", "is_error": False, "result": "超えるかもしれません。"}),
    ])
    assert parse_stream(stream) == ("超えるかもしれません。", True)
    assert parse_stream(json.dumps({"type": "result", "is_error": True, "result": "x"})) == (None, False)
    rows = count(["超えるかもしれません。遅れるかもしれない。", "言い切ります。"], [{"id": "k", "regex": "かもしれ"}])
    assert rows == [("k", 2, 1)]
    print("ok")


def main():
    if "--self-check" in sys.argv:
        return self_check()
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("run", "report"):
        p = sub.add_parser(name)
        p.add_argument("--patterns", required=True)
        p.add_argument("--out", required=True)
        p.add_argument("--show")
        if name == "run":
            p.add_argument("--before", required=True)
            p.add_argument("--after", required=True)
            p.add_argument("--prompts", required=True)
            p.add_argument("--models", default="opus,sonnet")
            p.add_argument("--runs", type=int, default=2)
            p.add_argument("--workers", type=int, default=6)
            p.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()
    (run if args.cmd == "run" else report)(args)


if __name__ == "__main__":
    main()
