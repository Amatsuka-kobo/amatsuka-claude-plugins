#!/usr/bin/env python3
"""native-japanese の 2 つの時点で同じ題材を claude -p に書かせ、指定した型の件数を比べる。

使い方:
  native_japanese_ab.py run --before <ref> --after <ref|WORKTREE> --prompts <json> --patterns <json> --out <dir>
                            [--targets <json>] [--models opus,sonnet] [--runs 2] [--workers 6] [--timeout 300]
  native_japanese_ab.py report --patterns <json> --out <dir> [--targets <json>] [--show <型の id>]
  native_japanese_ab.py --self-check

run は採取の後に report も出す。保存済みの応答は採り直さないので、中断した採取は同じ引数で続けられる。
時点・題材・モデル・回数が初回と違う run は、同じ --out では受け付けない。
--targets を渡すと、目安ごとに前後の値と合否、基準までの差、合否が変わったときは後退か改善かを出す。
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
META = "meta.json"
MARK = ".native-japanese-ab"


def repo_root():
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if out.returncode:
        sys.exit("リポジトリの中で実行する")
    return Path(out.stdout.strip())


def resolve(ref):
    """ブランチ名や HEAD を、再実行しても動かないコミットに直す。"""
    if ref == "WORKTREE":
        return ref
    out = subprocess.run(["git", "rev-parse", "--verify", f"{ref}^{{commit}}"], capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"コミットを解決できない: {ref}")
    return out.stdout.strip()


def export_plugin(ref, dest):
    """ref の時点のプラグインを dest に複製する。WORKTREE は作業ツリーをそのまま写す。"""
    dest.mkdir(parents=True)
    root = repo_root()
    if ref == "WORKTREE":
        shutil.copytree(root / PLUGIN, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules"))
        return
    archive = subprocess.run(["git", "-C", str(root), "archive", ref, PLUGIN], capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", str(dest), "--strip-components=2"], input=archive.stdout, check=True)


def parse_stream(text):
    """stream-json の出力から、最後の応答の本文と、Skill ツールで japanese-writing を起動したかを取り出す。空の本文は None にする。"""
    result, skill = None, False
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "result" and not event.get("is_error"):
            result = event.get("result") or None
        message = event.get("message")
        for block in (message.get("content") if isinstance(message, dict) else None) or []:
            if not (isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Skill"):
                continue
            if "japanese-writing" in json.dumps(block.get("input")):
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


def check_ids(items, what):
    ids = [item["id"] for item in items]
    bad = [i for i in ids if not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", i)]
    if bad or len(set(ids)) != len(ids):
        sys.exit(f"{what}の id は英数字・_・-・. だけで書き、重ならないようにする: {bad or ids}")
    return ids


def run(args):
    out = Path(args.out).resolve()
    if out.is_relative_to(repo_root()):
        sys.exit("--out はリポジトリの外に置く。中に置くと、採取がリポジトリの CLAUDE.md と設定を読む")
    prompts = json.loads(Path(args.prompts).read_text())
    models = args.models.split(",")
    check_ids([{"id": m} for m in models], "モデル")
    patterns = json.loads(Path(args.patterns).read_text())
    pattern_ids = check_patterns(patterns)
    prompt_ids = check_ids(prompts, "題材")
    # 採取の後で止まらないように、型と目安が指す題材の id を先に確かめる
    for item in patterns:
        if [i for i in item.get("prompts", []) if i not in prompt_ids]:
            sys.exit(f"型 {item['id']} の prompts に、台帳の題材に無い id がある")
    if args.targets:
        check_targets(json.loads(Path(args.targets).read_text()), patterns, prompt_ids)
    if out.exists() and not out.is_dir():
        sys.exit(f"--out はディレクトリにする: {out}")
    meta = {
        "refs": {"before": resolve(args.before), "after": resolve(args.after)},
        "prompts": {item["id"]: item["prompt"] for item in prompts},
        "models": models,
        "runs": args.runs,
    }
    check_ids(prompts, "題材")
    if (out / META).exists():
        if json.loads((out / META).read_text()) != meta:
            sys.exit(f"時点・題材・モデル・回数が {out / META} と違う。新しい --out を使う")
    else:
        # meta.json が無いのは初回か、初回の複製が途中で止まった後である。作りかけを消してやり直す
        # 印の無い、空でないディレクトリは他の用途のものなので触らない
        if out.exists() and any(out.iterdir()) and not (out / MARK).exists():
            sys.exit(f"--out は空か、まだ無いディレクトリにする: {out}")
        out.mkdir(parents=True, exist_ok=True)
        (out / MARK).touch()
        for name in ("plugin", "cwd"):
            shutil.rmtree(out / name, ignore_errors=True)
        for label in LABELS:
            export_plugin(meta["refs"][label], out / "plugin" / label)
        (out / "cwd").mkdir()
        (out / META).write_text(json.dumps(meta, ensure_ascii=False))
    jobs = []
    for label in LABELS:
        for model in models:
            for item in prompts:
                for n in range(1, args.runs + 1):
                    path = out / "raw" / label / model / f"{item['id']}-{n}.jsonl"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    jobs.append((path, out / "plugin" / label, out / "cwd", model, item["prompt"], args.timeout))
    with ThreadPoolExecutor(args.workers) as pool:
        states = list(pool.map(sample, jobs))
    for state in sorted(set(states)):
        print(f"{state}: {states.count(state)}", file=sys.stderr)
    report(args)


# 閉じていないフェンスは本文の末尾までをコードとして除く
FENCE = re.compile(r"```.*?(?:```|\Z)", re.S)
INLINE = re.compile(r"`[^`\n]*`")
UNITS = ("text", "prose", "sentence")


def prose(text):
    """コードフェンスと表の行を除き、インラインコードを 1 字に置き換える。"""
    text = INLINE.sub("甲", FENCE.sub("", text))
    return "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("|"))


def sentences(text):
    """prose の結果を文に分ける。ひらがなを含む 8 字以上のものだけを文とする。"""
    out = []
    for ln in prose(text).splitlines():
        # ** を先に落とす。行頭の箇条書きの記号と取り違えないためである。番号は後ろに空白があるものだけを落とす
        ln = re.sub(r"^\s*(#+|[-*]|\d+\.(?=\s))\s*", "", ln.replace("**", "")).strip()
        # 閉じ括弧の直前では切らない(「確認します。」と言いました。)
        for s in re.split("(?<=[。!?\uff01\uff1f])(?![」)\uff09])", ln):
            s = s.strip()
            if len(s) >= 8 and re.search(r"[ぁ-ん]", s):
                out.append(s)
    return out


def matches(item, text):
    """型の unit に従って本文に当て、一致した箇所を返す。sentence は当たった文を、ほかは一致の末尾がある行を返す。"""
    regex = re.compile(item["regex"])
    unit = item.get("unit", "text")
    if unit == "sentence":
        return [s for s in sentences(text) if regex.search(s)]
    body = prose(text) if unit == "prose" else text
    found = []
    for m in regex.finditer(body):
        at = max(m.start(), m.start() + len(m.group(0).rstrip()) - 1)
        found.append(body[body.rfind("\n", 0, at) + 1:].split("\n", 1)[0].strip())
    return found


def prompt_id(path):
    return path.stem.rsplit("-", 1)[0]


def targets(item, texts):
    """型が prompts で題材を絞っていれば、その題材の応答だけを返す。"""
    only = item.get("prompts")
    return [(p, t) for p, t in texts if not only or prompt_id(p) in only]


def count(texts, patterns):
    """型ごとに、一致の件数、一致を含む応答の本数、対象の応答の本数、対象の文の数を返す。"""
    rows = []
    for item in patterns:
        mine = targets(item, texts)
        hits = [len(matches(item, text)) for _, text in mine]
        n_sent = sum(len(sentences(t)) for _, t in mine) if item.get("unit") == "sentence" else 0
        rows.append((sum(hits), sum(1 for h in hits if h), len(mine), n_sent))
    return rows


def cell(row):
    hits, docs, n, n_sent = row
    share = f"、文の {100 * hits / n_sent:.1f}%" if n_sent else ""
    return f"{hits} / {docs} / {n}{share}"


def touten(texts):
    body = "".join(prose(t) for _, t in texts)
    chars = len(re.sub(r"\s", "", body))
    return f"{100 * body.count('、') / chars:.2f}" if chars else "-"


def load(out, label):
    texts, skills = [], 0
    for path in sorted((out / "raw" / label).glob("*/*.jsonl")):
        text, skill = parse_stream(path.read_text())
        if text is None:
            continue
        texts.append((path, text))
        skills += skill
    return texts, skills


METRICS = ("skill", "touten", "share", "ratio", "mixed", "per10k", "per100", "in_range")


def measure(target, texts, skills, by_id):
    """目安の 1 行の値を出す。分母が 0 のときは None を返す。"""
    kind = target["metric"]
    if kind == "skill":
        return 100 * skills / len(texts) if texts else None
    only = target.get("prompts")
    mine = [(p, t) for p, t in texts if not only or prompt_id(p) in only]
    if kind == "touten":
        body = "".join(prose(t) for _, t in mine)
        chars = len(re.sub(r"\s", "", body))
        return 100 * body.count("、") / chars if chars else None
    # 題材の絞り込みは目安の prompts で決めるので、型の prompts は外して当てる
    types = [{k: v for k, v in by_id[i].items() if k != "prompts"} for i in target["patterns"]]
    per_doc = [[len(matches(item, text)) for item in types] for _, text in mine]
    totals = [sum(col) for col in zip(*per_doc)] if per_doc else [0] * len(types)
    if kind == "share":
        n = sum(len(sentences(t)) for _, t in mine)
        return 100 * sum(totals) / n if n else None
    if kind == "ratio":
        both = totals[0] + totals[1]
        return 100 * totals[0] / both if both else None
    if kind == "mixed":
        # 1 本の中で 2 つの型が混ざる応答の割合。少ない側が limit(%)を超える応答を数える
        limit = target.get("limit", 10)
        mixed = sum(1 for a, b, *_ in per_doc if a + b and 100 * min(a, b) / (a + b) > limit)
        return 100 * mixed / len(mine) if mine else None
    if kind == "per10k":
        chars = sum(len(re.sub(r"\s", "", t)) for _, t in mine)
        return 10000 * sum(totals) / chars if chars else None
    if kind == "per100":
        return 100 * sum(totals) / len(mine) if mine else None
    low, high = target.get("min", 0), target.get("max", float("inf"))
    return 100 * sum(1 for row in per_doc if low <= sum(row) <= high) / len(mine) if mine else None


def margin(target, value):
    """目安までの差を返す。0 以上なら届いている。"""
    return target["value"] - value if target["op"] == "以下" else value - target["value"]


def verdict(target, value):
    """目安に届いたかと、目安までの差を返す。"""
    if value is None:
        return "測れない"
    m = margin(target, value)
    return f"届いた(余裕 {m:.2f})" if m >= 0 else f"届かない(不足 {-m:.2f})"


def change(target, before, after):
    """before と after で合否が変わった目安に、後退か改善かを付ける。"""
    if before is None or after is None:
        return ""
    was, now = margin(target, before) >= 0, margin(target, after) >= 0
    return "" if was == now else ("改善" if now else "後退")


def check_targets(targets, patterns, prompt_ids):
    if any(not {"id", "metric", "op", "value"} <= set(t) for t in targets):
        sys.exit("目安には id・metric・op・value を書く")
    check_ids(targets, "目安")
    units = {item["id"]: item.get("unit", "text") for item in patterns}
    for t in targets:
        kind, used = t["metric"], t.get("patterns", [])
        bad = [i for i in used if i not in units] + [i for i in t.get("prompts", []) if i not in prompt_ids]
        if kind not in METRICS or t["op"] not in ("以下", "以上"):
            bad.append("metric か op")
        elif kind in ("skill", "touten"):
            if used or (kind == "skill" and t.get("prompts")):
                bad.append("この metric は patterns を取らない。skill は prompts も取らない")
        elif kind in ("ratio", "mixed"):
            if len(used) != 2:
                bad.append("patterns は 2 つ")
        elif not used:
            bad.append("patterns が無い")
        if kind == "share" and any(units.get(i) != "sentence" for i in used):
            bad.append("share の型は unit が sentence のもの")
        if kind == "in_range" and "min" not in t and "max" not in t:
            bad.append("in_range は min か max が要る")
        if any(not isinstance(t[k], (int, float)) or isinstance(t[k], bool) for k in ("value", "limit", "min", "max") if k in t):
            bad.append("value・limit・min・max は数で書く")
        elif t.get("min", 0) > t.get("max", float("inf")):
            bad.append("min は max 以下にする")
        if bad:
            sys.exit(f"目安 {t['id']} を確かめる: {bad}")


def check_patterns(patterns):
    if any("id" not in item or "regex" not in item for item in patterns):
        sys.exit("型には id と regex を書く")
    ids = check_ids(patterns, "型")
    for item in patterns:
        if not isinstance(item.get("prompts", []), list):
            sys.exit(f"型の prompts は題材の id の配列にする: {item['id']}")
        if item.get("unit", "text") not in UNITS:
            sys.exit(f"型の unit は {UNITS} のどれかにする: {item['id']}")
        re.compile(item["regex"])
    return ids


def report(args):
    out = Path(args.out).resolve()
    if not (out / META).exists():
        sys.exit(f"{out / META} が無い。--out を確かめる")
    meta = json.loads((out / META).read_text())
    patterns = json.loads(Path(args.patterns).read_text())
    ids = check_patterns(patterns)
    for item in patterns:
        unknown = [i for i in item.get("prompts", []) if i not in meta["prompts"]]
        if unknown:
            sys.exit(f"型 {item['id']} の prompts に、採取した題材に無い id がある: {unknown}")
    targets = json.loads(Path(args.targets).read_text()) if getattr(args, "targets", None) else None
    if targets is not None:
        check_targets(targets, patterns, meta["prompts"])
    data = {label: load(out, label) for label in LABELS}
    show = getattr(args, "show", None)
    if show:
        if show not in ids:
            sys.exit(f"型の id が無い: {show}")
        item = patterns[ids.index(show)]
        for label in LABELS:
            for path, text in targets(item, data[label][0]):
                for line in dict.fromkeys(matches(item, text)):
                    print(f"{label}\t{path.parent.name}/{path.stem}\t{line}")
        return
    for label in LABELS:
        for path, text in data[label][0]:
            dest = out / "text" / label / path.parent.name / f"{path.stem}.txt"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text)
    expected = len(meta["prompts"]) * len(meta["models"]) * meta["runs"]
    cells = {
        label: (
            meta["refs"][label][:8], len(texts), expected - len(texts), sum(len(t[1]) for t in texts), skills,
            sum(len(sentences(t[1])) for t in texts), touten(texts),
        )
        for label, (texts, skills) in data.items()
    }
    print("| 項目、型は「件数 / 含む本数 / 対象の本数」 | before | after |")
    print("| --- | --- | --- |")
    names = ("時点", "応答の本数", "採れなかった本数", "文字数", "Skill を起動した本数", "文の数", "読点(100 字あたり)")
    for i, name in enumerate(names):
        print(f"| {name} | {cells['before'][i]} | {cells['after'][i]} |")
    counted = {label: count(data[label][0], patterns) for label in LABELS}
    for item, before, after in zip(patterns, counted["before"], counted["after"]):
        want = f"・{item['want']}" if item.get("want") else ""
        print(f"| {item['id']}{want} | {cell(before)} | {cell(after)} |")
    if targets is None:
        return
    by_id = dict(zip(ids, patterns))
    print()
    print("| 目安 | since | 基準 | before | after | 変化 |")
    print("| --- | --- | --- | --- | --- | --- |")
    for t in targets:
        values = [measure(t, *data[label], by_id) for label in LABELS]
        shown = ["測れない" if v is None else f"{v:.2f}、{verdict(t, v)}" for v in values]
        base = f"{t['value']} {t['op']}"
        print(f"| {t['id']} | {t.get('since', '')} | {base} | {shown[0]} | {shown[1]} | {change(t, *values)} |")


def self_check():
    skill = {"type": "tool_use", "name": "Skill", "input": {"skill": "native-japanese:japanese-writing"}}
    stream = "\n".join([
        json.dumps({"type": "assistant", "message": {"content": [skill]}}),
        "壊れた行",
        "123",
        json.dumps({"type": "result", "is_error": False, "result": "超えるかもしれません。"}),
    ])
    assert parse_stream(stream) == ("超えるかもしれません。", True)
    other = {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Skill", "input": {"skill": "x"}}]}}
    assert parse_stream(json.dumps(other)) == (None, False)
    assert parse_stream(json.dumps({"type": "result", "is_error": True, "result": "x"})) == (None, False)
    assert parse_stream(json.dumps({"type": "result", "result": ""})) == (None, False)

    text = "結果を確認します。\n設定は、変更しました。\n```\n設定は、コードの中です。\n```\n| 設定は、表の中です。 |\n"
    assert sentences(text) == ["結果を確認します。", "設定は、変更しました。"]
    assert sentences("**注意**: 設定は再起動の後に反映されます。\n10.5GB を超えると止まります。") == [
        "注意: 設定は再起動の後に反映されます。", "10.5GB を超えると止まります。"]
    assert sentences("「確認します。」と言いました。\n```\n閉じていないコードの中の文です。") == ["「確認します。」と言いました。"]
    head = {"id": "h", "unit": "sentence", "regex": "^[^、。]{1,6}(は|が)、"}
    raw = {"id": "r", "regex": "設定は、"}
    a, b = Path("m/p01-x-1.jsonl"), Path("m/p02-1.jsonl")
    assert prompt_id(a) == "p01-x"
    rows = count([(a, text), (b, "言い切ります。")], [head, raw, dict(raw, prompts=["p02"])])
    assert rows == [(1, 1, 2, 2), (3, 1, 2, 0), (0, 0, 1, 0)], rows
    assert cell(rows[0]) == "1 / 1 / 2、文の 50.0%"
    assert matches(raw, "お手伝いします。\n\n") == [] and matches({"regex": r"お手伝い[^。\n]*。?\s*\Z"}, "a\nお手伝いします。\n\n") == ["お手伝いします。"]

    doc = [(a, "設定は、変更しました。結果を確認します。見れるし、食べれるし、出れる。")]
    by_id = {"h": head, "ra": {"id": "ra", "unit": "prose", "regex": "(見|食べ|出)れ"}, "r": raw}
    assert measure({"metric": "skill"}, doc, 1, by_id) == 100
    assert round(measure({"metric": "share", "patterns": ["h"]}, doc, 0, by_id), 1) == 33.3
    assert measure({"metric": "ratio", "patterns": ["h", "ra"]}, doc, 0, by_id) == 25
    assert measure({"metric": "mixed", "patterns": ["ra", "h"]}, doc, 0, by_id) == 100
    assert measure({"metric": "mixed", "patterns": ["ra", "h"], "limit": 25}, doc, 0, by_id) == 0
    assert measure({"metric": "per100", "patterns": ["ra"]}, doc, 0, by_id) == 300
    assert measure({"metric": "in_range", "patterns": ["ra"], "min": 3}, doc, 0, by_id) == 100
    assert measure({"metric": "in_range", "patterns": ["ra"], "min": 1, "max": 2}, doc, 0, by_id) == 0
    assert measure({"metric": "share", "patterns": ["h"], "prompts": ["none"]}, doc, 0, by_id) is None
    assert verdict({"op": "以下", "value": 5}, 4.3) == "届いた(余裕 0.70)"
    assert verdict({"op": "以上", "value": 80}, 70) == "届かない(不足 10.00)"
    low = {"op": "以下", "value": 5}
    assert [change(low, 4, 6), change(low, 6, 4), change(low, 6, 7), change(low, None, 4)] == ["後退", "改善", "", ""]
    ledger = Path(__file__).resolve().parent.parent / ".claude/skills/native-japanese-ab/assets"
    types = {item["id"]: item for item in json.loads((ledger / "patterns.json").read_text())}
    check_patterns(list(types.values()))
    prompt_ids = check_ids(json.loads((ledger / "prompts.json").read_text()), "題材")
    check_targets(json.loads((ledger / "targets.json").read_text()), list(types.values()), prompt_ids)
    for bad in (
        {"metric": "share", "patterns": ["kakko-no-bun"]}, {"metric": "ratio", "patterns": ["keitai"]},
        {"metric": "in_range", "patterns": ["keitai"]}, {"metric": "skill", "prompts": ["p07-article"]},
        {"metric": "per100", "patterns": ["keitai"], "value": "5"}, {"metric": "in_range", "patterns": ["keitai"], "min": 3, "max": 1},
    ):
        try:
            check_targets([dict({"id": "t", "op": "以下", "value": 0}, **bad)], list(types.values()), prompt_ids)
        except SystemExit:
            continue
        raise AssertionError(bad)
    for kei in ("できますか。", "合っていますよね。", "ご覧くださいませ。", "ですが。", "確認しますけどね。", "遅いですし。"):
        assert matches(types["keitai"], "これは敬体の文で" + kei) and not matches(types["jotai"], "これは敬体の文で" + kei)
    assert matches(types["jotai"], "値が上がると動作は遅い。") and not matches(types["jotai"], "始業と終業の手順を決める")
    assert matches(types["kakko-no-bun"], "設定（再起動の後に反映される既定の値を使う）")
    assert matches(types["futoji-label"], "- **原因**： キャッシュ")
    for bad in ([{"id": "a/b"}], [{"id": ".."}], [{"id": "型"}], [{"id": "a"}, {"id": "a"}]):
        try:
            check_ids(bad, "型")
        except SystemExit:
            continue
        raise AssertionError(bad)
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
        p.add_argument("--targets")
        if name == "report":
            p.add_argument("--show")
        else:
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
