#!/usr/bin/env python3
"""codiel の run 1 回が消費したトークンを、Claude Code の transcript から集計する。

使い方:
  codiel_run_usage.py --project-dir ~/.claude/projects/<変換名> --session <id> [--session <id> ...] [--json]
  codiel_run_usage.py --self-check
"""
import argparse
import json
import os
import re
import shlex
import sys
import tempfile
from collections import OrderedDict

KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
PARALLEL = "test-spec+dev-plan"
PHASE_VERBS = r"(start-phase|complete-phase|pass-gate|skip-phase|wait-add|finalize)\b([^\n;&|]*)"
HEREDOC = re.compile(r"(<<-?[ \t]*(['\"]?)(\w+)\2[^\n]*)\n.*?\n[ \t]*\3[ \t]*(?=\n|$)", re.S)
ASSIGN = re.compile(r"(?:^|[\s;&|(])(\w+)=(?:\"([^\"\n]*)\"|'([^'\n]*)'|([^\s;&|'\"]*))")
READ_CMDS = {"cat", "head", "tail", "sed", "less", "more", "nl"}
VALUE_OPTS = {"head": {"-n", "-c"}, "tail": {"-n", "-c"}, "sed": {"-e", "-f"}}


def shell_text(cmd):
    """heredoc の本文を除く。本文はファイルへ書く文章で、コマンドとしては実行されない。"""
    return HEREDOC.sub(r"\1", cmd)


def shell_vars(text):
    """コマンドの中の NAME=値 の代入。引用符は外す。"""
    return {m.group(1): next(g for g in m.groups()[1:] if g is not None) for m in ASSIGN.finditer(text)}


def phase_cmds(cmd):
    """codiel-state.mjs の呼び出しを、S="node .../codiel-state.mjs" と置いた変数経由($S)の分も含めて順に返す。"""
    text = shell_text(cmd)
    heads = [r"codiel-state\.mjs"] + [
        r"\$%s\b|\$\{%s\}" % (k, k) for k, v in shell_vars(text).items() if "codiel-state.mjs" in v
    ]
    return re.finditer(r"(?:%s)\s+%s" % ("|".join(heads), PHASE_VERBS), text)


def bash_reads(cmd):
    """Bash の cat・head・tail・sed などが読んだファイル。同じコマンドの中の変数の代入は展開する。"""
    text = shell_text(cmd)
    env = shell_vars(text)
    lex = shlex.shlex(text.replace("\n", ";"), posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    try:
        toks = list(lex)
    except ValueError:
        return []
    out, seg, skip = [], [], False
    for t in toks + [";"]:
        if skip:
            skip = False
        elif t and set(t) <= set("();<>|&"):
            if "<" in t or ">" in t:  # リダイレクトの先(と 2>&1 の 2)は引数ではない
                skip = True
                if seg and seg[-1].isdigit():
                    seg.pop()
                continue
            out += seg_reads(seg, env)
            seg = []
        else:
            seg.append(t)
    return out


def seg_reads(seg, env):
    while seg and re.match(r"\w+=", seg[0]):
        seg = seg[1:]
    name = os.path.basename(seg[0]) if seg else ""
    if name not in READ_CMDS or (name == "sed" and any(t.startswith("-i") for t in seg)):
        return []
    files, script, it = [], name == "sed", iter(seg[1:])
    for t in it:
        if t in VALUE_OPTS.get(name, ()):
            next(it, None)
            script = script and t != "-e" and t != "-f"
        elif t.startswith("-"):
            continue
        elif script:
            script = False  # sed の最初の位置引数はスクリプト
        else:
            files.append(re.sub(r"\$\{?(\w+)\}?", lambda m: env.get(m.group(1), m.group(0)), t))
    return files


def zero():
    return dict.fromkeys(KEYS, 0)


def add(a, u):
    for k in KEYS:
        a[k] += u.get(k) or 0


def total(u):
    return sum(u.values())


def read_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def blocks(row):
    c = (row.get("message") or {}).get("content")
    return c if isinstance(c, list) else []


def user_text(row):
    c = (row.get("message") or {}).get("content")
    if isinstance(c, str):
        return c
    return "".join(b.get("text", "") for b in c if b.get("type") == "text") if isinstance(c, list) else ""


def result_text(block):
    c = block.get("content")
    if isinstance(c, list):
        return "".join(x.get("text", "") for x in c if isinstance(x, dict))
    return c if isinstance(c, str) else ""


def dedupe_usage(rows):
    """message.id ごとに最後の行の (timestamp, usage) を採る。id の無い行は除く。"""
    out = OrderedDict()
    for r in rows:
        m = r.get("message") or {}
        if r.get("type") == "assistant" and m.get("id") and m.get("usage"):
            out[m["id"]] = (r.get("timestamp", ""), m["usage"])
    return list(out.values())


def find_interval(rows):
    start = end = None
    for r in rows:
        if r.get("type") == "user" and start is None and re.search(
            r"<command-name>/codiel:run</command-name>|^\s*/codiel:run\b", user_text(r)
        ):
            start = r.get("timestamp")
        if start and end is None:
            for b in blocks(r):
                if b.get("type") == "tool_use" and b.get("name") == "Bash" and any(
                    m.group(1) == "finalize" and "--slug" in m.group(2) for m in phase_cmds(b["input"].get("command", ""))
                ):
                    end = r.get("timestamp")
    return start, end


def parse_wait(cmd_args, res, phase_now):
    """wait-add の引数と結果の出力から (id, phase, taskId) を復元する。出力は tail などで欠けうる。"""
    m = re.search(r"--id\s+(\S+)", cmd_args)
    wid = m.group(1).strip("'\"") if m else None
    m = re.search(r"--task-id\s+(\S+)", cmd_args)
    task = m.group(1).strip("'\"") if m else None
    phase = None
    try:
        for w in json.loads(res)["state"]["waits"]:
            if w.get("id") == wid:
                phase, task = w.get("phase") or phase, w.get("taskId") or task
    except (ValueError, KeyError, TypeError):
        m = re.search(r'"id":\s*"%s".{0,600}?"phase":\s*"([^"]*)"' % re.escape(wid or "\0"), res, re.S)
        phase = m.group(1) if m else None
    return {"id": wid, "phase": phase or phase_now or "未分類", "taskId": task}


def label(started, done, cur):
    if {"test-spec", "dev-plan"} <= started and not {"test-spec", "dev-plan"} <= done:
        return PARALLEL
    return cur or "(最初の start-phase 前)"


def analyze_session(project_dir, sid, state):
    rows = read_jsonl(os.path.join(project_dir, sid + ".jsonl"))
    start, end = find_interval(rows)
    if not start:
        return None
    end = end or "9999"
    results = {b["tool_use_id"]: result_text(b) for r in rows for b in blocks(r) if b.get("type") == "tool_result"}
    waits, reads = [], []
    spawned = {}  # Agent の tool_use id -> (フェーズ, description)。tool_use の時点のフェーズ
    started, done, cur = state  # 前のセッションからの引き継ぎ(resume した run 用)
    segs = [("", label(started, done, cur))]  # (この時刻より後の行に適用, ラベル)
    for r in rows:
        ts = r.get("timestamp", "")
        if r.get("type") != "assistant" or not (start <= ts <= end):
            continue
        for b in blocks(r):
            if b.get("type") == "tool_use" and b.get("name") == "Read":
                reads.append((ts, b["input"].get("file_path", "")))
            if b.get("type") == "tool_use" and b.get("name") == "Agent":
                spawned[b["id"]] = (label(started, done, cur), b["input"].get("description", ""))
            if b.get("type") != "tool_use" or b.get("name") != "Bash":
                continue
            reads += [(ts, p + "  (Bash)") for p in bash_reads(b["input"].get("command", ""))]
            for m in phase_cmds(b["input"].get("command", "")):
                verb, args = m.group(1), m.group(2)
                if verb == "wait-add":
                    waits.append(parse_wait(args, results.get(b["id"], ""), cur))
                    continue
                arg = re.match(r"\s+([a-z][\w-]*)", args)
                if not arg:
                    continue
                if verb == "start-phase":
                    started.add(arg.group(1))
                    cur = arg.group(1)
                else:
                    done.add(arg.group(1))
                segs.append((ts, label(started, done, cur)))

    def seg_of(ts):
        lab = segs[0][1]
        for t, l in segs:
            if t and ts > t:
                lab = l
        return lab

    by_phase, read_by = OrderedDict(), OrderedDict()
    for ts, u in dedupe_usage(r for r in rows if not r.get("isSidechain")):
        if start <= ts <= end:
            add(by_phase.setdefault(seg_of(ts), zero()), u)
    for ts, p in reads:
        lst = read_by.setdefault(seg_of(ts), [])
        if p not in lst:
            lst.append(p)
    by_agent = {}  # Agent の tool_result の agentId -> (フェーズ, description)
    for tid, sp in spawned.items():
        m = re.search(r"agentId:\s*(\w+)", results.get(tid, ""))
        if m:
            by_agent[m.group(1)] = sp
    agents = OrderedDict()
    sub_dir = os.path.join(project_dir, sid, "subagents")
    if os.path.isdir(sub_dir):
        for fn in sorted(os.listdir(sub_dir)):
            m = re.fullmatch(r"agent-(.+)\.jsonl", fn)
            if not m:
                continue
            u = zero()
            for ts, uu in dedupe_usage(read_jsonl(os.path.join(sub_dir, fn))):
                if start <= ts <= end:
                    add(u, uu)
            agents[m.group(1)] = u
    return {"orch": by_phase, "reads": read_by, "waits": waits, "agents": agents, "by_agent": by_agent, "state": (started, done, cur)}


def aggregate(project_dir, sessions):
    tot, phases, deleg, reads = zero(), OrderedDict(), [], OrderedDict()
    orch = zero()
    missing = []
    state = (set(), set(), None)
    for sid in sessions:
        r = analyze_session(project_dir, sid, state)
        if r is None:
            missing.append(sid)
            continue
        state = r["state"]
        for p, u in r["orch"].items():
            add(phases.setdefault(p, zero()), u)
            add(orch, u)
        for p, lst in r["reads"].items():
            reads.setdefault(p, []).extend(x for x in lst if x not in reads.get(p, []))
        by_task = {w["taskId"]: w for w in r["waits"] if w["taskId"]}
        for aid, u in r["agents"].items():
            w = by_task.get(aid)
            sp = r["by_agent"].get(aid)  # 主: Agent の呼び出し時点のフェーズ。無ければ wait-add の復元
            ph = sp[0] if sp else w["phase"] if w else "未分類"
            add(phases.setdefault(ph, zero()), u)
            wid = w["id"] if w else sp[1] or None if sp else None
            deleg.append({"session": sid, "agentId": aid, "waitId": wid, "phase": ph, "usage": u})
    for d in deleg:
        add(tot, d["usage"])
    add(tot, orch)
    return {
        "total": tot,
        "orchestrator": orch,
        "phases": phases,
        "delegations": deleg,
        "review_delegations": sum(1 for d in deleg if d["phase"] == "review"),
        "reads": reads,
        "sessions_without_interval": missing,
    }


def render(res):
    def row(name, u):
        return "%-34s" % name + "".join("%14d" % u[k] for k in KEYS) + "%14d" % total(u)

    head = "%-34s" % "" + "".join("%14s" % k[:13] for k in KEYS) + "%14s" % "sum"
    out = ["== 合計 ==", head, row("total", res["total"]), row("orchestrator のみ", res["orchestrator"]),
           "", "== フェーズ別(オーケストレーター+委譲先) ==", head]
    out += [row(p, u) for p, u in res["phases"].items()]
    out += ["", "== 委譲別 ==", head]
    out += [row("%s [%s/%s]" % (d["agentId"], d["phase"], d["waitId"] or "-"), d["usage"]) for d in res["delegations"]]
    out += ["", "review に割り振られた委譲の数: %d" % res["review_delegations"], "", "== フェーズ区間ごとの Read((Bash) は Bash の cat・sed などで読んだ分) =="]
    for p, lst in res["reads"].items():
        out.append("[%s]" % p)
        out += ["  " + x for x in lst]
    if res["sessions_without_interval"]:
        out += ["", "区間(/codiel:run の user 行)が見つからないセッション: " + ", ".join(res["sessions_without_interval"])]
    return "\n".join(out)


def self_check():
    def u(i, c, r, o):
        return {"input_tokens": i, "cache_creation_input_tokens": c, "cache_read_input_tokens": r, "output_tokens": o}

    def asst(ts, mid, usage, content):
        return {"type": "assistant", "timestamp": ts, "message": {"id": mid, "usage": usage, "content": content}}

    def bash(tid, cmd):
        return {"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": cmd}}

    def res(ts, tid, text):
        return {"type": "user", "timestamp": ts, "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": text}]}}

    cs = "node X/codiel-state.mjs "
    full = json.dumps({"state": {"waits": [{"id": "w-spec", "phase": "test-spec", "taskId": "aSPEC"}]}})
    main = [
        {"type": "user", "timestamp": "T01", "message": {"content": "<command-name>/codiel:run</command-name>"}},
        asst("T02", "m1", u(1, 0, 0, 1), [bash("t1", cs + "start-phase test-spec --slug s")]),
        asst("T03", "m2", u(1, 10, 100, 1), [{"type": "text", "text": "x"}]),  # 同じ id の 2 行
        asst("T04", "m2", u(2, 20, 200, 2), [bash("t2", cs + "wait-add --slug s --id w-spec --purpose p --task-id aSPEC; " + cs + "start-phase dev-plan --slug s")]),
        res("T04", "t2", full),
        asst("T05", "m3", u(3, 0, 300, 3), [bash("t3", cs + "wait-add --slug s --id w-plan --purpose p")]),  # taskId なし、出力は欠ける
        res("T05", "t3", '        "taskId": "none"\n      }\n    ]\n  }\n}\n'),
        asst("T06", "m4", u(4, 0, 400, 4), [
            {"type": "tool_use", "id": "r1", "name": "Read", "input": {"file_path": "/a.md"}},
            bash("t4", cs + "pass-gate dev-plan --slug s"),
            # Bash で読んだファイル。パイプの先・リダイレクトの先・sed のスクリプト・heredoc で書く先は数えない
            bash("t4b", "P=/p && cat $P/b.md 2>/dev/null | head -3 && sed -n 1,5p /d.md; tail -n 20 /f.log\ncat > /e.md <<'EOF'\ncat /no.md\nEOF"),
        ]),
        asst("T07", "m5", u(5, 0, 500, 5), [bash("t5", cs + "wait-done --id w-spec --slug s; " + cs + "pass-gate test-spec --slug s")]),  # wait-done 後
        # 変数に置いた codiel-state.mjs 経由の呼び出し。heredoc の本文に書いた呼び出しは数えない
        asst("T08", "m6", u(6, 0, 600, 6), [bash("t6", 'S="' + cs.strip() + "\" && cat > w.md <<'EOF'\n" + cs + "start-phase bogus --slug s\nEOF\n$S start-phase review --slug s")]),
        asst("T09", "m7", u(7, 0, 700, 7), [
            bash("t7", cs + "wait-add --slug s --id w-rev --purpose p --task-id aREV"),
            {"type": "tool_use", "id": "ag1", "name": "Agent", "input": {"description": "loop review"}},
            bash("t9", 'for pair in "x aLOOP"; do set -- $pair; ' + cs + "wait-add --slug s --id review-1-$1 --purpose p --task-id $2; done"),
        ]),
        res("T09", "ag1", [{"type": "text", "text": "Async agent launched.\nagentId: aLOOP (internal ID)"}]),
        res("T09", "t9", "ok"),
        res("T09", "t7", '"phase": "review", "taskId": "aREV"'),
        asst("T10", "m8", u(8, 0, 800, 8), [bash("t8", 'S="' + cs.strip() + '" && $S finalize --slug s')]),
        asst("T11", "m9", u(99, 99, 99, 99), []),  # 区間の外
    ]

    def sub(ts_usage):
        return [asst(ts, "s" + ts, uu, []) for ts, uu in ts_usage]

    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "S", "subagents"))
        write = lambda p, rows: open(os.path.join(d, p), "w", encoding="utf-8").write("\n".join(json.dumps(r) for r in rows))
        write("S.jsonl", main)
        write("S/subagents/agent-aSPEC.jsonl", sub([("T03", u(10, 0, 0, 0))]))
        write("S/subagents/agent-aNONE.jsonl", sub([("T03", u(0, 20, 0, 0))]))  # 待ちが無い委譲
        write("S/subagents/agent-aREV.jsonl", sub([("T09", u(0, 0, 30, 0))]))
        write("S/subagents/agent-aLOOP.jsonl", sub([("T09", u(0, 0, 0, 50))]))  # wait-add の引数が変数で復元できない委譲先
        write("S/subagents/agent-aNOTASK.jsonl", sub([("T05", u(0, 0, 0, 40))]))  # taskId の無い待ちの委譲先
        r = aggregate(d, ["S"])
    ph = r["phases"]
    # T02 の応答は開始前、T03(m2 は最後の行 T04 の usage)から start-phase test-spec の後
    assert ph["(最初の start-phase 前)"]["input_tokens"] == 1, ph
    assert ph["test-spec"]["cache_read_input_tokens"] == 200 and ph["test-spec"]["input_tokens"] == 2 + 10, ph  # 重複除去と委譲
    assert ph["test-spec"]["cache_creation_input_tokens"] == 20, ph
    assert ph[PARALLEL]["cache_read_input_tokens"] == 300 + 400 + 500, ph  # pass-gate test-spec を呼ぶ応答までが並列区間
    assert ph["dev-plan"]["cache_read_input_tokens"] == 600, ph  # 並列の後、start-phase review を呼ぶ応答まで
    assert ph["review"]["cache_read_input_tokens"] == 700 + 800 + 30 and r["review_delegations"] == 2, ph
    assert ph["review"]["output_tokens"] == 7 + 8 + 50 and "aLOOP" in {x["agentId"] for x in r["delegations"] if x["phase"] == "review"}, ph
    assert ph["未分類"]["cache_creation_input_tokens"] == 20 and ph["未分類"]["output_tokens"] == 40, ph
    assert ph["review"]["input_tokens"] == 7 + 8, ph
    assert r["total"]["input_tokens"] == 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 10, r["total"]
    assert "T11" not in json.dumps(r) and 99 not in r["total"].values()
    assert {x["agentId"]: x["waitId"] for x in r["delegations"]}["aSPEC"] == "w-spec"
    assert {x["agentId"]: x["waitId"] for x in r["delegations"]}["aLOOP"] == "loop review"
    assert r["reads"][PARALLEL] == ["/a.md", "/p/b.md  (Bash)", "/d.md  (Bash)", "/f.log  (Bash)"], r["reads"]
    assert "bogus" not in ph, ph
    print("self-check OK")
    print(render(r))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project-dir")
    ap.add_argument("--session", action="append", default=[])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()
    if not a.project_dir or not a.session:
        ap.error("--project-dir と --session が必要です")
    res = aggregate(os.path.expanduser(a.project_dir), a.session)
    print(json.dumps(res, ensure_ascii=False, indent=2) if a.json else render(res))
    return 1 if res["sessions_without_interval"] and not res["phases"] else 0


if __name__ == "__main__":
    sys.exit(main())
