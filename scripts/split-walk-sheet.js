#!/usr/bin/env node
/**
 * Turn a walk-cycle sheet into the game's sprite assets.
 *
 *   node scripts/split-walk-sheet.js art-source/char-walk-sheet.png
 *
 * Writes public/interlude/char-walk-frames.png (8 cells, 172x300 each) and
 * public/interlude/char-idle.png (the narrowest pose, so standing and walking
 * are the same drawing). Requires `sharp` — this is a one-off art tool, not an
 * app dependency, so install it ad hoc: `npm i --no-save sharp`.
 *
 * WHY EACH STEP EXISTS (all of these were real defects on the first sheet):
 *  - Frames are cut at ink VALLEYS near the expected boundaries, not at blank
 *    columns: adjacent poses overlap, so blank-column splitting finds only 7
 *    gaps for 8 frames and slices a lantern in half.
 *  - Frames are aligned on the HEAD centroid, not the bounding box: the coat
 *    and legs change width every frame, so bbox-centring makes the character
 *    slide sideways as it walks.
 *  - White is keyed out with a soft edge AND the edge pixels are darkened back
 *    toward their own colour, or a pale halo appears against the dark street.
 *  - Only the largest connected blob per cell is kept: a neighbour's trailing
 *    foot otherwise survives the cut as a boot floating in mid-air.
 *  - The output cell is EXACTLY 2x the display size (172 -> 86). An odd cell
 *    width makes background-position drift half a pixel per step, which shows
 *    up as a sliver of the next frame creeping in.
 */
// Split the walk sheet into normalized, transparent, baseline-aligned frames.
const sharp = require("sharp");
const fs = require("fs");
const SRC = process.argv[2] || "art-source/char-walk-sheet.png";
const OUT = "/tmp/_walk-sheet-raw.png";
const N = 8;

const isBgPx = (r,g,b,a) => a < 16 || (r > 238 && g > 238 && b > 238);

(async () => {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const at = (x,y) => (y*W+x)*C;

  // Ink per column. Frame gaps are valleys; a naive "fully blank column" split
  // fails here because frame 1's trailing foot overlaps frame 2's column range.
  const ink = new Array(W).fill(0);
  for (let x=0;x<W;x++) for (let y=0;y<H;y++) {
    const i=at(x,y); if(!isBgPx(data[i],data[i+1],data[i+2],data[i+3])) ink[x]++;
  }

  // Search a window around each expected boundary for the emptiest column.
  const bounds = [0];
  for (let k=1;k<N;k++){
    const exp = Math.round(k*W/N), win = 75;
    let best = exp, bestInk = Infinity;
    for (let x=Math.max(1,exp-win); x<=Math.min(W-2,exp+win); x++){
      // Prefer emptier columns; break ties toward the expected position so the
      // cut never wanders far into a neighbouring pose.
      if (ink[x] < bestInk || (ink[x] === bestInk && Math.abs(x-exp) < Math.abs(best-exp))) { bestInk=ink[x]; best=x; }
    }
    bounds.push(best);
  }
  bounds.push(W);

  // Per-frame bbox + a STABLE horizontal anchor. Centring on the bbox would
  // make the character slide sideways as the coat and legs swing; the head
  // barely moves during a walk, so its centroid is the honest anchor.
  const frames = [];
  for (let f=0; f<N; f++){
    const x0=bounds[f], x1=bounds[f+1]-1;
    let minX=W, maxX=-1, minY=H, maxY=-1;
    for (let y=0;y<H;y++) for (let x=x0;x<=x1;x++){
      const i=at(x,y); if(isBgPx(data[i],data[i+1],data[i+2],data[i+3])) continue;
      if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
    }
    const headBand = minY + Math.round((maxY-minY)*0.18);
    let sum=0, count=0;
    for (let y=minY;y<=headBand;y++) for (let x=x0;x<=x1;x++){
      const i=at(x,y); if(isBgPx(data[i],data[i+1],data[i+2],data[i+3])) continue;
      sum+=x; count++;
    }
    const anchorX = count ? Math.round(sum/count) : Math.round((minX+maxX)/2);
    frames.push({ x0,x1,minX,maxX,minY,maxY,anchorX });
  }

  const baseline = Math.max(...frames.map(f=>f.maxY));
  console.log("baseline (feet) y =", baseline);
  frames.forEach((f,i)=>console.log(`  f${i+1}: cut ${f.x0}-${f.x1}  bbox x ${f.minX}-${f.maxX} y ${f.minY}-${f.maxY}  anchorX ${f.anchorX}  footY ${f.maxY}`));

  // Uniform cell: widest reach either side of the anchor, tallest above the
  // baseline. Every frame keeps its own silhouette, aligned on anchor+baseline.
  const leftMax  = Math.max(...frames.map(f=>f.anchorX - f.minX));
  const rightMax = Math.max(...frames.map(f=>f.maxX - f.anchorX));
  const topMax   = Math.max(...frames.map(f=>baseline - f.minY));
  const cellW = leftMax + rightMax + 1 + 8;   // small breathing room
  const cellH = topMax + 1 + 6;
  const anchorInCell = leftMax + 4;
  console.log(`cell ${cellW}x${cellH}, anchor at x=${anchorInCell}, baseline at y=${cellH-6}`);

  // Alpha key with de-fringe: fully white → transparent; near-white edge pixels
  // get partial alpha AND are darkened back toward their own colour, which is
  // what stops a pale halo appearing against the dark street.
  const sheet = Buffer.alloc(cellW*N*cellH*4, 0);
  const SW = cellW*N;
  for (let f=0; f<N; f++){
    const fr = frames[f];
    const dx = f*cellW + anchorInCell - fr.anchorX;
    const dy = (cellH-6) - baseline;
    for (let y=fr.minY;y<=fr.maxY;y++) for (let x=fr.x0;x<=fr.x1;x++){
      const i=at(x,y);
      let r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
      if (a < 16) continue;
      const lo = Math.min(r,g,b);
      if (lo > 244) continue;                 // background
      if (lo > 216) {                          // antialiased edge
        const t = (lo-216)/(244-216);          // 0 = solid, 1 = background
        a = Math.round(a*(1-t));
        if (a <= 2) continue;
        const k = 1-t*0.55;                    // pull the wash back out
        r=Math.round(r*k); g=Math.round(g*k); b=Math.round(b*k);
      }
      const X=x+dx, Y=y+dy;
      if (X<0||X>=SW||Y<0||Y>=cellH) continue;
      const o=(Y*SW+X)*4;
      sheet[o]=r; sheet[o+1]=g; sheet[o+2]=b; sheet[o+3]=a;
    }
  }
  // Adjacent poses overlap, so a cut can leave a neighbour's trailing foot
  // stranded in this cell — a boot floating in mid-air beside the character.
  // Keep only the largest connected blob per cell; the figure is always one
  // connected silhouette, and debris never is.
  for (let f = 0; f < N; f++) {
    const x0 = f*cellW, x1 = x0 + cellW - 1;
    const label = new Int32Array(cellW*cellH).fill(-1);
    const sizes = [];
    const idx = (x,y) => (y-0)*cellW + (x-x0);
    for (let y = 0; y < cellH; y++) for (let x = x0; x <= x1; x++) {
      if (sheet[(y*SW+x)*4+3] < 24 || label[idx(x,y)] !== -1) continue;
      const id = sizes.length; let n = 0;
      const stack = [[x,y]]; label[idx(x,y)] = id;
      while (stack.length) {
        const [cx,cy] = stack.pop(); n++;
        for (const [ax,ay] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
          if (ax < x0 || ax > x1 || ay < 0 || ay >= cellH) continue;
          if (sheet[(ay*SW+ax)*4+3] < 24 || label[idx(ax,ay)] !== -1) continue;
          label[idx(ax,ay)] = id; stack.push([ax,ay]);
        }
      }
      sizes.push(n);
    }
    let keep = -1, best = 0;
    sizes.forEach((n,i) => { if (n > best) { best = n; keep = i; } });
    let wiped = 0;
    for (let y = 0; y < cellH; y++) for (let x = x0; x <= x1; x++) {
      const l = label[idx(x,y)];
      if (l !== -1 && l !== keep) { const o = (y*SW+x)*4; sheet[o+3] = 0; wiped++; }
    }
    if (wiped) console.log(`  f${f+1}: removed ${sizes.length-1} stray blob(s), ${wiped}px`);
  }

  await sharp(sheet, { raw: { width: SW, height: cellH, channels: 4 } }).png().toFile(OUT);

  // Export at exactly 2x the display cell.
  const DISP_W = 86, DISP_H = 150, SRC_W = DISP_W * 2, SRC_H = DISP_H * 2;
  const cells = [];
  for (let f = 0; f < N; f++) {
    cells.push(await sharp(OUT)
      .extract({ left: f * cellW, top: 0, width: cellW, height: cellH })
      .resize({ width: SRC_W, height: SRC_H, fit: "fill", kernel: "lanczos3" })
      .png().toBuffer());
  }
  const out = await sharp({ create: { width: SRC_W * N, height: SRC_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: i * SRC_W, top: 0 })))
    .png({ palette: true, colors: 200, effort: 10 }).toBuffer();
  fs.writeFileSync("public/interlude/char-walk-frames.png", out);

  // Idle = the narrowest silhouette (legs closest together).
  let idleIdx = 0, narrowest = Infinity;
  for (let f = 0; f < N; f++) {
    const fr = frames[f];
    const w = fr.maxX - fr.minX;
    if (w < narrowest) { narrowest = w; idleIdx = f; }
  }
  fs.writeFileSync("public/interlude/char-idle.png",
    await sharp(cells[idleIdx]).png({ palette: true, colors: 200, effort: 10 }).toBuffer());

  console.log(`wrote public/interlude/char-walk-frames.png ${SRC_W * N}x${SRC_H} (cell ${SRC_W}x${SRC_H}, display ${DISP_W}x${DISP_H})`);
  console.log(`wrote public/interlude/char-idle.png (frame ${idleIdx + 1}, narrowest pose)`);
  console.log("If the cell size changes, update CHAR_CELL_W/H in app/interlude/page.tsx and steps(N) in app/globals.css.");
})();
