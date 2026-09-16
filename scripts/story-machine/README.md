# Story Machine — 把一篇故事變成可匯入的劇本

輸入一份完整的故事（Markdown 或純文字），機器會反覆跑「作者 AI → 程式驗證 → 評審 AI → 作者修改」，直到產出一份通過平台匯入檢查與發佈門檻的 `scenario.json`。

## 為什麼這樣設計

- **驗證器是純程式，不是 AI。** 它直接呼叫平台匯入時用的整理器（`normalizeImported`）、匯入報告（`buildImportReport`）和送審門檻（`checkScenarioQuality`），再加上結局／NPC 情報的引用檢查。兩個 AI 互評容易互相同意；驗證器說不過就是不過，這是迴圈會收斂的原因。
- **格式說明書從程式碼產生。** 作者拿到的 JSON 規則來自 `lib/ai/scenario-json-prompt.ts`，跟 `/scenarios/prompt` 頁面同一份；遊戲格式改了，機器自動跟著改。
- **每個角色都是「stdin 進、stdout 出」的指令。** 作者和評審預設用不同的模型（Claude 寫、Codex 評），但任何 CLI 都能替換。

## 需要什麼

- 本專案裝好依賴（`npm ci`）
- `claude` CLI（Claude Code）與 `codex` CLI，兩個都要登入過。只有一個也行，見下方「只用一個模型」。

## 用法

```bash
scripts/story-machine/run.sh my-story.md
```

輸出在 `my-story` 同目錄的 `out/`：

| 檔案 | 內容 |
|---|---|
| `roundN.prompt.txt` | 第 N 輪給作者的完整 prompt |
| `roundN.json` | 第 N 輪作者產出的 JSON |
| `roundN.report.txt` / `.json` | 驗證器報告（阻斷／警告／資訊） |
| `roundN.critic.txt` | 評審意見 |
| `scenario.json` | 最後通過（或最後一輪）的版本 |

通過後：打開平台「建立劇本 → 貼上 JSON」，貼入 `scenario.json`，按匯入。匯入報告應該是乾淨的，因為驗證器跑的就是同一套檢查。

### 調整

```bash
MAX_ROUNDS=5 scripts/story-machine/run.sh my-story.md
WRITER_CMD='claude -p --model opus' CRITIC_CMD='claude -p --model sonnet' scripts/story-machine/run.sh my-story.md
```

只用一個模型時，讓評審用不同的 model 或至少是一個乾淨的 session（`claude -p` 每次都是新 session）。效果比跨模型弱一點，但驗證器仍然是硬的。

### 單獨跑某一步

```bash
npm run story-machine -- validate out/round1.json          # 只看驗證器
npm run story-machine -- writer-prompt my-story.md > p.txt  # 拿 prompt 去別的地方用
```

## 什麼是「通過」

1. 驗證器沒有任何**阻斷**（格式錯、引用不存在、內容被截掉、發佈門檻沒過）
2. 評審沒有任何 **blocking**（見 `rubric.md`：偷加劇情、目標不是事件、目標是複合句、NPC 沒條件、線索沒地點、結局到不了、簡介洩題）

驗證器的**警告**不擋，但會一併餵給評審和作者，通常會被順手修掉。

## 它做不到的事

- 判斷好不好玩、節奏對不對。這需要人試玩。
- 保證故事本身適合這個引擎。如果故事的祕密不附著在「地點 + 動作」上，作者只能硬拆——這時候先用平台上的「我只有一個點子」訪談 prompt 把故事改造，再丟進機器。
- 直接上傳到平台。最後一步是手動貼 JSON（需要登入）。
