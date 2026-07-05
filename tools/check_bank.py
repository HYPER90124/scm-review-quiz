# -*- coding: utf-8 -*-
"""校验 index.html 内嵌题库的完整性与规则一致性。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# index.html 已加密，题库明文位于本地源文件 index.plain.html
INDEX = ROOT / "index.plain.html"

# 计划中的各章题数
EXPECTED_COUNTS = {1: 4, 2: 8, 3: 11, 4: 9, 5: 11, 6: 12, 7: 16, 8: 6,
                   9: 3, 10: 4, 11: 2, 12: 5, 13: 7}
STAR_CHAPTERS = {4, 6, 7, 8}
TYPES = {"single", "multi", "judge", "essay"}

def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)

if not INDEX.exists():
    fail("index.html 不存在")

html = INDEX.read_text(encoding="utf-8")
m = re.search(r'<script id="question-data" type="application/json">(.*?)</script>',
              html, re.S)
if not m:
    fail("未找到 question-data script 块")

try:
    bank = json.loads(m.group(1))
except json.JSONDecodeError as e:
    fail(f"JSON 解析失败: {e}")

if not isinstance(bank, list) or not bank:
    fail("题库不是非空数组")

ids = set()
counts = {}
errors = []
for q in bank:
    qid = q.get("id", "?")
    if qid in ids:
        errors.append(f"{qid}: id 重复")
    ids.add(qid)
    ch = q.get("chapter")
    if ch not in EXPECTED_COUNTS:
        errors.append(f"{qid}: chapter 非法 {ch}")
        continue
    counts[ch] = counts.get(ch, 0) + 1
    t = q.get("type")
    if t not in TYPES:
        errors.append(f"{qid}: type 非法 {t}")
        continue
    if not q.get("question", "").strip():
        errors.append(f"{qid}: question 为空")
    if not isinstance(q.get("starred"), bool):
        errors.append(f"{qid}: starred 缺失或非布尔")
    if ch in STAR_CHAPTERS and q.get("starred") is not True:
        errors.append(f"{qid}: 第{ch}章必须 starred=true")
    opts = q.get("options")
    ans = q.get("answer")
    if t == "single":
        if not isinstance(opts, list) or len(opts) < 2:
            errors.append(f"{qid}: single 选项不足")
        elif not (isinstance(ans, int) and 0 <= ans < len(opts)):
            errors.append(f"{qid}: single answer 非法")
    elif t == "multi":
        if not isinstance(opts, list) or len(opts) < 2:
            errors.append(f"{qid}: multi 选项不足")
        elif (not isinstance(ans, list) or not ans
              or not all(isinstance(a, int) and 0 <= a < len(opts) for a in ans)
              or len(set(ans)) != len(ans)):
            errors.append(f"{qid}: multi answer 非法")
    elif t == "judge":
        if not isinstance(ans, bool):
            errors.append(f"{qid}: judge answer 必须为布尔")
        if ans is False and not q.get("correction", "").strip():
            errors.append(f"{qid}: judge 原句为错时必须给 correction")
    elif t == "essay":
        if not q.get("reference", "").strip():
            errors.append(f"{qid}: essay 必须有 reference 参考答案")
    if t != "essay" and not q.get("reference", "").strip():
        errors.append(f"{qid}: 缺少 reference 解析")

for ch, n in EXPECTED_COUNTS.items():
    got = counts.get(ch, 0)
    if got != n:
        errors.append(f"第{ch}章题数 {got} != 计划 {n}")

if errors:
    for e in errors:
        print("FAIL:", e)
    sys.exit(1)

n_star = sum(1 for q in bank if q["starred"])
by_type = {}
for q in bank:
    by_type[q["type"]] = by_type.get(q["type"], 0) + 1
print(f"OK: {len(bank)} 题，星标 {n_star} 题，题型分布 {by_type}")
