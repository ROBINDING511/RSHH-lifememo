#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人生海海 wxss 对比度 / 字号 / 触控 三项 AA 校验
扫描 miniprogram 下所有 .wxss，按「文字色 vs 其所在底色」配对核算 WCAG 2.2 AA。
深色底上的浅色文字也纳入（transcript-box / timer / record-sub 等）。
"""
import os, re, sys, json

# 脚本位于 docs/tools/，向上三级即项目根，再进 miniprogram
ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "miniprogram",
)

# app.wxss 里的 token → 实际色值（解析出来，避免硬编码）
def parse_tokens(text):
    """解析 token：颜色返回 #RRGGBB，字号返回 'NNrpx'"""
    tok = {}
    for m in re.finditer(r'(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8}|[\d.]+rpx)', text):
        tok[m.group(1)] = m.group(2)
    return tok

def resolve_len(val, tok, depth=0):
    """把 var(--fs-x) / NNrpx 解析成 rpx 数值；失败返回 None"""
    if val is None or depth > 5:
        return None
    val = val.strip()
    if val.startswith("var("):
        name = re.match(r'var\(\s*(--[\w-]+)', val)
        if not name:
            return None
        return resolve_len(tok.get(name.group(1)), tok, depth + 1)
    m = re.match(r'^([\d.]+)rpx$', val)
    return float(m.group(1)) if m else None

def resolve(val, tok, depth=0):
    """把 var(--x) 解析成色值；解析不了返回 None"""
    if val is None:
        return None
    val = val.strip()
    if val.startswith("var("):
        name = re.match(r'var\(\s*(--[\w-]+)', val)
        if not name or depth > 5:
            return None
        return resolve(tok.get(name.group(1)), tok, depth + 1)
    m = re.match(r'^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})$', val)
    if not m:
        return None
    h = m.group(1).lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return '#' + h.upper()

def lum(hexcolor):
    h = hexcolor.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def cr(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def parse_rules(text):
    """返回 [(selector, {prop: raw_value})]"""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    out = []
    for m in re.finditer(r'([^{}@]+)\{([^{}]*)\}', text):
        sel = ' '.join(m.group(1).split())
        body = m.group(2)
        props = {}
        for pm in re.finditer(r'([\w-]+)\s*:\s*([^;]+);?', body):
            props[pm.group(1)] = pm.group(2).strip()
        if sel and props:
            out.append((sel, props))
    return out

# 人工登记的「前景元素 → 实际底色」映射（跨选择器，无法自动推断的）
# key = 前景选择器片段, value = (底色选择器片段 or 直接色值, 说明)
EXPLICIT_BG = {
    '.record-sub':     ('.record-btn',    '按住说话按钮主色底上的副文字'),
    '.record-main':    ('.record-btn',    '按住说话按钮主色底上的主文字'),
    '.live-text':      ('.live-card',     '实时转写纸白底上的正文'),
    '.live-state':     ('.live-card',     '实时转写面板状态文字'),
    '.live-timer':     ('.live-card',     '实时转写面板计时'),
    '.live-asr':       ('.live-card',     '实时转写面板连线提示'),
    '.live-hint':      ('.live-card',     '实时转写面板操作提示'),
    '.live-countdown-num':  ('.live-card', '最后10秒倒计时大号数字'),
    '.live-countdown-label':('.live-card', '最后10秒倒计时说明'),
    '.draft-text':     ('.draft-bar',     '草稿条黄底上的文字'),
    '.draft-btn':      ('.draft-btn',     '草稿按钮棕底白字'),
    '.vc-text':        ('.voice-check',   '回听条浅蓝底上的文字'),
    '.option-label':   ('.preview-card',  '白卡上的选项标签'),
    '.chip':           ('.preview-card',  '白卡上的未选 chip'),
    '.chip-on':        ('.chip-on',       '选中 chip 主色底白字'),
    '.hint-sub':       ('.hint-card',     '空态深色胶囊白字副标题'),
    '.hint-sub2':      ('.hint-card',     '空态深色胶囊白字说明'),
    '.hint-title':     ('.hint-card',     '空态深色胶囊白字标题'),
    '.g-desc':         ('.page',          '引导页描述'),
    '.g-skip':         ('.page',          '引导页跳过'),
    '.back-btn':       ('.top-zone',      '顶栏白底上的返回'),
    '.dock-pill':      ('.dock-pill',     '白药丸底上的文字'),
    '.year-badge':     ('.year-badge',    '年份徽章主色底白字'),
    '.rain-btn':       ('.rain-btn',      '恢复按钮主色底白字'),
    '.photo-add-text': ('.photo-add',     '加照片浅蓝底上的文字'),
    '.item-meta':      ('.item-card',     '卡片上的元信息'),
    '.item-title':     ('.item-card',     '卡片上的标题'),
    '.cloud-meta':     ('.cloud-card',    '云卡片上的元信息'),
    '.cloud-title':    ('.cloud-card',    '云卡片上的标题'),
    '.melt':           ('.card',          '化成云危险文字'),
    '.voice-tip':      ('.card',          '原声提示'),
    '.berg-meta':      ('.card',          '冰山元信息'),
    '.tl-sub':         ('.page',          '时间轴副标题'),
    '.tl-title':       ('.page',          '时间轴标题'),
    '.sub':            ('.page',          '副标题'),
    '.title':          ('.page',          '标题'),
    '.analyze-text':   ('.analyze-mask',  '分析遮罩上的文字'),
    '.analyze-sub':    ('.analyze-mask',  '分析遮罩上的副文字'),
    '.preview-title':  ('.preview-card',  '预览卡标题'),
    '.preview-hint':   ('.preview-card',  '预览卡提示'),
    '.preview-text':   ('.preview-text',  '输入框浅底上的正文'),
    '.list-tip':       ('.page',          '列表底部提示'),
    '.text-secondary': ('.card',          '全局次要文字'),
    '.btn-primary':    ('.btn-primary',   '主按钮白字'),
    '.btn-ghost':      ('.btn-ghost',     '幽灵按钮'),
    '.btn-danger-ghost': ('.btn-danger-ghost', '危险幽灵按钮'),
}

# 非文字用途的色（边框/装饰/hover 底/图标底），不参与文字对比度判定
NON_TEXT_PROPS = ('border', 'border-left', 'border-right', 'border-top',
                  'border-bottom', 'border-color', 'box-shadow', 'outline')

def collect_bg_color(sel, props_map, tok, all_rules):
    """取某选择器自身的背景色（用于文字压在自身底色上的情况）"""
    for s, p in all_rules:
        if s == sel:
            raw = p.get('background') or p.get('background-color')
            if raw:
                c = resolve(raw, tok)
                if c:
                    return c
                if 'rgba(255,255,255' in raw:
                    return '#FFFFFF'
                if raw.startswith('linear-gradient'):
                    gm = re.search(r'#[0-9A-Fa-f]{6}', raw)
                    if gm:
                        return '#' + gm.group(0)[1:].upper()
    return None

def main():
    files = []
    for dp, dn, fn in os.walk(ROOT):
        if 'node_modules' in dp or 'miniprogram_npm' in dp:
            continue
        for f in fn:
            if f.endswith('.wxss'):
                files.append(os.path.join(dp, f))

    app_text = open(os.path.join(ROOT, 'app.wxss'), encoding='utf-8').read()
    tok = parse_tokens(app_text)

    all_rules = []
    for fp in files:
        txt = open(fp, encoding='utf-8').read()
        for sel, props in parse_rules(txt):
            all_rules.append((os.path.relpath(fp, ROOT), sel, props))

    # 汇总每个选择器的属性（后出现的覆盖前面的，近似层叠）
    merged = {}
    for rel, sel, props in all_rules:
        merged.setdefault(sel, {}).update(props)

    bgcache = {}
    def bg_of(key):
        """key 可能是选择器或直接色值"""
        if key in bgcache:
            return bgcache[key]
        if key.startswith('#'):
            bgcache[key] = key
            return key
        if key == '.page':
            c = resolve('var(--c-bg)', tok)
            bgcache[key] = c
            return c
        if key == '.record-mask':
            bgcache[key] = '#0F3A5C'   # rgba(15,58,92,.62) 叠深色海面的近似不透明值
            return bgcache[key]
        if key == '.analyze-mask':
            bgcache[key] = '#E8F4FB'   # rgba(232,244,251,.94) 近似
            return bgcache[key]
        if key == '.hint-card':
            # rgba(16,48,66,.72) 叠最浅海面 #C9E7ED 的不透明近似（最坏情况，白字仍 ≥4.5:1）
            bgcache[key] = '#446372'
            return bgcache[key]
        if key == '.live-card':
            bgcache[key] = '#FDFCF9'   # rgba(253,252,249,.97) 纸白近似
            return bgcache[key]
        c = collect_bg_color(key, merged, tok, [(s, p) for _, s, p in all_rules])
        bgcache[key] = c
        return c

    rows, fails = [], []
    # 字号 / 触控 检查
    small_fs, small_tap = [], []
    fs_re = re.compile(r'font-size:\s*(\d+)rpx')
    for fp in files:
        rel = os.path.relpath(fp, ROOT)
        txt = open(fp, encoding='utf-8').read()
        for m in fs_re.finditer(txt):
            px = int(m.group(1))
            if px < 30:
                line = txt[:m.start()].count('\n') + 1
                small_fs.append((rel, line, px))

    # 触控：带 min-height/height 且是可点元素的选择器
    TAPPABLE_HINT = ('btn', 'chip', 'pill', 'del', 'skip', 'row', 'item', 'card', 'link')
    for rel, sel, props in all_rules:
        if not any(h in sel.lower() for h in TAPPABLE_HINT):
            continue
        for k in ('min-height', 'height'):
            v = props.get(k)
            if v:
                m = re.match(r'^(\d+)rpx$', v.strip())
                if m and int(m.group(1)) < 88:
                    small_tap.append((rel, sel, k, int(m.group(1))))
                break

    # 对比度：遍历登记的前景
    for fg, (bgkey, note) in EXPLICIT_BG.items():
        props = merged.get(fg)
        if not props:
            continue
        raw = props.get('color')
        if not raw:
            continue
        fgc = resolve(raw, tok)
        if not fgc:
            continue
        bgc = bg_of(bgkey)
        if not bgc:
            continue
        r = cr(fgc, bgc)
        # WCAG 大文字判定：1rpx = 0.5px（750rpx = 375px 视口）
        #   常规 ≥ 24px = 48rpx；加粗 ≥ 14pt(18.66px) = 37.3rpx → 取 38rpx
        fs = resolve_len(props.get('font-size', ''), tok)
        if fs is None:
            fs = 36.0
        bold = any(w in props.get('font-weight', '') for w in ('500', '600', '700', 'bold'))
        need = 3.0 if (bold and fs >= 38) or fs >= 48 else 4.5
        ok = r >= need
        rows.append((fg, fgc, bgc, r, need, ok, note, fs, bold))
        if not ok:
            fails.append((fg, fgc, bgc, r, need, note, fs, bold))

    print("=" * 108)
    print("对比度核算（WCAG 2.2 AA）— 大文字阈值：常规≥48rpx / 加粗≥38rpx 时放宽到 3:1")
    print("=" * 108)
    print(f"{'前景':<20}{'前景色':<10}{'底色':<10}{'对比度':>8}  {'要求':>6}  {'字号':>7} {'结果':<6}说明")
    for fg, fgc, bgc, r, need, ok, note, fs, bold in sorted(rows, key=lambda x: x[3]):
        fsd = f"{fs:g}rpx{'B' if bold else ''}"
        print(f"{fg:<20}{fgc:<10}{bgc:<10}{r:>7.2f}:1  {need:>5.1f}:1  {fsd:>7} {'PASS' if ok else 'FAIL':<6}{note}")

    print()
    print("=" * 96)
    print(f"字号下限 30rpx 违规：{len(small_fs)} 处")
    print("=" * 96)
    for rel, line, px in small_fs:
        print(f"  {rel}:{line}  {px}rpx")

    print()
    print("=" * 96)
    print(f"触控尺寸 <88rpx 可疑：{len(small_tap)} 处")
    print("=" * 96)
    for rel, sel, k, px in small_tap:
        print(f"  {rel}  {sel}  {k}={px}rpx")

    print()
    print("=" * 96)
    print(f"总计：对比度 {len(rows)} 组（FAIL {len(fails)}）｜字号违规 {len(small_fs)}｜触控可疑 {len(small_tap)}")
    print("=" * 96)
    return 1 if (fails or small_fs) else 0

if __name__ == '__main__':
    sys.exit(main())
