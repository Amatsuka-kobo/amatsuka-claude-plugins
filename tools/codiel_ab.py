#!/usr/bin/env python3
"""codiel の 2 つの時点で同じ題材の run を人なしで回し、結果を比べる。

使い方:
  codiel_ab.py run --before <ref> --after <ref|WORKTREE> --out <dir> --answers <json>
                   [--bench ~/codiel-cost-bench] [--start 0f23d8d] [--intent docs/intents/2026-10-02-todo-title-search.md]
                   [--scale 標準|軽量] [--models sonnet,opus] [--runs 1]
                   [--idle-minutes 45] [--max-hours 8] [--max-replies 80]
  codiel_ab.py judge --out <dir> --prompt <md> [--model opus] [--reps 2] [--timeout 1800]
  codiel_ab.py report --out <dir> --contracts <json> [--ledger <jsonl> --title <題>]
  codiel_ab.py ledger --ledger <jsonl>
  codiel_ab.py --self-check

run は題材のリポジトリを <out>/work の下へ複製して使い、元の題材には書き込まない。
run は 1 本ずつ順に回す。終わった run は採り直さないので、中断した採取は同じ引数で続けられる。
人への質問には --answers の規則で答え、codiel の hook が出す許可の確認は拒否して数える。
"""
import argparse
import hashlib
import json
import os
import queue
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import codiel_run_usage as usage  # noqa: E402

PLUGIN = "plugins/codiel"
LABELS = ("before", "after")
NAMES = {"before": "改修前", "after": "改修後"}
META = "meta.json"
TERMINAL = {"awaiting_outcome", "completed", "stopped", "rejected"}
SEVERITIES = ("critical", "high", "medium", "low")
PROXY_TEXT = (
    "これは自動実行で、人は応答しません。あなたの推奨で続けてください。"
    "推奨が無いときは、run を止めずに進む選択肢を選んでください。"
    "起票するか見送るかを選ぶ場面では、すべて見送ってください。"
)
NUDGE_TEXT = "run はまだ finalize まで終わっていません。続きから進めてください。"
DENY_TEXT = "自動実行中のため、hook が確認を求めた操作は許可されません。指示書に沿った別の方法で進めてください。"


def git(cwd, *args, check=True):
    out = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if check and out.returncode:
        sys.exit(f"git {' '.join(args)} が失敗した: {out.stderr.strip()}")
    return out.stdout


def repo_root():
    return Path(git(Path(__file__).parent, "rev-parse", "--show-toplevel").strip())


def resolve(ref):
    """ブランチ名や HEAD を、再実行しても動かないコミットに直す。"""
    if ref == "WORKTREE":
        return ref
    return git(repo_root(), "rev-parse", "--verify", f"{ref}^{{commit}}").strip()


def export_plugin(ref, dest):
    """ref の時点の codiel を dest に複製する。WORKTREE は作業ツリーをそのまま写す。"""
    dest.mkdir(parents=True)
    root = repo_root()
    if ref == "WORKTREE":
        shutil.copytree(root / PLUGIN, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules"))
        return
    archive = subprocess.run(["git", "-C", str(root), "archive", ref, PLUGIN], capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", str(dest), "--strip-components=2"], input=archive.stdout, check=True)


def prepare_bench(bench, start, work):
    """題材を work へ複製し、開始コミットの状態に戻す。scripts/reset-cost-bench.sh と同じ手順を複製に当てる。"""
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(bench, work, symlinks=True)
    git(work, "worktree", "prune")
    git(work, "checkout", "-q", "-f", "main")
    git(work, "reset", "-q", "--hard", start)
    for branch in git(work, "for-each-ref", "--format=%(refname:short)", "refs/heads").split():
        if branch != "main":
            git(work, "branch", "-q", "-D", branch)
    git(work, "clean", "-q", "-fdx", "-e", "node_modules")
    for sub in ("runs", "reports"):
        (work / ".codiel" / sub).mkdir(parents=True, exist_ok=True)


def read_state(work):
    """複製した題材の中で、最後に更新された run の state を返す。無ければ None。"""
    files = sorted((work / ".codiel" / "runs").glob("*/try-*/state.json"), key=lambda p: p.stat().st_mtime)
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text())
    except ValueError:
        return None


def answer(questions, rules, scale):
    """AskUserQuestion の質問ごとに、規則で選んだラベルと、当たった規則の id を返す。

    規則は上から順に見る。when が選択肢のラベルのどれかに当たり、pick に当たるラベルがある最初の規則を使う。
    どの規則にも当たらない質問は、先頭の選択肢で答えて unmatched と記録する。
    """
    answers, log = {}, []
    for q in questions:
        labels = [o["label"] for o in q.get("options", [])]
        chosen = rule_id = None
        for rule in rules:
            pick = rule["pick"].replace("{scale}", re.escape(scale))
            if not any(re.search(rule["when"], label) for label in labels):
                continue
            hit = next((label for label in labels if re.search(pick, label)), None)
            if hit:
                chosen, rule_id = hit, rule["id"]
                break
        if chosen is None:
            chosen, rule_id = (labels[0] if labels else ""), "unmatched"
        answers[q["question"]] = chosen
        log.append({"kind": "question", "rule": rule_id, "question": q["question"], "labels": labels, "answer": chosen})
    return answers, log


def decide(state):
    """ターンが終わったときの state から、次の動きを決める。done / wait / proxy / nudge のどれかを返す。"""
    if state is None:
        return "proxy"  # run を作る前の確認は state が無い
    if state.get("status") in TERMINAL:
        return "done"
    if state.get("status") == "awaiting_human":
        return "proxy"
    return "wait" if state.get("waits") else "nudge"


def drive(job, rules, args):
    """run を 1 本回し、終わり方を返す。標準出力の全行と、代理で答えた記録を run のディレクトリに残す。"""
    run_dir, work, plugin = job["dir"], job["work"], job["plugin"]
    cmd = [
        "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--permission-prompt-tool", "stdio", "--plugin-dir", str(plugin),
        "--setting-sources", "project", "--model", job["model"],
    ]
    # 起動は claude の PATH と認証をそのまま使う。hook とサブエージェントの上限は既定のままにする
    proc = subprocess.Popen(cmd, cwd=work, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = queue.Queue()

    def pump():
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)  # 出力の終わり

    threading.Thread(target=pump, daemon=True).start()
    stream, proxy = (run_dir / "stream.jsonl").open("w"), (run_dir / "proxy.jsonl").open("w")
    info = {"session": None, "plugins": [], "replies": 0, "results": 0, "end": None}

    def send(obj):
        try:
            proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, ValueError):
            pass

    def say(text, kind):
        info["replies"] += 1
        proxy.write(json.dumps({"kind": kind, "text": text}, ensure_ascii=False) + "\n")
        proxy.flush()
        send({"type": "user", "message": {"role": "user", "content": text}, "parent_tool_use_id": None})

    def permit(event):
        req = event["request"]
        if req.get("subtype") != "can_use_tool":
            return {}
        tool, tool_input = req.get("tool_name"), req.get("input") or {}
        if tool == "AskUserQuestion":
            answers, log = answer(tool_input.get("questions", []), rules, args.scale)
            for row in log:
                proxy.write(json.dumps(row, ensure_ascii=False) + "\n")
            info["replies"] += 1
            proxy.flush()
            return {"behavior": "allow", "updatedInput": dict(tool_input, answers=answers)}
        if req.get("decision_reason_type") == "hook":
            row = {"kind": "hook-ask", "tool": tool, "reason": req.get("decision_reason"),
                   "target": tool_input.get("file_path") or str(tool_input.get("command", ""))[:300]}
            proxy.write(json.dumps(row, ensure_ascii=False) + "\n")
            proxy.flush()
            return {"behavior": "deny", "message": DENY_TEXT}
        return {"behavior": "allow", "updatedInput": tool_input}

    send({"type": "user", "message": {"role": "user", "content": f"/codiel:run {args.intent}"}, "parent_tool_use_id": None})
    deadline, idle_hits = time.time() + args.max_hours * 3600, 0
    while info["end"] is None:
        try:
            line = lines.get(timeout=args.idle_minutes * 60)
        except queue.Empty:
            # 委譲先の完了待ちで黙ることがある。1 度だけ促し、次も黙っていたら打ち切る
            idle_hits += 1
            if idle_hits > 1:
                info["end"] = "idle"
            else:
                say(NUDGE_TEXT, "nudge")
            continue
        if line is None:
            info["end"] = "exited"
            break
        stream.write(line)
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        idle_hits = 0
        kind = event.get("type")
        if kind == "system" and event.get("subtype") == "init":
            info["session"], info["plugins"] = event.get("session_id"), event.get("plugins") or []
        elif kind == "control_request":
            send({"type": "control_response", "response": {
                "subtype": "success", "request_id": event.get("request_id"), "response": permit(event)}})
        elif kind == "result":
            info["results"] += 1
            step = decide(read_state(work))
            if step == "done":
                info["end"] = "finished"
            elif step != "wait":
                say(PROXY_TEXT if step == "proxy" else NUDGE_TEXT, "text" if step == "proxy" else "nudge")
        if info["end"] is None and time.time() > deadline:
            info["end"] = "max-hours"
        if info["end"] is None and info["replies"] > args.max_replies:
            info["end"] = "max-replies"
    try:
        proc.stdin.close()
    except OSError:
        pass
    try:
        # 終わった run は残りの出力を待つ。打ち切った run はすぐ止める
        proc.wait(timeout=900 if info["end"] == "finished" else 5)
    except subprocess.TimeoutExpired:
        proc.terminate()
    while True:
        try:
            line = lines.get_nowait()
        except queue.Empty:
            break
        if line:
            stream.write(line)
    stream.close()
    proxy.close()
    return info


def transcript_dir(work):
    """Claude Code が transcript を置くディレクトリ。パスの英数字以外を - に置き換えた名前になる。"""
    return Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(work.resolve()))


def snapshot(job, info, args, started):
    """run の記録を run のディレクトリへ写す。複製した題材と Raguel の記録は、次の run の前に消えるため。"""
    run_dir, work = job["dir"], job["work"]
    copy = lambda src, name: shutil.copytree(src, run_dir / name, dirs_exist_ok=True) if src.is_dir() else None
    copy(work / ".codiel" / "runs", "codiel-runs")
    config = json.loads((work / ".codiel" / "config.json").read_text())
    copy(work / config.get("runsDir", "docs/codiel/runs"), "docs-runs")
    copy(work / config.get("testsDir", "docs/codiel/tests"), "docs-tests")
    copy(work / "docs" / "intents", "docs-intents")
    for cases in (Path.home() / ".raguel" / "cases").glob(work.name + "-*"):
        copy(cases, "raguel")
        shutil.rmtree(cases)
    if info["session"]:
        src = transcript_dir(work)
        (run_dir / "transcript").mkdir(exist_ok=True)
        if (src / f"{info['session']}.jsonl").exists():
            shutil.copy(src / f"{info['session']}.jsonl", run_dir / "transcript")
        copy(src / info["session"], f"transcript/{info['session']}")
    start = git(work, "rev-parse", args.start).strip()
    (run_dir / "commits.txt").write_text(git(work, "log", "--all", "--format=%H%x09%s", f"{start}..", check=False))
    branches = [b for b in git(work, "for-each-ref", "--format=%(refname:short)", "refs/heads").split() if b.startswith("codiel/")]
    tip = sorted(branches, key=len)[0] if branches else "main"
    (run_dir / "diff.patch").write_text(git(work, "diff", start, tip, "--", ".", ":!docs/codiel", ":!.codiel", check=False))
    plugin = next((p for p in info["plugins"] if p.get("name") == "codiel"), None)
    state = read_state(work)
    meta = {
        "label": job["label"], "model": job["model"], "n": job["n"], "session": info["session"],
        "end": info["end"], "seconds": round(time.time() - started), "results": info["results"],
        # 複製した codiel を読んだことを確かめる。インストール済みの codiel を読んだ run は比較に使えない
        "pluginOk": bool(plugin) and Path(plugin.get("path", "")).resolve() == job["plugin"].resolve(),
        "plugins": [p.get("name") for p in info["plugins"]],
        "typesafeKey": bool(os.environ.get("TYPESAFE_API_KEY")),
        "status": (state or {}).get("status"),
    }
    (run_dir / "run.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    shutil.rmtree(work, ignore_errors=True)
    return meta


def run(args):
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    rules = json.loads(Path(args.answers).read_text())
    models = [m for m in args.models.split(",") if m]
    meta = {"before": resolve(args.before), "after": resolve(args.after), "scale": args.scale, "models": models,
            "runs": args.runs, "start": args.start, "intent": args.intent, "bench": str(Path(args.bench).expanduser()),
            "answers": hashlib.sha256(Path(args.answers).read_bytes()).hexdigest()[:12]}
    meta_path = out / META
    if meta_path.exists():
        old = json.loads(meta_path.read_text())
        if {k: old.get(k) for k in meta} != meta:
            sys.exit(f"{out} は別の条件で採取済みである。新しい --out を使う")
    else:
        meta["created"] = datetime.now().strftime("%Y-%m-%d")
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
        for label in LABELS:
            export_plugin(meta[label], out / "plugin" / label)
    # 前後を交互に回し、時間帯による偏りが片方に寄らないようにする
    jobs = [{"label": label, "model": model, "n": n, "plugin": out / "plugin" / label,
             "dir": out / "runs" / label / f"{model}-{n}", "work": out / "work" / f"cab-{out.name}-{label}-{model}-{n}"}
            for n in range(1, args.runs + 1) for model in models for label in LABELS]
    for job in jobs:
        name = f"{NAMES[job['label']]} {job['model']}-{job['n']}"
        if (job["dir"] / "run.json").exists():
            print(f"skip {name}", flush=True)
            continue
        if job["dir"].exists():
            shutil.rmtree(job["dir"])
        job["dir"].mkdir(parents=True)
        prepare_bench(Path(meta["bench"]), args.start, job["work"])
        started = time.time()
        print(f"start {name} {datetime.now():%H:%M}", flush=True)
        info = drive(job, rules, args)
        done = snapshot(job, info, args, started)
        print(f"end {name} {done['end']} status={done['status']} {done['seconds'] // 60}分 pluginOk={done['pluginOk']}", flush=True)
    print("採取が終わった。report で表を出す", flush=True)


# ---- 集計 ----

def jsonl(path):
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def contexts(path):
    """オーケストレーターの 1 ターンごとのコンテキストの大きさを返す。同じ message.id は最後の行を採る。"""
    seen = {}
    for row in jsonl(path):
        message = row.get("message") or {}
        u = message.get("usage")
        if row.get("type") == "assistant" and not row.get("isSidechain") and message.get("id") and u:
            seen[message["id"]] = sum(u.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return list(seen.values())


def findings(text):
    """review のレポートから、重大度ごとの所見の数を返す。所見は「### [重大度] 要約」の見出しで数える。"""
    found = re.findall(r"^### \[(critical|high|medium|low)\]", text, re.M)
    return {s: found.count(s) for s in SEVERITIES}


def check_contracts(run_dir, contracts):
    """契約として残した書式を検査し、破った契約の id と対象を返す。"""
    broken = []
    for c in contracts:
        if c["target"] == "commits":
            texts = [(line.split("\t", 1)[1], line.split("\t", 1)[1]) for line in (run_dir / "commits.txt").read_text().splitlines() if "\t" in line]
        else:
            texts = [(str(p.relative_to(run_dir)), p.read_text(errors="replace")) for p in sorted(run_dir.glob(c["target"])) if p.is_file()]
        for name, text in texts:
            if re.search(c.get("skip", r"(?!)"), text):
                continue
            ok = all(re.search(r, text, re.M) for r in c.get("require", [])) and not any(re.search(r, text, re.M) for r in c.get("forbid", []))
            if not ok:
                broken.append(f"{c['id']}: {name}")
    return broken


def measure(run_dir, contracts):
    """run 1 本の指標を返す。採れなかった指標は None にする。"""
    meta = json.loads((run_dir / "run.json").read_text())
    states = sorted(run_dir.glob("codiel-runs/*/try-*/state.json"))
    state = json.loads(states[-1].read_text()) if states else {}
    phases = state.get("phases") or {}
    m = {"有効な run": int(meta["pluginOk"]), "finalize まで完走": int((phases.get("finalize") or {}).get("status") == "passed"),
         "通過したフェーズ数": sum(1 for p in phases.values() if p.get("status") == "passed"),
         "所要時間(分)": round(meta["seconds"] / 60)}
    tokens = turns = median = None
    if meta["session"] and (run_dir / "transcript" / f"{meta['session']}.jsonl").exists():
        ctx = contexts(run_dir / "transcript" / f"{meta['session']}.jsonl")
        turns, median = len(ctx), (round(statistics.median(ctx)) if ctx else None)
        try:
            tokens = usage.total(usage.aggregate(str(run_dir / "transcript"), [meta["session"]])["total"])
        except Exception:  # 区間が見つからない transcript は合計を出せない
            tokens = None
    m.update({"合計トークン": tokens or None, "ターン数": turns, "1ターンのコンテキスト(中央値)": median})
    verdicts = [e.get("verdict") for e in jsonl(next(iter(run_dir.glob("raguel/evaluations.jsonl")), run_dir / "none"))]
    m.update({"Raguel の評価回数": len(verdicts), "Raguel の ASK": verdicts.count("ASK"), "Raguel の STOP": verdicts.count("STOP"),
              "test-loop の修正回数": (phases.get("test-loop") or {}).get("attempts"),
              "fix-loop の修正回数": (phases.get("fix-loop") or {}).get("attempts")})
    reviews = sorted(run_dir.glob("codiel-runs/*/try-*/reports/review-*.md"))
    first = findings(reviews[0].read_text()) if reviews else dict.fromkeys(SEVERITIES)
    m.update({"review の回数": len(reviews), "所見 critical+high(初回)": None if first["critical"] is None else first["critical"] + first["high"],
              "所見 medium+low(初回)": None if first["medium"] is None else first["medium"] + first["low"]})
    proxy = jsonl(run_dir / "proxy.jsonl")
    kinds = [r["kind"] for r in proxy]
    m.update({"代理で答えた質問": kinds.count("question"), "規則に無い質問": sum(1 for r in proxy if r.get("rule") == "unmatched"),
              "平文への代理回答": kinds.count("text"), "続行の促し": kinds.count("nudge"),
              "hook が確認を求めた操作": kinds.count("hook-ask")})
    broken = check_contracts(run_dir, contracts)
    m["契約の違反"] = len(broken)
    return m, {"end": meta["end"], "status": meta["status"], "stopReason": state.get("stopReason"), "broken": broken,
               "unmatched": [r["question"] for r in proxy if r.get("rule") == "unmatched"],
               "hookAsks": [f"{r['tool']} {r['target']}" for r in proxy if r["kind"] == "hook-ask"]}


def judged(out):
    """質の判定の結果を、モデルごと・観点ごとに 改修後の勝ち/改修前の勝ち/引き分け で数える。"""
    tally = {}
    for path in sorted((out / "judge").glob("*/verdict-*.json")):
        v = json.loads(path.read_text())
        model = path.parent.name.rsplit("-", 1)[0]
        for axis, side in v["verdict"].items():
            if axis == "reason":
                continue
            row = tally.setdefault(model, {}).setdefault(axis, [0, 0, 0])
            row[{"after": 0, "before": 1}.get(v["sides"].get(side), 2)] += 1
    return tally


def fmt(values):
    return " / ".join("-" if v is None else str(v) for v in values) or "-"


def mean(values):
    nums = [v for v in values if v is not None]
    return round(statistics.mean(nums), 1) if nums else None


def report(args):
    out = Path(args.out).resolve()
    meta = json.loads((out / META).read_text())
    contracts = json.loads(Path(args.contracts).read_text())
    table, notes, summary = {}, [], {}
    for label in LABELS:
        for run_dir in sorted((out / "runs" / label).glob("*-*")):
            if not (run_dir / "run.json").exists():
                continue
            model = run_dir.name.rsplit("-", 1)[0]
            m, extra = measure(run_dir, contracts)
            for key, value in m.items():
                table.setdefault(model, {}).setdefault(key, {l: [] for l in LABELS})[label].append(value)
            detail = [f"終わり方 {extra['end']}", f"status {extra['status']}"]
            detail += [f"止めた理由 {extra['stopReason']}"] if extra["stopReason"] else []
            for name, items in (("契約の違反", extra["broken"]), ("規則に無い質問", extra["unmatched"]), ("hook が確認を求めた操作", extra["hookAsks"])):
                detail += [f"{name}: " + "; ".join(items)] if items else []
            notes.append(f"- {NAMES[label]} {run_dir.name}: " + "、".join(detail))
    print(f"改修前 {meta['before'][:9]} / 改修後 {meta['after'][:9]} / 規模 {meta['scale']} / 題材 {meta['intent']}\n")
    for model, rows in table.items():
        print(f"### {model}\n\n| 指標 | 改修前 | 改修後 | 平均の差 |\n| --- | --- | --- | --- |")
        for key, by in rows.items():
            b, a = mean(by["before"]), mean(by["after"])
            diff = "-" if a is None or b is None else f"{a - b:+g}"
            print(f"| {key} | {fmt(by['before'])} | {fmt(by['after'])} | {diff} |")
            summary.setdefault(model, {})[key] = {"before": b, "after": a}
        print()
    tally = judged(out)
    if tally:
        print("### 成果物の質(改修後の勝ち / 改修前の勝ち / 引き分け)\n\n| モデル | 観点 | 判定 |\n| --- | --- | --- |")
        for model, axes in tally.items():
            for axis, row in axes.items():
                print(f"| {model} | {axis} | {row[0]} / {row[1]} / {row[2]} |")
        print()
    print("### run ごとの記録\n\n" + "\n".join(notes))
    if args.ledger:
        if not args.title:
            sys.exit("--ledger には --title が要る")
        row = {"date": meta.get("created"), "title": args.title, "before": meta["before"], "after": meta["after"],
               "scale": meta["scale"], "runs": meta["runs"], "metrics": summary, "judge": tally}
        ledger = Path(args.ledger)
        kept = [r for r in jsonl(ledger) if r.get("title") != args.title]
        ledger.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept + [row]))
        print(f"\n台帳に記録した: {args.title}")


LEDGER_KEYS = ("finalize まで完走", "1ターンのコンテキスト(中央値)", "合計トークン", "Raguel の ASK", "所見 critical+high(初回)",
               "hook が確認を求めた操作", "契約の違反")


def ledger(args):
    print("| 日付 | 題 | 規模 | モデル | " + " | ".join(LEDGER_KEYS) + " | 質(総合) |\n" + "| --- " * (len(LEDGER_KEYS) + 5) + "|")
    for row in jsonl(Path(args.ledger)):
        for model, metrics in row["metrics"].items():
            cells = [f"{metrics.get(k, {}).get('before', '-')} → {metrics.get(k, {}).get('after', '-')}" for k in LEDGER_KEYS]
            quality = (row.get("judge") or {}).get(model, {}).get("overall")
            cells.append(" / ".join(map(str, quality)) if quality else "-")
            print(f"| {row['date']} | {row['title']} | {row['scale']} | {model} | " + " | ".join(cells) + " |")


# ---- 質の判定 ----

def judge(args):
    """同じモデル・同じ回の前後の成果物を、どちらが改修後かを伏せて比べさせる。回ごとに左右を入れ替える。"""
    out = Path(args.out).resolve()
    prompt = Path(args.prompt).read_text()
    for before in sorted((out / "runs" / "before").glob("*-*")):
        after = out / "runs" / "after" / before.name
        if not ((before / "run.json").exists() and (after / "run.json").exists()):
            continue
        pair = out / "judge" / before.name
        for rep in range(1, args.reps + 1):
            target = pair / f"verdict-{rep}.json"
            if target.exists():
                continue
            # 名前と回から左右を決める。同じ組でも回が変われば入れ替わる
            flip = (int(hashlib.sha256(before.name.encode()).hexdigest(), 16) + rep) % 2
            sides = {"A": "after" if flip else "before", "B": "before" if flip else "after"}
            work = pair / f"rep-{rep}"
            if work.exists():
                shutil.rmtree(work)
            for side, label in sides.items():
                src = out / "runs" / label / before.name
                for name in ("docs-runs", "docs-tests", "docs-intents"):
                    if (src / name).is_dir():
                        shutil.copytree(src / name, work / side / name)
                shutil.copy(src / "diff.patch", work / side / "diff.patch")
            cmd = ["claude", "-p", prompt, "--model", args.model, "--setting-sources", "project", "--strict-mcp-config",
                   "--allowedTools", "Read,Grep,Glob", "--output-format", "json", "--no-session-persistence"]
            try:
                proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True, timeout=args.timeout)
                verdict = parse_verdict(json.loads(proc.stdout).get("result") or "")
            except (subprocess.TimeoutExpired, ValueError):
                verdict = None
            if verdict is None:
                print(f"判定を採れなかった: {before.name} rep-{rep}", flush=True)
                continue
            target.write_text(json.dumps({"sides": sides, "verdict": verdict}, ensure_ascii=False, indent=2))
            print(f"判定 {before.name} rep-{rep}: " + " ".join(f"{k}={sides.get(v, v)}" for k, v in verdict.items() if k != "reason"), flush=True)


def parse_verdict(text):
    """応答の最後にある JSON を取り出す。各観点の値が A・B・tie のどれかでなければ None を返す。"""
    found = re.findall(r"\{[^{}]*\}", text, re.S)
    for raw in reversed(found):
        try:
            v = json.loads(raw)
        except ValueError:
            continue
        axes = {k: x for k, x in v.items() if k != "reason"}
        if "overall" in axes and all(x in ("A", "B", "tie") for x in axes.values()):
            return v
    return None


def self_check():
    rules = [{"id": "scale", "when": "軽量", "pick": "{scale}"}, {"id": "ask", "when": "このまま承認", "pick": "このまま承認"},
             {"id": "recommended", "when": "推奨", "pick": "推奨"}]
    q = lambda *labels: [{"question": "q", "options": [{"label": x} for x in labels]}]
    assert answer(q("標準", "軽量"), rules, "標準")[0] == {"q": "標準"}
    assert answer(q("修正して再提出", "このまま承認", "中止"), rules, "標準")[1][0]["rule"] == "ask"
    assert answer(q("退避する", "コミットする(推奨)"), rules, "標準")[0] == {"q": "コミットする(推奨)"}
    got = answer(q("赤", "青"), rules, "標準")[1][0]
    assert got["rule"] == "unmatched" and got["answer"] == "赤"
    assert decide(None) == "proxy" and decide({"status": "awaiting_outcome"}) == "done"
    assert decide({"status": "awaiting_human"}) == "proxy"
    assert decide({"status": "active", "waits": [{"id": "w"}]}) == "wait" and decide({"status": "active", "waits": []}) == "nudge"
    assert findings("### [high] a\n### [low] b\n#### [high] c\n### [low] d") == {"critical": 0, "high": 1, "medium": 0, "low": 2}
    assert parse_verdict('前置き {"design": "A", "overall": "tie", "reason": "r"}')["design"] == "A"
    assert parse_verdict('{"overall": "C"}') is None
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        run_dir = Path(d)
        (run_dir / "commits.txt").write_text("a\tcodiel(implement): 検索欄 (slug try-1)\nb\tfix typo\nc\tstep-1 をマージ\n")
        commit = [{"id": "commit", "target": "commits", "skip": "をマージ$", "require": [r"^codiel\([a-z-]+\): .+ \(\S+ try-\d+\)$"]}]
        assert check_contracts(run_dir, commit) == ["commit: fix typo"]
        (run_dir / "design.md").write_text("# d\n(候補: x)\n")
        assert check_contracts(run_dir, [{"id": "cand", "target": "*.md", "forbid": [r"\(候補:"]}]) == ["cand: design.md"]
    print("self-check ok")


def main():
    if sys.argv[1:] == ["--self-check"]:
        return self_check()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run")
    p.add_argument("--before", required=True)
    p.add_argument("--after", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--answers", required=True)
    p.add_argument("--bench", default="~/codiel-cost-bench")
    p.add_argument("--start", default="0f23d8d")
    p.add_argument("--intent", default="docs/intents/2026-10-02-todo-title-search.md")
    p.add_argument("--scale", default="標準", choices=["標準", "軽量"])
    p.add_argument("--models", default="sonnet,opus")
    p.add_argument("--runs", type=int, default=1)
    p.add_argument("--idle-minutes", type=float, default=45)
    p.add_argument("--max-hours", type=float, default=8)
    p.add_argument("--max-replies", type=int, default=80)
    p = sub.add_parser("judge")
    p.add_argument("--out", required=True)
    p.add_argument("--prompt", required=True)
    p.add_argument("--model", default="opus")
    p.add_argument("--reps", type=int, default=2)
    p.add_argument("--timeout", type=int, default=1800)
    p = sub.add_parser("report")
    p.add_argument("--out", required=True)
    p.add_argument("--contracts", required=True)
    p.add_argument("--ledger")
    p.add_argument("--title")
    p = sub.add_parser("ledger")
    p.add_argument("--ledger", required=True)
    args = ap.parse_args()
    {"run": run, "judge": judge, "report": report, "ledger": ledger}[args.cmd](args)


if __name__ == "__main__":
    main()
