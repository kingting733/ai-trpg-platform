# 幕間任務 scene assets

| File | What | Notes |
|---|---|---|
| `bg-street.png` | scrolling background | horizontally SEAMLESS (right edge must continue into left edge); ~360px tall, wide (≥4:1) |
| `char-walk-frames.png` | walk cycle, 8 frames | generated — do not hand-edit |
| `char-idle.png` | idle pose | generated — cut from the same sheet |

## Regenerating the character

The two character files are BUILT from `art-source/char-walk-sheet.png` by:

```
npm i --no-save sharp
node scripts/split-walk-sheet.js art-source/char-walk-sheet.png
```

Drop a new 8-frame sheet at that path and re-run. The script cuts the frames,
keys out the background, aligns every pose on the head and the feet, removes
debris left by overlapping frames, and writes both files at exactly 2x the
display size.

New sheet requirements: 8 frames left-to-right, side view facing RIGHT, a
readable gap between poses, and all feet on one baseline.

If you change the frame count or cell size, update `steps(8)` in
`app/globals.css` and `CHAR_CELL_W/H` in `app/interlude/page.tsx`.
