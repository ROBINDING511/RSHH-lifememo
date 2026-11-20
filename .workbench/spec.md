---
purpose: 让长辈把一生回忆用"按住说话"记下来，化成冰山漂在属于自己的海上；家人可回听、共建、接住。
user: 一位长辈（妈妈辈，手机经验有限）；第二读者=孩子（鲸鱼杭航），只读+反应+投喂问题，不登录为"类型"。
surface: phone            # 微信小程序 ≈ h5 手机路线
structure: { primary: ledger, secondary: registry }
moment: 想起往事的那一下 / 睡前安静时 / 孩子探望时（反思态，非任务态）
dials: { CADENCE: 5, INPUT: 2, DEPTH: 8 }   # INPUT(按住说一段≈20-60s 单动作) 远低于 DEPTH(海/那年今日/回听/家人反应/声音)
hook:
  - clause: "去年今天，你说了一段《第一次去肯德基》· 想再听一遍吗"
    field: iceberg.createdAt + title
    writer: derived（createdAt 由系统在发布时落；"去年今天"=now 与 createdAt 同月日匹配）
    cadence: 每次打开实时算
    day_one: "海还空着 · 按住说一段，第一座冰山就落下来"
    skipped_day: 无同年今日时退化为提示卡（不谎报"去年今天"）
  - clause: "今天想记点什么？小时候最香的味道是什么？"
    field: prompt（静态池 derived）+ family_questions（孩子写）
    writer: derived / user(孩子投喂优先)
    cadence: 每次打开换一条
    day_one: 同提示卡
    skipped_day: 提示卡恒在（不依赖数据）
cold_start:
  day_1: "海还空着。按住下面的青色按钮，说一段小时候的事，第一座冰山就落下来。"
  day_2: "昨天那座冰山还在海上 · 想再听一遍吗"
  day_7: "这片海已有 N 座冰山 · 点一座听听当时的声音"
  re_entry: "好久没来 · 海还在，杭航也在 · 想记点什么随时说"   # 不制造愧疚
home:                      # 首屏从上到下
  - hook 行（那年今日 / 提示卡，二选一，安静胶囊）
  - 整片日落水彩海（2D 可拖/捏合；冰山+红旗+鲸鱼；唯一富色时刻）
  - 拇指区：按住说话（主操作，底部）
  - 右上：海浪声开关（安静文字钮）
channels:
  - { name: 海, type: today, weight: primary, does: 按住说一段回忆→复核→化成冰山；拖/捏合看海；点冰山回听 }
  - { name: 时间轴, type: review, weight: secondary, does: 按年份翻一生冰山；点进详情听原声/补录 }
  - { name: 云朵, type: review, weight: secondary, does: 看化云的回忆（5 天飘散倒计时）；落回海面接住 }
  - { name: 杭航, type: tool, weight: secondary, does: 划片海/改名/改边界；人生节点；年纪；家人邀请/投喂；声音克隆管理；海浪声 }
mvp: [海, 时间轴, 云朵, 杭航]
later: [导出成书/礼物链路, 声音克隆激活(需百炼key), WechatSI 混合ASR, 体验版上架]
visual: 水彩纸与海——暖纸中性阶+发丝描边+单一墨青强调；富色只留在海与鲸鱼；安静、不催促（unslop 方向）
seam: deferred            # 礼物/成书 grows out of 家人/时间轴 module；不做贴边广告；不在焦虑模块变现
excluded: [社交feed, 打卡gamification, 监督式 deficit hook, 全 pill/渐变/glow/emoji]
deferred: [声音克隆key激活, WechatSI, 导出成书, 体验版]
---

# 人生海海 · Workbench Spec

## 它是谁的台子
一位妈妈辈长辈的"回忆台"。她反复做的一件事＝**按住说一段回忆**；数据她自己写（语音→文字→冰山）；台子必须有性格（海/鲸鱼/红旗），中性的没有第二次打开的理由。孩子（杭航）是第二读者：回听、点"想听/抱抱"、投喂问题——**两个读者一个面**，同一句话对两人都要真且_kind_。

## 证据
她已经在用微信语音消息/备忘录零散记往事；弃用过"要打字、要注册、要选分类"的记录 App。按住说话＋自动归海＝把输入税降到接近零。

## 普通的一天
睡前想起小时候的事 → 打开 → 首屏一句"去年今天你说了一段…想再听吗"或一条提示 → 按住说 30 秒 → 松手字已出来 → 下拉复核卡改两个字/确认海 → 变成冰山（插红旗 5 分钟）→ 孩子那边收到"想听" → 她第二天回来看到"杭航想听/抱抱了 N 次" → 再记一段。**INPUT≈一次按住；DEPTH＝海+回听+家人回流+那年今日。**

## 为什么这些模块
海=primary(ledger 的积累视觉)；时间轴/云朵=review(registry 的翻找+接住)；杭航=tool(配置/家人/声音)。**无 Knowledge 频道**（不是百科）；**有 Review**（积累有回响）；4 频道≤9 且可心智持有。

## 留下没做
导出成书/礼物（seam，待家人模块稳定）、声音克隆激活（依赖百炼 key）、WechatSI（依赖插件审批）、体验版（依赖审核）。**不做的**：社交 feed、打卡、监督式 deficit、全 pill/渐变/glow/emoji。

## 给实现方
- surface=phone → 走 **h5 手机路线**：拇指区主操作在底部、安全区算进 padding、44px 触控、body 锁死/容器滚动、底部 sheet 用原生家具、tap-highlight 关闭。
- channels → 导航：海=首屏；时间轴/云朵/杭航 收进"杭航"hub 顶部入口（主海面保持干净）。
- hook → 首屏第一行（那年今日/提示卡），**空态=真实图槽**（空海+第一座冰山引导），不是 "--"。
- structure.primary=ledger → 主导显示=积累的海/时间轴曲线，而非表格。
- entities（数据底座）：iceberg{text,audioFileID,photos,zoneName,memoryTime,createdAt,deleted,deletedAt,offX,offY}，writer：text/audio/zone=user(发布时)、createdAt/deletedAt=system、offX/offY=user(拖拽)、"去年今天"/count=derived；family_questions/reactions writer=孩子；voice_profile writer=system(克隆)+user(确认)。
- 动效：跟手/可中断/速度衔接（抽屉 velocity 吸附）；仅一次入场 stagger；reduced-motion 全关；**无循环装饰动效**（海漂移+鲸鱼游弋为"活的世界"例外）。
- 反廉价：无 hue 渐变/glow/彩阴影/emoji/全 pill/宽字距；暖中性阶+发丝+单一强调。