#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wxml 中 class 属性引用的类名 → wxss 中是否有定义
排除 wx:if 表达式内的动态拼接，只取字面类名。
"""
import os, re, sys

# 脚本位于 docs/tools/，向上三级即项目根，再进 miniprogram
ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "miniprogram",
)
pages = ["pages/ocean/ocean","pages/iceberg/iceberg","pages/timeline/timeline",
         "pages/recycle/recycle","packageGuide/pages/guide/guide"]

app_wxss = open(os.path.join(ROOT,'app.wxss'), encoding='utf-8').read()
app_classes = set(re.findall(r'\.([A-Za-z][\w-]*)', app_wxss))

total = 0
for name in pages:
    wxml = open(os.path.join(ROOT, name+'.wxml'), encoding='utf-8').read()
    wxss_p = os.path.join(ROOT, name+'.wxss')
    wxss = open(wxss_p, encoding='utf-8').read() if os.path.exists(wxss_p) else ''
    local = set(re.findall(r'\.([A-Za-z][\w-]*)', wxss))
    defined = app_classes | local

    # class="a b {{cond ? 'c' : 'd'}} e"
    used = set()
    # 比较运算符右侧的字符串是比较值而非类名（如 recordMode === 'hold' ? ...）
    COMPARE_RE = re.compile(r'(===|!==|==|!=)\s*$')
    for m in re.finditer(r'\bclass\s*=\s*"([^"]*)"', wxml):
        raw = m.group(1)
        # 提取 {{ }} 内的字符串字面量
        for sm in re.finditer(r'\{\{(.*?)\}\}', raw, re.S):
            expr = sm.group(1)
            for lit_m in re.finditer(r"'([^']*)'", expr):
                if COMPARE_RE.search(expr[:lit_m.start()]):
                    continue
                for tok in lit_m.group(1).split():
                    used.add(tok)
            for lit_m in re.finditer(r'"([^"]*)"', expr):
                if COMPARE_RE.search(expr[:lit_m.start()]):
                    continue
                for tok in lit_m.group(1).split():
                    used.add(tok)
        outside = re.sub(r'\{\{.*?\}\}', ' ', raw, flags=re.S)
        for tok in outside.split():
            used.add(tok)
    # hover-class 也算
    for m in re.finditer(r'\bhover-class\s*=\s*"([^"]*)"', wxml):
        v = m.group(1).strip()
        if v and v != 'none':
            used.add(v)

    missing = sorted(c for c in used if c not in defined and not c.startswith('$'))
    print(f"=== {os.path.basename(name)} ===  用到 {len(used)} 个类，未定义 {len(missing)} 个")
    if missing:
        total += len(missing)
        for c in missing:
            print(f"   ⚠️  .{c}")

print("\n" + "="*50)
print(f"未定义类名总计：{total}")
