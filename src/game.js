(function () {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const context = canvas && canvas.getContext("2d");

  if (!canvas || !context) {
    return;
  }

  const ui = {
    score: document.getElementById("scoreValue"),
    lives: document.getElementById("lifeCount"),
    dots: document.getElementById("dotCount"),
    status: document.getElementById("gameStatus"),
    overlay: document.getElementById("gameOverlay"),
    overlayKicker: document.getElementById("overlayKicker"),
    overlayTitle: document.getElementById("overlayTitle"),
    overlayCopy: document.getElementById("overlayCopy"),
    startButtonLabel: document.querySelector("#startButton span"),
    startButton: document.getElementById("startButton"),
    restartButton: document.getElementById("restartButton"),
    pauseButton: document.getElementById("pauseButton"),
    board: document.getElementById("boardFrame"),
  };

  const GAME_STATUS = Object.freeze({
    READY: "ready",
    PLAYING: "playing",
    PAUSED: "paused",
    WON: "won",
    LOST: "lost",
  });

  const MAZE_ROWS = [
    "#################",
    "#...............#",
    "#.###.#####.###.#",
    "#...............#",
    "#.###.#.###.#.###",
    "#...#.#...#.#...#",
    "###.#.###.#.###.#",
    "#...#.....#.....#",
    "#.###.###.###.###",
    "#.....#.........#",
    "#.###.#.###.#.###",
    "#...#...#...#...#",
    "###.###.#.###.#.#",
    "#...............#",
    "#.###.#####.###.#",
    "#...............#",
    "#################",
  ];

  const PLAYER_START = { col: 1, row: 1 };
  const GHOST_STARTS = [{ id: "巡獵者一號", col: 8, row: 7 }];
  const DIRECTION_STEPS = [
    { name: "up", col: 0, row: -1 },
    { name: "left", col: -1, row: 0 },
    { name: "down", col: 0, row: 1 },
    { name: "right", col: 1, row: 0 },
  ];
  const TILE_SIZE = 32;
  const PLAYER_STEP_MS = 125;
  const GHOST_STEP_MS = 210;
  const BULLET_STEP_MS = 60;
  const FIRE_COOLDOWN_MS = 300;
  const DOUBLE_TAP_INTERVAL_MS = 600;
  const DOUBLE_TAP_DISTANCE = 80;
  const SWIPE_DIRECTION_THRESHOLD = 24;
  const COLORS = {
    wall: "#226354",
    floor: "#102a25",
    dot: "#f4c85d",
    player: "#a7efba",
    ghost: "#ff765f",
    bullet: "#f4c85d",
    eye: "#fffefa",
    pupil: "#173a32",
  };

  const game = {
    status: GAME_STATUS.READY,
    score: 0,
    lives: 3,
    collectedDots: new Set(),
    player: null,
    ghosts: [],
    maze: null,
    collisionProtectionUntil: 0,
    elapsedMs: 0,
    previousFrameTime: null,
    inputDirection: null,
    playerStepElapsed: 0,
    ghostStepElapsed: 0,
    bullets: [],
    nextShotAt: 0,
  };
  const pressedDirections = new Map();
  let touchDirection = null;
  let activeCanvasTouch = null;
  let lastCanvasTap = null;

  function isWalkable(maze, col, row) {
    return row >= 0
      && row < maze.height
      && col >= 0
      && col < maze.width
      && maze.tiles[row][col] === ".";
  }

  function reachableCells(maze, start) {
    const visited = new Set([`${start.col},${start.row}`]);
    const queue = [start];

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const step of DIRECTION_STEPS) {
        const col = current.col + step.col;
        const row = current.row + step.row;
        const key = `${col},${row}`;
        if (isWalkable(maze, col, row) && !visited.has(key)) {
          visited.add(key);
          queue.push({ col, row });
        }
      }
    }

    return visited;
  }

  function createMaze() {
    const width = MAZE_ROWS[0].length;
    if (MAZE_ROWS.some((row) => row.length !== width)) {
      throw new Error("迷宮每一列必須有相同寬度。");
    }

    const maze = {
      width,
      height: MAZE_ROWS.length,
      tiles: MAZE_ROWS.map((row) => row.split("")),
      playerStart: { ...PLAYER_START },
      ghostStarts: GHOST_STARTS.map((ghost) => ({ ...ghost })),
      dots: [],
    };
    const occupiedStarts = new Set([`${PLAYER_START.col},${PLAYER_START.row}`]);

    if (!isWalkable(maze, PLAYER_START.col, PLAYER_START.row)) {
      throw new Error("玩家起點必須位於迷宮通道。");
    }

    for (const ghost of maze.ghostStarts) {
      const key = `${ghost.col},${ghost.row}`;
      if (!isWalkable(maze, ghost.col, ghost.row) || occupiedStarts.has(key)) {
        throw new Error("巡獵者起點必須位於未被占用的迷宮通道。");
      }
      occupiedStarts.add(key);
    }

    for (let row = 0; row < maze.height; row += 1) {
      for (let col = 0; col < maze.width; col += 1) {
        if (maze.tiles[row][col] === "." && !occupiedStarts.has(`${col},${row}`)) {
          maze.dots.push({ id: `晶點-${col}-${row}`, col, row, points: 10 });
        }
      }
    }

    const dotIds = new Set(maze.dots.map((dot) => dot.id));
    const dotPositions = new Set(maze.dots.map((dot) => `${dot.col},${dot.row}`));
    const reachable = reachableCells(maze, maze.playerStart);
    if (dotIds.size !== maze.dots.length
      || dotPositions.size !== maze.dots.length
      || maze.dots.some((dot) => !reachable.has(`${dot.col},${dot.row}`))) {
      throw new Error("迷宮晶點必須唯一且由玩家起點可抵達。");
    }

    return maze;
  }

  function initializeGame() {
    game.maze = createMaze();
    game.status = GAME_STATUS.READY;
    game.score = 0;
    game.lives = 3;
    game.collectedDots = new Set();
    game.player = {
      ...game.maze.playerStart,
      direction: null,
      queuedDirection: null,
      facingDirection: "right",
      invulnerableUntil: 0,
    };
    game.ghosts = game.maze.ghostStarts.map((ghost) => ({
      ...ghost,
      direction: null,
    }));
    game.collisionProtectionUntil = 0;
    game.elapsedMs = 0;
    game.inputDirection = null;
    game.playerStepElapsed = 0;
    game.ghostStepElapsed = 0;
    game.bullets = [];
    game.nextShotAt = 0;
    touchDirection = null;
    activeCanvasTouch = null;
    lastCanvasTap = null;
    pressedDirections.clear();
  }

  initializeGame();
  updateHud();

  function updateHud() {
    ui.score.textContent = String(game.score).padStart(4, "0");
    ui.lives.textContent = Array.from({ length: 3 }, (_, index) => (index < game.lives ? "●" : "○")).join(" ");
    ui.lives.setAttribute("aria-label", `剩餘 ${game.lives} 條生命`);
    ui.dots.textContent = `${game.collectedDots.size} / ${game.maze.dots.length}`;
  }

  function announce(message) {
    ui.status.textContent = message;
  }

  function showOverlay(kicker, title, copy, buttonLabel) {
    ui.overlayKicker.textContent = kicker;
    ui.overlayTitle.textContent = title;
    ui.overlayCopy.textContent = copy;
    ui.startButtonLabel.textContent = buttonLabel;
    ui.startButton.setAttribute("aria-label", buttonLabel);
    ui.overlay.hidden = false;
  }
  const directionButtons = document.querySelectorAll(".direction-button");

  function startGame() {
    initializeGame();
    game.status = GAME_STATUS.PLAYING;
    game.previousFrameTime = null;
    updateHud();
    ui.overlay.hidden = true;
    ui.board.dataset.state = GAME_STATUS.PLAYING;
    ui.pauseButton.disabled = false;
    ui.pauseButton.setAttribute("aria-pressed", "false");
    ui.pauseButton.textContent = "暫停";
    announce("遊戲開始。方向鍵或 WASD 移動、空白鍵發射；手機可滑動迷宮轉向，快速點兩下射擊。");
  }

  function pauseGame() {
    if (game.status !== GAME_STATUS.PLAYING) {
      return;
    }
    game.status = GAME_STATUS.PAUSED;
    clearInput();
    ui.board.dataset.state = GAME_STATUS.PAUSED;
    ui.pauseButton.setAttribute("aria-pressed", "true");
    ui.pauseButton.textContent = "繼續";
    showOverlay("稍作休息", "遊戲已暫停", "你的迷宮進度已保留。", "繼續遊戲");
    announce("遊戲已暫停。");
  }

  function resumeGame() {
    if (game.status !== GAME_STATUS.PAUSED) {
      return;
    }
    game.status = GAME_STATUS.PLAYING;
    game.previousFrameTime = null;
    clearInput();
    ui.board.dataset.state = GAME_STATUS.PLAYING;
    ui.overlay.hidden = true;
    ui.pauseButton.setAttribute("aria-pressed", "false");
    ui.pauseButton.textContent = "暫停";
    announce("遊戲已恢復。");
  }

  function togglePause() {
    if (game.status === GAME_STATUS.PLAYING) {
      pauseGame();
    } else if (game.status === GAME_STATUS.PAUSED) {
      resumeGame();
    }
  }

  function handleOverlayAction() {
    if (game.status === GAME_STATUS.PAUSED) {
      resumeGame();
    } else {
      startGame();
    }
  }

  function finishGame(status, kicker, title, message) {
    game.status = status;
    game.bullets = [];
    clearInput();
    ui.pauseButton.disabled = true;
    ui.pauseButton.setAttribute("aria-pressed", "false");
    ui.board.dataset.state = status;
    showOverlay(kicker, title, message, "再玩一次");
    announce(message);
  }

  function resolveCollision() {
    const protectionUntil = Math.max(game.collisionProtectionUntil, game.player.invulnerableUntil);
    if (game.elapsedMs < protectionUntil) {
      return;
    }

    const collided = game.ghosts.some((ghost) => ghost.col === game.player.col
      && ghost.row === game.player.row);
    if (!collided) {
      return;
    }

    game.lives = Math.max(0, game.lives - 1);
    updateHud();
    if (game.lives === 0) {
      finishGame(GAME_STATUS.LOST, "這次差一點", "再試一次", `遊戲結束，最終得分 ${game.score} 分。`);
      return;
    }

    game.player.col = game.maze.playerStart.col;
    game.player.row = game.maze.playerStart.row;
    game.player.direction = null;
    game.player.queuedDirection = null;
    game.inputDirection = null;
    touchDirection = null;
    activeCanvasTouch = null;
    lastCanvasTap = null;
    pressedDirections.clear();
    game.collisionProtectionUntil = game.elapsedMs + 2000;
    game.player.invulnerableUntil = game.collisionProtectionUntil;
    announce(`發生碰撞，剩餘 ${game.lives} 條生命。`);
  }

  function collectDotAtPlayer() {
    if (game.status !== GAME_STATUS.PLAYING) {
      return false;
    }

    const dot = game.maze.dots.find((candidate) => candidate.col === game.player.col
      && candidate.row === game.player.row
      && !game.collectedDots.has(candidate.id));
    if (!dot) {
      return false;
    }

    game.collectedDots.add(dot.id);
    game.score += dot.points;
    updateHud();

    return true;
  }

  function update(deltaMs) {
    if (game.status === GAME_STATUS.PLAYING) {
      game.elapsedMs += deltaMs;
      game.playerStepElapsed += deltaMs;
      while (game.playerStepElapsed >= PLAYER_STEP_MS) {
        game.playerStepElapsed -= PLAYER_STEP_MS;
        movePlayerOneTile();
        collectDotAtPlayer();
      }
      game.ghostStepElapsed += deltaMs;
      while (game.ghostStepElapsed >= GHOST_STEP_MS) {
        game.ghostStepElapsed -= GHOST_STEP_MS;
        moveGhostsOneTile();
      }
      updateBullets(deltaMs);
      resolveCollision();
      if (game.status === GAME_STATUS.PLAYING
        && game.collectedDots.size === game.maze.dots.length) {
        finishGame(GAME_STATUS.WON, "迷宮清空了", "成功過關", `所有晶點已收集，最終得分 ${game.score} 分。`);
      }
    }
  }

  function canMove(actor, direction) {
    if (!direction) {
      return false;
    }
    const step = DIRECTION_STEPS.find((candidate) => candidate.name === direction);
    return step !== undefined
      && isWalkable(game.maze, actor.col + step.col, actor.row + step.row);
  }

  function moveActor(actor, direction) {
    const step = DIRECTION_STEPS.find((candidate) => candidate.name === direction);
    actor.col += step.col;
    actor.row += step.row;
    actor.direction = direction;
  }

  function movePlayerOneTile() {
    const player = game.player;
    const requestedDirection = player.queuedDirection || game.inputDirection;
    if (canMove(player, requestedDirection)) {
      moveActor(player, requestedDirection);
      player.facingDirection = requestedDirection;
      player.queuedDirection = null;
      return;
    }

    if (game.inputDirection && canMove(player, player.direction)) {
      moveActor(player, player.direction);
      player.facingDirection = player.direction;
      return;
    }

    if (!game.inputDirection) {
      player.queuedDirection = null;
      player.direction = null;
    }
  }

  function nextGhostDirection(ghost, target) {
    const queue = [{ col: ghost.col, row: ghost.row, firstDirection: null }];
    const visited = new Set([`${ghost.col},${ghost.row}`]);

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const step of DIRECTION_STEPS) {
        const col = current.col + step.col;
        const row = current.row + step.row;
        const key = `${col},${row}`;
        if (!isWalkable(game.maze, col, row) || visited.has(key)) {
          continue;
        }

        const firstDirection = current.firstDirection || step.name;
        if (col === target.col && row === target.row) {
          return firstDirection;
        }

        visited.add(key);
        queue.push({ col, row, firstDirection });
      }
    }

    return null;
  }

  function moveGhostsOneTile() {
    for (const ghost of game.ghosts) {
      const direction = nextGhostDirection(ghost, game.player);
      if (canMove(ghost, direction)) {
        moveActor(ghost, direction);
      }
    }
  }

  function fireBullet() {
    if (game.status !== GAME_STATUS.PLAYING
      || game.ghosts.length === 0
      || game.elapsedMs < game.nextShotAt) {
      return;
    }

    game.bullets.push({
      col: game.player.col,
      row: game.player.row,
      direction: game.player.facingDirection,
      elapsedMs: 0,
    });
    game.nextShotAt = game.elapsedMs + FIRE_COOLDOWN_MS;
    announce("已發射光彈。");
  }

  function updateBullets(deltaMs) {
    const remainingBullets = [];
    for (const bullet of game.bullets) {
      bullet.elapsedMs += deltaMs;
      let removed = false;
      while (bullet.elapsedMs >= BULLET_STEP_MS) {
        bullet.elapsedMs -= BULLET_STEP_MS;
        const step = DIRECTION_STEPS.find((candidate) => candidate.name === bullet.direction);
        const nextCol = bullet.col + step.col;
        const nextRow = bullet.row + step.row;
        if (!isWalkable(game.maze, nextCol, nextRow)) {
          removed = true;
          break;
        }

        bullet.col = nextCol;
        bullet.row = nextRow;
        const hitIndex = game.ghosts.findIndex((ghost) => ghost.col === bullet.col
          && ghost.row === bullet.row);
        if (hitIndex !== -1) {
          const [hitGhost] = game.ghosts.splice(hitIndex, 1);
          announce(`光彈擊中${hitGhost.id}！`);
          removed = true;
          break;
        }
      }
      if (!removed) {
        remainingBullets.push(bullet);
      }
    }
    game.bullets = remainingBullets;
  }

  function directionForKey(key) {
    const normalizedKey = key.toLowerCase();
    const directions = {
      arrowup: "up",
      w: "up",
      arrowleft: "left",
      a: "left",
      arrowdown: "down",
      s: "down",
      arrowright: "right",
      d: "right",
    };
    return directions[normalizedKey] || null;
  }

  function syncInputDirection() {
    const activeDirections = Array.from(pressedDirections.values());
    game.inputDirection = activeDirections.at(-1) || touchDirection;
    if (game.inputDirection) {
      game.player.queuedDirection = game.inputDirection;
    } else {
      game.player.direction = null;
    }
  }

  function handleKeyDown(event) {
    if (event.code === "Space") {
      const target = event.target;
      const focusedControl = target instanceof Element
        && target.closest("button, a, input, select, textarea, [contenteditable='true']");
      if (focusedControl && focusedControl.getClientRects().length > 0) {
        return;
      }
      if (game.status === GAME_STATUS.PLAYING) {
        event.preventDefault();
        if (!event.repeat) {
          fireBullet();
        }
      }
      return;
    }

    if (["p", "escape"].includes(event.key.toLowerCase())
      && [GAME_STATUS.PLAYING, GAME_STATUS.PAUSED].includes(game.status)) {
      event.preventDefault();
      togglePause();
      return;
    }

    const direction = directionForKey(event.key);
    if (!direction) {
      return;
    }
    event.preventDefault();
    pressedDirections.set(event.key.toLowerCase(), direction);
    syncInputDirection();
  }

  function handleKeyUp(event) {
    const direction = directionForKey(event.key);
    if (!direction) {
      return;
    }
    pressedDirections.delete(event.key.toLowerCase());
    syncInputDirection();
  }

  function clearInput() {
    pressedDirections.clear();
    touchDirection = null;
    activeCanvasTouch = null;
    lastCanvasTap = null;
    directionButtons.forEach((button) => button.classList.remove("is-active"));
    if (game.player) {
      game.inputDirection = null;
      game.player.queuedDirection = null;
      game.player.direction = null;
    }
  }

  function handleDirectionPointerDown(event) {
    if (game.status !== GAME_STATUS.PLAYING) {
      return;
    }
    event.preventDefault();
    const button = event.currentTarget;
    if (event.pointerType === "touch") {
      touchDirection = button.dataset.direction;
    }
    button.setPointerCapture(event.pointerId);
    button.classList.add("is-active");
    pressedDirections.set(`pointer-${event.pointerId}`, button.dataset.direction);
    syncInputDirection();
  }

  function handleDirectionPointerEnd(event) {
    const button = event.currentTarget;
    pressedDirections.delete(`pointer-${event.pointerId}`);
    button.classList.remove("is-active");
    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    syncInputDirection();
  }

  function handleCanvasPointerDown(event) {
    if (event.pointerType !== "touch" || game.status !== GAME_STATUS.PLAYING) {
      return;
    }

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activeCanvasTouch = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handleCanvasPointerUp(event) {
    if (event.pointerType !== "touch"
      || game.status !== GAME_STATUS.PLAYING
      || !activeCanvasTouch
      || activeCanvasTouch.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - activeCanvasTouch.x;
    const deltaY = event.clientY - activeCanvasTouch.y;
    activeCanvasTouch = null;
    if (Math.hypot(deltaX, deltaY) >= SWIPE_DIRECTION_THRESHOLD) {
      lastCanvasTap = null;
      touchDirection = Math.abs(deltaX) > Math.abs(deltaY)
        ? (deltaX < 0 ? "left" : "right")
        : (deltaY < 0 ? "up" : "down");
      syncInputDirection();
      return;
    }

    const now = performance.now();
    const isDoubleTap = lastCanvasTap
      && now - lastCanvasTap.time <= DOUBLE_TAP_INTERVAL_MS
      && Math.hypot(event.clientX - lastCanvasTap.x, event.clientY - lastCanvasTap.y) <= DOUBLE_TAP_DISTANCE;
    if (isDoubleTap) {
      lastCanvasTap = null;
      fireBullet();
      return;
    }

    lastCanvasTap = { time: now, x: event.clientX, y: event.clientY };
  }

  function handleCanvasPointerCancel(event) {
    if (activeCanvasTouch && activeCanvasTouch.pointerId === event.pointerId) {
      activeCanvasTouch = null;
      lastCanvasTap = null;
    }
  }

  function drawRoundedTile(x, y, size, inset, radius) {
    const left = x + inset;
    const top = y + inset;
    const right = x + size - inset;
    const bottom = y + size - inset;
    context.beginPath();
    context.moveTo(left + radius, top);
    context.lineTo(right - radius, top);
    context.quadraticCurveTo(right, top, right, top + radius);
    context.lineTo(right, bottom - radius);
    context.quadraticCurveTo(right, bottom, right - radius, bottom);
    context.lineTo(left + radius, bottom);
    context.quadraticCurveTo(left, bottom, left, bottom - radius);
    context.lineTo(left, top + radius);
    context.quadraticCurveTo(left, top, left + radius, top);
    context.closePath();
    context.fill();
  }

  function drawMaze() {
    context.fillStyle = COLORS.floor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < game.maze.height; row += 1) {
      for (let col = 0; col < game.maze.width; col += 1) {
        if (game.maze.tiles[row][col] === "#") {
          context.fillStyle = COLORS.wall;
          drawRoundedTile(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, 2, 6);
        }
      }
    }
  }

  function drawDots() {
    context.fillStyle = COLORS.dot;
    for (const dot of game.maze.dots) {
      if (game.collectedDots.has(dot.id)) {
        continue;
      }
      context.beginPath();
      context.arc(
        dot.col * TILE_SIZE + TILE_SIZE / 2,
        dot.row * TILE_SIZE + TILE_SIZE / 2,
        3.2,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }

  function drawPlayer() {
    const centerX = game.player.col * TILE_SIZE + TILE_SIZE / 2;
    const centerY = game.player.row * TILE_SIZE + TILE_SIZE / 2;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(game.elapsedMs / 700);
    context.fillStyle = COLORS.player;
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(4, -4);
    context.lineTo(12, 0);
    context.lineTo(4, 4);
    context.lineTo(0, 12);
    context.lineTo(-4, 4);
    context.lineTo(-12, 0);
    context.lineTo(-4, -4);
    context.closePath();
    context.fill();
    context.fillStyle = COLORS.eye;
    context.beginPath();
    context.arc(2, -2, 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawBullets() {
    context.fillStyle = COLORS.bullet;
    context.strokeStyle = COLORS.eye;
    context.lineWidth = 2;
    for (const bullet of game.bullets) {
      const centerX = bullet.col * TILE_SIZE + TILE_SIZE / 2;
      const centerY = bullet.row * TILE_SIZE + TILE_SIZE / 2;
      context.beginPath();
      context.arc(centerX, centerY, 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  function drawGhost(ghost) {
    const centerX = ghost.col * TILE_SIZE + TILE_SIZE / 2;
    const centerY = ghost.row * TILE_SIZE + TILE_SIZE / 2;
    context.fillStyle = COLORS.ghost;
    context.beginPath();
    context.moveTo(centerX - 10, centerY + 9);
    context.lineTo(centerX - 10, centerY - 2);
    context.lineTo(centerX - 6, centerY - 9);
    context.lineTo(centerX, centerY - 12);
    context.lineTo(centerX + 6, centerY - 9);
    context.lineTo(centerX + 10, centerY - 2);
    context.lineTo(centerX + 10, centerY + 9);
    context.lineTo(centerX + 5, centerY + 6);
    context.lineTo(centerX, centerY + 10);
    context.lineTo(centerX - 5, centerY + 6);
    context.closePath();
    context.fill();
    context.fillStyle = COLORS.eye;
    context.beginPath();
    context.arc(centerX - 3, centerY - 1, 3.2, 0, Math.PI * 2);
    context.arc(centerX + 4, centerY - 1, 3.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = COLORS.pupil;
    context.beginPath();
    context.arc(centerX - 2, centerY, 1.4, 0, Math.PI * 2);
    context.arc(centerX + 5, centerY, 1.4, 0, Math.PI * 2);
    context.fill();
  }

  function draw() {
    drawMaze();
    drawDots();
    drawBullets();
    game.ghosts.forEach(drawGhost);
    drawPlayer();
  }

  function frame(timestamp) {
    const deltaMs = game.previousFrameTime === null
      ? 0
      : Math.min(timestamp - game.previousFrameTime, 50);
    game.previousFrameTime = timestamp;
    update(deltaMs);
    draw();
    window.requestAnimationFrame(frame);
  }

  ui.startButton.addEventListener("click", handleOverlayAction);
  ui.restartButton.addEventListener("click", startGame);
  ui.pauseButton.addEventListener("click", togglePause);
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointerup", handleCanvasPointerUp);
  canvas.addEventListener("pointercancel", handleCanvasPointerCancel);
  directionButtons.forEach((button) => {
    button.addEventListener("pointerdown", handleDirectionPointerDown);
    ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach((eventName) => {
      button.addEventListener(eventName, handleDirectionPointerEnd);
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pauseGame();
    }
  });
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clearInput);
  window.requestAnimationFrame(frame);
})();