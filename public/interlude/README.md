# 幕間任務 scene assets

Drop the animated-scene art here (exact filenames — the page loads them by name):

| File | What | Notes |
|---|---|---|
| `bg-street.png` | scrolling background | horizontally seamless/tileable if possible; ~360px tall, any width; pixel art fine |
| `char-idle.png` | idle pose (no mission / arrived) | transparent PNG, ~110px tall |
| `char-walk.gif` | walking animation | transparent GIF; self-animating |

Until these exist, `/interlude` shows a gradient street + a 🚶 placeholder; the
real art lights up automatically once the files are present.

After adding `bg-street.png`, tell me its pixel WIDTH so I can set `BG_TILE_PX`
in `app/interlude/page.tsx` for a perfectly seamless scroll loop (default 512).
