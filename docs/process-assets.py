#!/usr/bin/env python3
"""处理人生海海小程序素材：量化 PNG、压缩 JPEG，分离本地包内素材与 CDN 素材"""
import os
from PIL import Image

SRC = "/Users/zhaozixin/Documents/人生海海-正式素材-等距风/images"
PROJ = "/Users/zhaozixin/WorkBuddy/2026-11-15-10-00-27/人生海海"

def quantize_png(src, dst, max_w=None):
    """PNG 量化为 256 色调色板模式，平面色块风格损失极小"""
    img = Image.open(src)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        if max_w and img.width > max_w:
            h = int(img.height * max_w / img.width)
            img = img.resize((max_w, h), Image.LANCZOS)
        alpha = img.getchannel("A")
        img = img.convert("RGB").quantize(colors=256, method=Image.FASTOCTREE)
        img = img.convert("RGB").convert("P")
        # 恢复透明度
        p_img = Image.new("RGBA", img.size)
        p_img.paste(img.convert("RGB"), (0, 0))
        p_img.putalpha(alpha)
        p_img.save(dst, optimize=True)
    else:
        img = img.convert("RGB").quantize(colors=256, method=Image.FASTOCTREE)
        img.save(dst, optimize=True)

def to_jpeg(src, dst, max_w=1200, q=78):
    img = Image.open(src).convert("RGB")
    if img.width > max_w:
        h = int(img.height * max_w / img.width)
        img = img.resize((max_w, h), Image.LANCZOS)
    img.save(dst, "JPEG", quality=q, optimize=True)

def size(path):
    return os.path.getsize(path) // 1024

total_before = total_after = 0

# 1) 本地包内：misc 小 UI（量化）
for f in ["logo.png", "btn-record.png", "btn-back.png", "btn-settings.png",
          "cloud.png", "empty-state.png", "error-whale.png", "recording-whale.png"]:
    s, d = f"{SRC}/misc/{f}", f"{PROJ}/miniprogram/images/misc/{f}"
    quantize_png(s, d, max_w=280)
    total_before += os.path.getsize(s); total_after += os.path.getsize(d)
    print(f"misc/{f}: {size(s)}K -> {size(d)}K")

# 2) 本地包内：默认冰山占位（中型 + 大型 + 小型，供 CDN 未配置时兜底）
for f in ["iceberg-小型.png", "iceberg-中型.png", "iceberg-大型.png", "iceberg-尖峰型.png", "iceberg-平台型.png"]:
    s, d = f"{SRC}/watercolor/{f}", f"{PROJ}/miniprogram/images/watercolor/{f}"
    quantize_png(s, d, max_w=300)
    total_before += os.path.getsize(s); total_after += os.path.getsize(d)
    print(f"local watercolor/{f}: {size(s)}K -> {size(d)}K")

# 3) CDN：全部 31 张冰山（含海域色变体，量化 340px）
for f in sorted(os.listdir(f"{SRC}/watercolor")):
    if not f.endswith(".png") or f == "whale.png":
        continue
    d = f"{PROJ}/cdn-upload/watercolor/{f}"
    quantize_png(f"{SRC}/watercolor/{f}", d, max_w=340)
    total_before += os.path.getsize(f"{SRC}/watercolor/{f}"); total_after += os.path.getsize(d)

# 4) CDN：背景图（JPEG）
for f in ["ocean-far.png", "ocean-mid.png", "ocean-near.png"]:
    d = f"{PROJ}/cdn-upload/misc/{f.replace('.png', '.jpg')}"
    to_jpeg(f"{SRC}/misc/{f}", d)
    total_before += os.path.getsize(f"{SRC}/misc/{f}"); total_after += os.path.getsize(d)
    print(f"cdn misc/{f}: {size(f'{SRC}/misc/{f}')}K -> {size(d)}K")

# 5) 分包：引导图（JPEG）
for f in sorted(os.listdir(f"{SRC}/guide")):
    if not f.endswith(".png"):
        continue
    d = f"{PROJ}/miniprogram/packageGuide/pages/guide/{f.replace('guide-', '').replace('.png', '.jpg')}"
    to_jpeg(f"{SRC}/guide/{f}", d, max_w=750, q=75)
    total_before += os.path.getsize(f"{SRC}/guide/{f}"); total_after += os.path.getsize(d)
    print(f"guide/{f}: {size(f'{SRC}/guide/{f}')}K -> {size(d)}K")

# 6) CDN：分享封面
to_jpeg(f"{SRC}/guide/share-cover.png", f"{PROJ}/cdn-upload/misc/share-cover.jpg", max_w=600, q=80)

print(f"\n总计: {total_before//1024}M -> {total_after//1024}K")
