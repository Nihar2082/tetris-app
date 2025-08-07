import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";

/**
 * Tetris – React + Canvas
 * Desktop: ←/→ move, ↓ soft-drop, ↑/X rotate CW, Z rotate CCW, Space hard-drop, Shift/C hold, P pause, R restart
 * Mobile:  tap=rotate, swipe L/R=move, swipe down=soft-drop, swipe up=hard-drop + on-screen controls
 */

export default function TetrisCanvas() {
  // ----- Game constants -----
  const COLS = 10;
  const ROWS = 20;

  // responsive cell size (auto-fit)
  const [cell, setCell] = useState(28);
  const WELL_W = COLS * cell;
  const WELL_H = ROWS * cell;

  const DROP_BASE_MS = 1000; // start drop speed

  // Refs
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null); // container used to compute available width
  const holdTimerRef = useRef(null); // for repeating mobile button actions
  const touchStartRef = useRef(null); // track swipe start
  const lastSwipeRef = useRef(0); // debounce swipes

  // Shapes and colors
  const TETROMINOES = useMemo(
    () => ({
      I: { m: [[1, 1, 1, 1]], c: "#00FFFF" },
      O: { m: [[1, 1], [1, 1]], c: "#F7D154" },
      T: { m: [[0, 1, 0], [1, 1, 1]], c: "#B57AD2" },
      S: { m: [[0, 1, 1], [1, 1, 0]], c: "#57D98C" },
      Z: { m: [[1, 1, 0], [0, 1, 1]], c: "#F26D6D" },
      J: { m: [[1, 0, 0], [1, 1, 1]], c: "#6DA8F2" },
      L: { m: [[0, 0, 1], [1, 1, 1]], c: "#F2A96D" },
    }),
    []
  );
  const ORDER = ["I", "O", "T", "S", "Z", "J", "L"];

  // ----- Game state -----
  const [board, setBoard] = useState(() => emptyBoard(ROWS, COLS));
  const [active, setActive] = useState(null); // {x,y, m, c, k}
  const [queue, setQueue] = useState(() => bag());
  const [nextBag, setNextBag] = useState(() => bag());
  const [running, setRunning] = useState(true);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [level, setLevel] = useState(1);

  const [hold, setHold] = useState(null);
  const [canHold, setCanHold] = useState(true);

  // time refs for drop
  const lastTimeRef = useRef(0);
  const accRef = useRef(0);

  // Initialize first piece
  useEffect(() => {
    if (!active) {
      spawn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Responsive sizing: recompute cell based on container/viewport
  useEffect(() => {
    const recalc = () => {
      const pad = 16; // px padding margin
      const contW = wrapperRef.current ? wrapperRef.current.clientWidth : window.innerWidth;
      const vh = window.innerHeight;
      // leave room for UI on mobile
      const availW = Math.max(180, contW - pad);
      const availH = Math.max(240, vh - 220);
      const target = Math.min(Math.floor(availW / COLS), Math.floor(availH / ROWS));
      const clamped = Math.max(16, Math.min(36, target || 28));
      setCell(clamped);
    };
    recalc();

    let ro;
    if ("ResizeObserver" in window && wrapperRef.current) {
      ro = new ResizeObserver(recalc);
      ro.observe(wrapperRef.current);
    }
    window.addEventListener("resize", recalc);
    window.addEventListener("orientationchange", recalc);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", recalc);
      window.removeEventListener("orientationchange", recalc);
    };
  }, []);

  // Canvas DPI sizing when cell changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.floor(WELL_W * dpr);
    canvas.height = Math.floor(WELL_H * dpr);
    canvas.style.width = WELL_W + "px";
    canvas.style.height = WELL_H + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [WELL_W, WELL_H]);

  // Main loop
  useEffect(() => {
    let rafId;
    const loop = (t) => {
      if (!running) {
        lastTimeRef.current = t;
        rafId = requestAnimationFrame(loop);
        return;
      }
      const last = lastTimeRef.current || t;
      const dt = t - last;
      lastTimeRef.current = t;

      const dropMs = Math.max(100, DROP_BASE_MS - (level - 1) * 75);
      accRef.current += dt;
      while (accRef.current >= dropMs) {
        accRef.current -= dropMs;
        stepDown();
      }
      draw();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, board, active, level, cell]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e) => {
      if (!active) return;
      if (e.code === "KeyP") {
        setRunning((r) => !r);
        return;
      }
      if (e.code === "KeyR") {
        reset();
        return;
      }
      if (!running) return;

      if (e.code === "ArrowLeft") {
        e.preventDefault();
        tryMove(-1, 0, active.m);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        tryMove(1, 0, active.m);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        softDrop();
      } else if (e.code === "Space") {
        e.preventDefault();
        hardDrop();
      } else if (e.code === "ArrowUp" || e.code === "KeyX") {
        e.preventDefault();
        rotateCW();
      } else if (e.code === "KeyZ") {
        e.preventDefault();
        rotateCCW();
      } else if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyC") {
        e.preventDefault();
        doHold();
      }
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, running, hold, canHold]);

  const reset = useCallback(() => {
    setBoard(emptyBoard(ROWS, COLS));
    setQueue(bag());
    setNextBag(bag());
    setActive(null);
    setScore(0);
    setLines(0);
    setLevel(1);
    setHold(null);
    setCanHold(true);
    accRef.current = 0;
    lastTimeRef.current = 0;
    setRunning(true);
    spawn(true);
  }, []);

  // ----- Helpers -----
  function emptyBoard(r, c) {
    return Array.from({ length: r }, () => Array(c).fill(null));
  }
  function bag() {
    const b = [...ORDER];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }
  function cloneBoard(b) {
    return b.map((row) => row.slice());
  }

  function spawn(resetAcc = false) {
    setActive(() => {
      const [head, ...rest] = queue;
      let q = rest;
      let nb = nextBag;
      if (q.length === 0) {
        q = nb;
        nb = bag();
        setNextBag(nb);
      }
      setQueue(q);
      const shape = TETROMINOES[head];
      const m = shape.m.map((r) => r.slice());
      const startX = Math.floor((COLS - m[0].length) / 2);
      const startY = -getTopOffset(m); // allow spawn above the visible area
      const piece = { x: startX, y: startY, m, c: shape.c, k: head };
      if (collides(board, piece)) {
        setRunning(false); // game over
      }
      if (resetAcc) accRef.current = 0;
      setCanHold(true);
      return piece;
    });
  }

  function getTopOffset(m) {
    for (let y = 0; y < m.length; y++) {
      if (m[y].some((v) => v)) return y;
    }
    return 0;
  }

  function collides(b, p) {
    for (let y = 0; y < p.m.length; y++) {
      for (let x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x]) continue;
        const nx = p.x + x;
        const ny = p.y + y;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && b[ny][nx]) return true;
      }
    }
    return false;
  }

  function mergePiece(b, p) {
    const nb = cloneBoard(b);
    for (let y = 0; y < p.m.length; y++) {
      for (let x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x]) continue;
        const nx = p.x + x;
        const ny = p.y + y;
        if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
          nb[ny][nx] = p.c;
        }
      }
    }
    return nb;
  }

  function clearLines(b) {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      if (b[y].every((c) => !!c)) rows.push(y);
    }
    if (!rows.length) return { board: b, cleared: 0 };

    const nb = b.filter((_, y) => !rows.includes(y));
    while (nb.length < ROWS) nb.unshift(Array(COLS).fill(null));
    return { board: nb, cleared: rows.length };
  }

  function scoreFor(n) {
    if (n === 1) return 100 * level;
    if (n === 2) return 300 * level;
    if (n === 3) return 500 * level;
    if (n >= 4) return 800 * level;
    return 0;
  }

  // ----- Actions -----
  function stepDown() {
    if (!active) return;
    const next = { ...active, y: active.y + 1 };
    if (!collides(board, next)) {
      setActive(next);
    } else {
      // lock piece
      const merged = mergePiece(board, active);
      const { board: clearedBoard, cleared } = clearLines(merged);
      setBoard(clearedBoard);
      if (cleared > 0) {
        setLines((v) => v + cleared);
        setScore((s) => s + scoreFor(cleared));
        setLevel(1 + Math.floor((lines + cleared) / 10));
      }
      spawn(true);
    }
  }

  function softDrop() {
    if (!active) return;
    const next = { ...active, y: active.y + 1 };
    if (!collides(board, next)) {
      setActive(next);
      setScore((s) => s + 1); // small reward
    }
  }

  function hardDrop() {
    if (!active) return;
    let ghost = { ...active };
    let dist = 0;
    while (!collides(board, { ...ghost, y: ghost.y + 1 })) {
      ghost.y++;
      dist++;
    }
    setActive(ghost);
    setScore((s) => s + dist * 2);
    // immediately lock
    const merged = mergePiece(board, ghost);
    const { board: clearedBoard, cleared } = clearLines(merged);
    setBoard(clearedBoard);
    if (cleared > 0) {
      setLines((v) => v + cleared);
      setScore((s) => s + scoreFor(cleared));
      setLevel(1 + Math.floor((lines + cleared) / 10));
    }
    spawn(true);
  }

  function rotateCW() {
    rotate((m) => rotateMatrixCW(m));
  }
  function rotateCCW() {
    rotate((m) => rotateMatrixCCW(m));
  }
  function rotate(rotFn) {
    if (!active) return;
    const rotated = rotFn(active.m);
    const kicks = [0, -1, 1, -2, 2];
    for (const dx of kicks) {
      const test = { ...active, m: rotated, x: active.x + dx };
      if (!collides(board, test)) {
        setActive(test);
        return;
      }
    }
  }

  function doHold() {
    if (!canHold || !active) return;
    if (!hold) {
      setHold(active.k);
      spawn(true);
    } else {
      const newK = hold;
      setHold(active.k);
      const shape = TETROMINOES[newK];
      const m = shape.m.map((r) => r.slice());
      const startX = Math.floor((COLS - m[0].length) / 2);
      const startY = -getTopOffset(m);
      setActive({ x: startX, y: startY, m, c: shape.c, k: newK });
    }
    setCanHold(false);
  }

  function tryMove(dx, dy, m) {
    if (!active) return;
    const test = { ...active, x: active.x + dx, y: active.y + dy, m };
    if (!collides(board, test)) setActive(test);
  }

  // ----- Rendering -----
  function drawCell(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
  }

  function drawGrid(ctx) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cell + 0.5, 0);
      ctx.lineTo(x * cell + 0.5, WELL_H);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cell + 0.5);
      ctx.lineTo(WELL_W, y * cell + 0.5);
      ctx.stroke();
    }
  }

  function getGhost(activePiece) {
    let g = { ...activePiece };
    while (!collides(board, { ...g, y: g.y + 1 })) g.y++;
    return g;
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // background
    ctx.fillStyle = "#0b1221";
    ctx.fillRect(0, 0, WELL_W, WELL_H);

    // existing board
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const cellColor = board[y][x];
        if (cellColor) drawCell(ctx, x * cell, y * cell, shade(cellColor, 0));
      }
    }

    // ghost
    if (active) {
      const g = getGhost(active);
      for (let y = 0; y < g.m.length; y++) {
        for (let x = 0; x < g.m[y].length; x++) {
          if (!g.m[y][x]) continue;
          const nx = (g.x + x) * cell;
          const ny = (g.y + y) * cell;
          if (g.y + y >= 0) drawCell(ctx, nx, ny, toAlpha(g.c, 0.25));
        }
      }
    }

    // active piece
    if (active) {
      for (let y = 0; y < active.m.length; y++) {
        for (let x = 0; x < active.m[y].length; x++) {
          if (!active.m[y][x]) continue;
          const nx = (active.x + x) * cell;
          const ny = (active.y + y) * cell;
          if (active.y + y >= 0) drawCell(ctx, nx, ny, shade(active.c, -8));
        }
      }
    }

    drawGrid(ctx);
  }

  function toAlpha(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function shade(hex, amt = -10) {
    const { r, g, b } = hexToRgb(hex);
    const clamp = (v) => Math.max(0, Math.min(255, v + amt));
    return rgbToHex(clamp(r), clamp(g), clamp(b));
  }
  function hexToRgb(hex) {
    const v = hex.replace("#", "");
    const num = parseInt(v, 16);
    if (v.length === 6) {
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }
    return { r: 255, g: 255, b: 255 };
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  // ----- Rotation helpers -----
  function rotateMatrixCW(m) {
    const h = m.length,
      w = m[0].length;
    const res = Array.from({ length: w }, () => Array(h).fill(0));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) res[x][h - 1 - y] = m[y][x];
    return res;
  }
  function rotateMatrixCCW(m) {
    const h = m.length,
      w = m[0].length;
    const res = Array.from({ length: w }, () => Array(h).fill(0));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) res[w - 1 - x][y] = m[y][x];
    return res;
  }

  // ----- UI helpers -----
  const nextPieces = useMemo(() => {
    const show = [...queue];
    if (show.length < 5) show.push(...nextBag);
    return show.slice(0, 5);
  }, [queue, nextBag]);

  function tinyMatrixOf(key) {
    const s = TETROMINOES[key];
    return s ? s.m : [[1]];
  }

  // ----- Touch & mobile helpers -----
  const onCanvasTouchStart = useCallback(
    (e) => {
      if (!running) return;
      const t = e.changedTouches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: performance.now() };
    },
    [running]
  );

  const onCanvasTouchEnd = useCallback(
    (e) => {
      if (!active || !running) return;
      const now = performance.now();
      if (now - lastSwipeRef.current < 60) return; // debounce small jitters

      const t = e.changedTouches[0];
      const s = touchStartRef.current;
      if (!s) return;

      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      const ax = Math.abs(dx),
        ay = Math.abs(dy);
      const TH = 28; // swipe threshold in px

      if (ax < TH && ay < TH) {
        // tap -> rotate CW
        rotateCW();
        lastSwipeRef.current = now;
        return;
      }
      if (ax > ay) {
        // horizontal swipe -> move
        if (dx > 0) tryMove(1, 0, active.m);
        else tryMove(-1, 0, active.m);
      } else {
        if (dy > 0) {
          // swipe down -> soft drop twice
          softDrop();
          softDrop();
        } else {
          // swipe up -> hard drop
          hardDrop();
        }
      }
      lastSwipeRef.current = now;
    },
    [active, running]
  );

  const startHold = useCallback((fn, interval = 110) => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    fn();
    holdTimerRef.current = setInterval(() => fn(), interval);
  }, []);

  const stopHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // Cleanup press-and-hold timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    };
  }, []);

  // ----- Render React UI -----
  return (
    <div className="w-full min-h-[80vh] flex flex-col items-center justify-start gap-4 p-4">
      <h1 className="text-2xl font-semibold">Tetris – Canvas</h1>
      <div className="flex flex-col md:flex-row gap-6 w-full items-start justify-center">
        <div className="relative mx-auto w-full md:w-auto" ref={wrapperRef}>
          <canvas
            ref={canvasRef}
            width={WELL_W}
            height={WELL_H}
            onTouchStart={onCanvasTouchStart}
            onTouchEnd={onCanvasTouchEnd}
            className="rounded-2xl shadow-lg border border-white/10 bg-[#0b1221] touch-none"
          />
          {!running && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xl rounded-2xl">
              <div className="backdrop-blur-sm p-4 rounded-xl border border-white/10">
                {active ? "Paused" : "Game Over"}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 min-w-[200px] md:min-w-[220px] w-full md:w-auto">
          <Info label="Score" value={score} />
          <Info label="Lines" value={lines} />
          <Info label="Level" value={level} />
          <Info label="Hold">
            <MiniPiece mat={hold ? tinyMatrixOf(hold) : null} color={hold ? TETROMINOES[hold].c : null} />
            <div className="text-xs mt-1 opacity-70">(Shift/C)</div>
          </Info>
          <Info label="Next">
            <div className="flex flex-col gap-2">
              {nextPieces.map((k, i) => (
                <MiniPiece key={i} mat={tinyMatrixOf(k)} color={TETROMINOES[k].c} />
              ))}
            </div>
          </Info>

          {/* Desktop controls */}
          <div className="text-sm leading-6 mt-2 hidden md:block">
            <p className="font-medium">Keyboard Controls</p>
            <p>← → move, ↓ soft, Space hard</p>
            <p>↑ / X rotate CW, Z CCW</p>
            <p>Shift/C hold, P pause, R restart</p>
          </div>
          <div className="hidden md:flex gap-2 mt-2">
            <button className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20" onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Resume"}
            </button>
            <button className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20" onClick={reset}>
              Restart
            </button>
          </div>

          {/* Mobile Controls (only show on small screens) */}
          <div className="md:hidden mt-4 w-full flex flex-col items-center gap-3">
            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              <button
                className="py-3 rounded-xl bg-white/10"
                onTouchStart={() => startHold(() => tryMove(-1, 0, active?.m))}
                onTouchEnd={stopHold}
                onMouseDown={() => startHold(() => tryMove(-1, 0, active?.m))}
                onMouseUp={stopHold}
              >
                ◀️
              </button>

              <button
                className="py-3 rounded-xl bg-white/10"
                onTouchStart={() => startHold(() => softDrop())}
                onTouchEnd={stopHold}
                onMouseDown={() => startHold(() => softDrop())}
                onMouseUp={stopHold}
              >
                ⬇️
              </button>

              <button
                className="py-3 rounded-xl bg-white/10"
                onTouchStart={() => startHold(() => tryMove(1, 0, active?.m))}
                onTouchEnd={stopHold}
                onMouseDown={() => startHold(() => tryMove(1, 0, active?.m))}
                onMouseUp={stopHold}
              >
                ▶️
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              <button className="py-3 rounded-xl bg-white/10" onClick={rotateCCW}>
                ⟲
              </button>
              <button className="py-3 rounded-xl bg-white/10" onClick={rotateCW}>
                ⟳
              </button>
              <button className="py-3 rounded-xl bg-white/10" onClick={hardDrop}>
                ⬇︎⬇︎
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              <button className="py-3 rounded-xl bg-white/10" onClick={doHold}>
                Hold
              </button>
              <button className="py-3 rounded-xl bg-white/10" onClick={() => setRunning((r) => !r)}>
                {running ? "Pause" : "Resume"}
              </button>
              <button className="py-3 rounded-xl bg-white/10" onClick={reset}>
                Restart
              </button>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs opacity-60">Tip: Press Space for a satisfying hard drop. Tap or swipe on mobile.</p>
    </div>
  );

  // ----- Subcomponents -----
  function Info({ label, value, children }) {
    return (
      <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
        <div className="text-xs opacity-70">{label}</div>
        {children ? <div className="mt-1">{children}</div> : <div className="text-lg font-semibold">{value}</div>}
      </div>
    );
  }

  function MiniPiece({ mat, color }) {
    const block = 12;
    const pad = 2;
    const w = 4 * block + pad * 2;
    const h = 4 * block + pad * 2;

    const cnv = useRef(null);
    useEffect(() => {
      const c = cnv.current;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b1221";
      ctx.fillRect(0, 0, w, h);
      if (!mat) return;
      const mh = mat.length;
      const mw = mat[0].length;
      const offX = Math.floor((4 - mw) / 2);
      const offY = Math.floor((4 - mh) / 2);
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          if (!mat[y][x]) continue;
          ctx.fillStyle = color || "#999";
          ctx.fillRect((offX + x) * block + pad, (offY + y) * block + pad, block - 1, block - 1);
        }
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }, [mat, color]);

    return <canvas ref={cnv} width={w} height={h} className="rounded-xl border border-white/10" />;
  }
}
