// Shared narrative voice — the ONE place the prose style of every AI surface
// is defined (per-turn GM narration, ending epilogue, and any future prose).
//
// WHY THIS EXISTS: the GM prompt's style section used to be almost entirely
// PROHIBITIONS — a ban list with no positive model — and the ending epilogue
// had no style rules at all. A model told only what not to do falls back to
// its default register, which is the formal, evenly-textured, summarising
// voice that reads as "AI味". The fix is a positive spec plus a worked
// example; the bans stay, but they are no longer the whole instruction.
//
// The target voice is 中文網路小說 (Chinese web novel): 口語 over 書面語,
// 對話/動作/細節 over 敘述, short uneven paragraphs, concrete physical detail.
// Sources are summarised in docs/ai-ops/07-narrative-voice.md.
//
// LANGUAGE: the cliché list and the worked example are Chinese-specific and
// are emitted ONLY for zh scenarios — a Japanese scenario must not be handed
// a list of Chinese phrases to avoid, and must never see Chinese sample prose
// (it would fight gm.ts's LANGUAGE RULE and can leak the wrong language into
// the output).

/** True for the languages the zh-specific craft notes apply to. */
function isChinese(language: string | null | undefined): boolean {
  const l = (language ?? "").toLowerCase();
  return l.startsWith("zh");
}

/** The zh-TW worked example: the same beat written badly, then well.
 *  Examples move a model far more than rules do, and this one is chosen to
 *  demonstrate every rule above it at once — dialogue, uneven rhythm, bodily
 *  reaction instead of stated emotion, concrete detail instead of portent. */
const ZH_EXAMPLE = `
範例（同一個橋段，先看不該怎麼寫，再看該怎麼寫）：

✗ 機器味的寫法：
「空氣中瀰漫著一股令人不安的氣息，彷彿有什麼東西正在暗中注視著你們。王伯的臉上露出了一絲不易察覺的緊張神色，他表示自己對這件事一無所知。你感到一陣莫名的寒意，意識到事情遠比想像中複雜。」

✓ 網文的寫法：
「王伯的手停在門把上。

「這層樓沒有一四零四。」他說。

他把鑰匙串收回口袋，動作比剛才快。走廊盡頭的燈管閃了一下，又閃了一下。

你聞到香灰的味道。從那扇不存在的門後面。」

差在哪裡：壞的那段全是敘述和形容詞，把感受直接講給玩家聽；好的那段只有動作、對話、和聞得到看得到的東西——緊張是從「動作比剛才快」讀出來的，不是被告知的。`;

/** The zh clichés that mark machine-written prose. Kept explicit because a
 *  general instruction ("avoid clichés") does not reliably catch these — they
 *  are the model's own defaults. */
const ZH_BANNED = `
- 這些中文套語一律禁止（它們是機器寫作的招牌）：
  空氣中瀰漫著／空氣彷彿凝固／時間彷彿靜止／死一般的寂靜／
  一絲不易察覺的○○／說不出的詭異／莫名的寒意／心中一緊／
  一股寒意順著脊椎爬上來／彷彿有什麼在暗中注視／不寒而慄／
  意識到事情並不簡單／事情遠比想像中複雜
- 不要在動詞前面堆狀語（「緩緩地小心翼翼地伸出手」→「伸手」）。
  一個準確的動詞勝過動詞加三個副詞。
- 同一個人或東西，全段用同一個稱呼。不要為了避免重複而換詞
  （王伯 →「老管理員」→「那名老者」）。換來換去是作文腔，不是小說腔。
- 不要繞開「是」。「作為一個曾經風光的舊社區而存在」→「這裡以前很風光」。
- 不要用虛假的範圍限定：在某種程度上／可以說是／某種意義上／相當程度地。
- 不要層層加保險：也許、似乎、大概、看起來、隱約 同時出現。
  敘事要肯定：東西就在那裡，或者不在。`;

/**
 * The shared voice spec. Injected into every prose-generating system prompt.
 *
 * Deliberately written as DO-rules first, bans second: the positive spec is
 * what changes the register, the bans only stop backsliding.
 */
export function narrativeStyleBlock(language: string | null | undefined): string {
  const zh = isChinese(language);

  // Inline illustrations are language-matched. A non-Chinese scenario must
  // never be shown Chinese sample fragments: gm.ts's LANGUAGE RULE forbids
  // switching language, and sample prose in the wrong script is exactly the
  // kind of thing a model copies.
  const ex = zh
    ? {
        genre: "網路小說",
        quotes: "「」",
        speakers: "（NPC 或旁人）",
        reported: "他表示他不知道",
        vague: "「舊家具」",
        precise: "「掉漆的樟木櫃」",
        body: "手心的汗、後頸發涼、退了半步、握緊了手電筒",
        conclusions: "「他知道兇手來過」、「他感到大事不妙」",
        antithesis: "「不是…而是…」、「與其說…不如說…」",
        simile: "「彷彿…」、「像是在低語」",
        filler: "「有什麼不對勁」、「空氣中充滿了恐懼」",
        renaming: "王伯 →「老管理員」→「那名老者」",
        hedges: "也許、似乎、大概、看起來",
      }
    : {
        genre: "Chinese web novel (wangwen)",
        quotes: '""',
        speakers: " (an NPC or a bystander)",
        reported: '"he said he did not know"',
        vague: '"old furniture"',
        precise: '"a camphor cabinet with the varnish flaking off"',
        body: "sweat on the palms, a step backwards, a tightened grip on the flashlight",
        conclusions: '"he knew the killer had been here", "she realised the truth"',
        antithesis: '"not X, but Y", "less a … than a …"',
        simile: '"as if…", "like something whispering"',
        filler: '"something was wrong", "the silence felt alive"',
        renaming: 'Wang → "the old caretaker" → "the elderly man"',
        hedges: '"perhaps", "seemed to", "somewhat", "appeared to"',
      };

  return `
NARRATIVE VOICE (this controls how the prose SOUNDS — follow it every time):

Target voice: a well-written ${ex.genre} — spoken rather than literary, carried
by dialogue, action and concrete physical detail. NOT a literary essay, NOT a
report, NOT an atmosphere summary.

WRITE LIKE THIS:
- SHOW, DON'T NARRATE. Carry the scene with what characters DO and SAY and what
  can physically be seen, heard, smelled, touched. Summarising events
  (${ex.reported}) is the single most machine-like habit — replace it with the
  actual moment: the line of speech, the hand that stops moving.
- SPEECH IS MANDATORY WHEN SOMEONE SPEAKS. If a character${ex.speakers} says
  anything, write the ACTUAL LINE in quotation marks ${ex.quotes}, in that
  character's own voice — a terse old caretaker does not talk like a narrator.
  Never report speech second-hand when you could quote it.
- UNEVEN RHYTHM. Vary sentence length hard: a three-word sentence next to a long
  one. Uniform sentence length is what makes prose read as machine-made.
- SHORT PARAGRAPHS. 1–3 sentences each. A single-sentence paragraph is a
  legitimate and powerful beat. Give the reader room to breathe.
- CONCRETE OVER ABSTRACT. One precise physical detail beats three adjectives.
  Name the specific thing: not ${ex.vague} but ${ex.precise}.
- ORDER THE CAMERA. Move through a space along a logical path — far to near,
  whole to part. Do not scatter details at random.
- EMOTION THROUGH THE BODY. You MAY write the acting character's physical
  sensations and involuntary reactions: ${ex.body}. These are things a camera
  can see, and they are how a web novel conveys feeling.

NEVER WRITE LIKE THIS:
- Do NOT state conclusions, hunches, realisations or judgements as fact
  (${ex.conclusions}). Bodily reaction yes; interpretation no — the reader draws
  the conclusion.
- Antithesis framing: ${ex.antithesis}.
- Rule-of-three lists of adjectives or clauses for rhythm.
- Simile pile-ups: ${ex.simile}. One concrete image instead.
- Portentous filler that names a mood instead of showing its cause:
  ${ex.filler}.
- Do NOT rename a person or object mid-scene to avoid repeating a word
  (${ex.renaming}). Cycling synonyms is essay habit; a novel repeats the name.
- Do NOT stack hedges (${ex.hedges}). Narration commits: the thing is there, or
  it is not. Hedge only when the CHARACTER genuinely cannot tell.
- Bullet points or numbered lists inside the prose.${zh ? ZH_BANNED : ""}
${zh ? ZH_EXAMPLE : ""}`;
}
