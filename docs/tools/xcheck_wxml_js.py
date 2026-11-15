#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WXML ↔ JS 交叉校验：
1. wxml 里所有 bind/catch 事件的处理函数，必须在对应 js 里定义
2. js 的 methods 里定义的函数，若在 wxml 中被引用则必须存在
3. wxml 标签闭合检查
"""
import os, re, sys

# 脚本位于 docs/tools/，向上三级即项目根，再进 miniprogram
ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "miniprogram",
)
pages = [
    ("pages/ocean/ocean",),
    ("pages/iceberg/iceberg",),
    ("pages/timeline/timeline",),
    ("pages/recycle/recycle",),
    ("packageGuide/pages/guide/guide",),
]

EVENT_RE = re.compile(r'\b(?:bind|catch)(?::)?([A-Za-z]+)\s*=\s*"([A-Za-z_$][\w$]*)"', re.I)
SELF_CLOSING = {'image','input','icon','import','include','wxs','slot','switch','progress','checkbox','radio','audio','video','camera','live-player','live-pusher','official-account','open-data','ad','functional-page-navigator','navigator','block'}

def check_tags(wxml):
    """粗略闭合检查：统计成对标签"""
    body = re.sub(r'<!--.*?-->', '', wxml, flags=re.S)
    body = re.sub(r'<wxs[^>]*?/>', '', body)
    stack, errs = [], []
    for m in re.finditer(r'<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>', body):
        closing, tag, attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if selfclose or tag in SELF_CLOSING and not closing:
            continue
        if closing:
            if not stack:
                errs.append(f"多余的闭合 </{tag}>")
            elif stack[-1] != tag:
                errs.append(f"标签不匹配：期望 </{stack[-1]}>，实际 </{tag}>")
                if tag in stack:
                    while stack and stack.pop() != tag: pass
            else:
                stack.pop()
        else:
            stack.append(tag)
    for t in stack:
        errs.append(f"未闭合 <{t}>")
    return errs

total_bad = 0
for (name,) in pages:
    wxml_p = os.path.join(ROOT, name + '.wxml')
    js_p = os.path.join(ROOT, name + '.js')
    if not os.path.exists(wxml_p):
        continue
    wxml = open(wxml_p, encoding='utf-8').read()
    js = open(js_p, encoding='utf-8').read() if os.path.exists(js_p) else ''

    # js 中定义的函数名（Page({ fn() {} }) 与 Page({ fn: function(){} }) 两种写法）
    defined = set(re.findall(r'^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{', js, re.M))
    defined |= set(re.findall(r'^\s{2,}([A-Za-z_$][\w$]*)\s*:\s*(?:function|\()', js, re.M))
    defined |= set(re.findall(r'^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{', js, re.M))

    referenced = {}
    for evt, fn in EVENT_RE.findall(wxml):
        referenced.setdefault(fn, []).append('bind' + evt.lower())

    missing = {fn: ev for fn, ev in referenced.items() if fn not in defined}
    tag_errs = check_tags(wxml)

    status = "OK" if not missing and not tag_errs else "PROBLEM"
    print(f"\n=== {os.path.basename(name)} [{status}] ===")
    print(f"  wxml 引用事件处理函数 {len(referenced)} 个，js 定义 {len(defined)} 个")
    if missing:
        total_bad += len(missing)
        for fn, evs in missing.items():
            print(f"  ❌ 缺失处理函数: {fn}()  <- {','.join(sorted(set(evs)))}")
    else:
        print(f"  ✅ 全部 {len(referenced)} 个事件处理函数均已定义")
    if tag_errs:
        total_bad += len(tag_errs)
        for e in tag_errs:
            print(f"  ❌ 标签: {e}")
    else:
        print(f"  ✅ 标签闭合正常")

    # 列出 wxml 里引用的 js 函数（含 tap 之外的调用），辅助人工复核
    unused = sorted(set(defined) - set(referenced))

print("\n" + "=" * 60)
print(f"总计问题：{total_bad}")
sys.exit(1 if total_bad else 0)
