# 07 — Narrative voice (為什麼 GM 讀起來像 AI，以及怎麼修)

Owner file: `lib/ai/style.ts` (`narrativeStyleBlock`). Consumers: `lib/ai/gm.ts`
(per-turn narration), `lib/ai/ending-narration.ts` (epilogue).

## The diagnosis

The GM's style section used to be **almost entirely prohibitions** — a ban list
with no positive model — and the ending epilogue had **no style rules at all**.

A model told only what *not* to do falls back to its default register. That
default is formal, evenly-textured and summarising, which is exactly what
readers call 「AI味」. Bans alone cannot fix it: they remove the worst tics and
leave the register untouched.

## What 網文 readers actually respond to

Distilled from Chinese writing-craft sources (see Sources):

| AI味 | 網文 |
|---|---|
| 書面語、正式 | 口語、像說話 |
| 敘述事件（「他表示他不知道」） | 演出來：對話、動作、細節 |
| 每句長度一樣 | 長短交錯，一句話也可以自成一段 |
| 形容詞堆疊、狀語堆疊 | 一個準確的動詞 |
| 直接說出情緒 | 用身體反應帶出情緒 |
| 用套語點名氣氛（「空氣中瀰漫著」） | 給出造成氣氛的那個具體東西 |

## The rules that came out of it

`narrativeStyleBlock()` is written **DO-rules first, bans second** — the
positive spec changes the register, the bans only stop backsliding. It ends
with a worked 對照範例 (same beat written badly, then well), because examples
move a model far more than rules do.

Two constraints the block must never violate:

1. **Language isolation.** The cliché list, the worked example, and every
   inline illustration are language-matched. A non-zh scenario must never see
   Chinese sample prose — it fights `gm.ts`'s LANGUAGE RULE, and sample prose in
   the wrong script is exactly what a model copies. Covered by tests.
2. **Voice never overrides game integrity.** `gm.ts` keeps a separate
   INFORMATION DISCIPLINE section: nothing unearned enters the prose, no
   explaining what clues mean, no foreshadowing. The voice block may make the
   telling livelier; it may not make it leak.

## The one deliberate loosening

The old rule banned *all* interiority ("the narration is a camera, not an
analyst"). That is correct for **conclusions** and wrong for **bodily
reaction** — 手心的汗、退了半步 is something a camera sees, and it is the main
way a web novel conveys feeling without narrating it.

So: **bodily sensations allowed, conclusions/hunches/realisations still banned.**
The epilogue relaxes even this (`EPILOGUE EXCEPTION`) because the game is over
and the mystery no longer needs protecting.

## If the prose still feels flat

Check in this order:

1. Is the model actually **quoting speech**? Reported speech is the single
   loudest AI tell, and the first rule to regress.
2. Are paragraphs **1–3 sentences**? Long even blocks mean the block is being
   ignored — check it is still reaching the prompt (`buildSystemPrompt`).
3. Is every sentence the **same length**? That is the machine signature.
4. Only then consider sampling. `temperature` is 0.8 (`gm.ts`). Ornate-but-
   hollow prose is a *prompt* problem; do not tune temperature to fix voice
   without an A/B on real turns.

## Sources

- [去「AI味兒」大作戰 · 人人都是產品經理](https://www.woshipm.com/share/6054640.html)
- [用AI寫網文時的「爆改文風」提示詞 · 運營派](https://www.yunyingpai.com/personal/1029559.html)
- [為什麼AI寫小說總有很重的機器味 · 知乎](https://zhuanlan.zhihu.com/p/2059628957218108274)
- [網文編輯：圍剿AI · 知乎](https://zhuanlan.zhihu.com/p/27226738968)
- [懸疑小說，怎麼讓人脊背發涼 · 中國作家網](https://www.chinawriter.com.cn/n1/2022/0901/c441011-32517558.html)
- [52個網文寫作技巧 · 知乎](https://zhuanlan.zhihu.com/p/590833934)
