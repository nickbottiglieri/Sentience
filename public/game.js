const socket = io();
const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];
const BOARD_SIZE = 10;
const COLS = 'ABCDEFGHIJ';

let gameId = null,
  playerId = null,
  gameMode = null;
let phase = 'menu';
let placementShips = []; // {x, y, horizontal} per ship index
let currentShipIdx = 0;
let horizontal = true;
let myShips = null;
let sunkShips = { me: new Set(), op: new Set() };

// --- Screen management ---
function showScreen(id) {
  document
    .querySelectorAll('.screen')
    .forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}
function setTurn(msg) {
  document.getElementById('turn-indicator').textContent = msg;
}

// --- Board rendering ---
function createBoardDOM(containerId, onClick) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  // Corner
  el.appendChild(
    Object.assign(document.createElement('div'), { className: 'label' })
  );
  // Column headers
  for (let x = 0; x < BOARD_SIZE; x++) {
    el.appendChild(
      Object.assign(document.createElement('div'), {
        className: 'label',
        textContent: COLS[x],
      })
    );
  }
  for (let y = 0; y < BOARD_SIZE; y++) {
    // Row label
    el.appendChild(
      Object.assign(document.createElement('div'), {
        className: 'label',
        textContent: y + 1,
      })
    );
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (onClick) cell.addEventListener('click', () => onClick(x, y));
      el.appendChild(cell);
    }
  }
}

function getCell(containerId, x, y) {
  const board = document.getElementById(containerId);
  return board.children[1 + BOARD_SIZE + y * (BOARD_SIZE + 1) + 1 + x]; // offset for labels
}

function renderMyBoard() {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = getCell('my-board', x, y);
      cell.className = 'cell';
    }
  }
  // Draw placed ships
  placementShips.forEach((ship, i) => {
    if (!ship) return;
    for (let j = 0; j < SHIPS[i].size; j++) {
      const cx = ship.horizontal ? ship.x + j : ship.x;
      const cy = ship.horizontal ? ship.y : ship.y + j;
      getCell('my-board', cx, cy).classList.add('ship');
    }
  });
}

function renderMyBoardFiring(incomingShots) {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = getCell('my-board', x, y);
      cell.className = 'cell';
    }
  }
  // Ships
  if (myShips) {
    myShips.forEach((ship, i) => {
      for (let j = 0; j < SHIPS[i].size; j++) {
        const cx = ship.horizontal ? ship.x + j : ship.x;
        const cy = ship.horizontal ? ship.y : ship.y + j;
        getCell('my-board', cx, cy).classList.add('ship');
      }
    });
  }
  // Incoming hits/misses
  if (incomingShots) {
    for (let y2 = 0; y2 < BOARD_SIZE; y2++) {
      for (let x2 = 0; x2 < BOARD_SIZE; x2++) {
        if (incomingShots[y2][x2] === 'hit')
          getCell('my-board', x2, y2).classList.add('hit');
        else if (incomingShots[y2][x2] === 'miss')
          getCell('my-board', x2, y2).classList.add('miss');
      }
    }
  }
}

// Track opponent shots board locally
let opShotsBoard = null;
let incomingShotsBoard = null;

function renderOpBoard() {
  if (!opShotsBoard) return;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = getCell('op-board', x, y);
      cell.className = 'cell';
      if (opShotsBoard[y][x] === 'hit') cell.classList.add('hit');
      else if (opShotsBoard[y][x] === 'miss') cell.classList.add('miss');
    }
  }
  // Mark sunk ships
  sunkShips.op.forEach((name) => {
    // We don't know exact positions of sunk opponent ships, just color existing hits
  });
}

// --- Placement ---
function startPlacement() {
  phase = 'placement';
  placementShips = new Array(SHIPS.length).fill(null);
  currentShipIdx = 0;
  horizontal = true;
  createBoardDOM('my-board', onPlacementClick);
  createBoardDOM('op-board', null);
  document.getElementById('placement-controls').classList.remove('hidden');
  renderShipList();
  setStatus('Place your ships! Click the grid to position them.');
  setTurn('');
}

function renderShipList() {
  const list = document.getElementById('ship-list');
  list.innerHTML = '';
  SHIPS.forEach((s, i) => {
    const tag = document.createElement('div');
    tag.className =
      'ship-tag' +
      (i === currentShipIdx ? ' current' : '') +
      (placementShips[i] ? ' placed' : '');
    tag.textContent = `${s.name} (${s.size})`;
    tag.style.cursor = 'pointer';
    tag.addEventListener('click', () => {
      currentShipIdx = i;
      renderShipList();
      renderMyBoard();
    });
    list.appendChild(tag);
  });
  document.getElementById('confirm-btn').disabled = placementShips.some(
    (s) => s === null
  );
}

function isValidPlacement(ships, idx, x, y, horiz) {
  const size = SHIPS[idx].size;
  const tempBoard = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null)
  );
  ships.forEach((s, i) => {
    if (!s || i === idx) return;
    for (let j = 0; j < SHIPS[i].size; j++) {
      const cx = s.horizontal ? s.x + j : s.x;
      const cy = s.horizontal ? s.y : s.y + j;
      tempBoard[cy][cx] = i;
    }
  });
  for (let j = 0; j < size; j++) {
    const cx = horiz ? x + j : x;
    const cy = horiz ? y : y + j;
    if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) return false;
    if (tempBoard[cy][cx] !== null) return false;
  }
  return true;
}

function onPlacementClick(x, y) {
  if (phase !== 'placement') return;
  if (isValidPlacement(placementShips, currentShipIdx, x, y, horizontal)) {
    placementShips[currentShipIdx] = { x, y, horizontal };
    renderMyBoard();
    // Auto-advance to next unplaced ship
    const next = placementShips.findIndex(
      (s, i) => s === null && i > currentShipIdx
    );
    if (next !== -1) currentShipIdx = next;
    else {
      const first = placementShips.findIndex((s) => s === null);
      if (first !== -1) currentShipIdx = first;
    }
    renderShipList();
  }
}

// Preview on hover
document.getElementById('my-board').addEventListener('mouseover', (e) => {
  if (phase !== 'placement' || !e.target.dataset.x) return;
  clearPreview();
  const x = +e.target.dataset.x,
    y = +e.target.dataset.y;
  const valid = isValidPlacement(
    placementShips,
    currentShipIdx,
    x,
    y,
    horizontal
  );
  for (let j = 0; j < SHIPS[currentShipIdx].size; j++) {
    const cx = horizontal ? x + j : x;
    const cy = horizontal ? y : y + j;
    if (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE) {
      getCell('my-board', cx, cy).classList.add(
        valid ? 'preview' : 'preview-invalid'
      );
    }
  }
});
document.getElementById('my-board').addEventListener('mouseout', clearPreview);

function clearPreview() {
  document
    .querySelectorAll('#my-board .preview, #my-board .preview-invalid')
    .forEach((c) => {
      c.classList.remove('preview', 'preview-invalid');
    });
}

function rotateShip() {
  horizontal = !horizontal;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') rotateShip();
});

function confirmPlacement() {
  if (placementShips.some((s) => s === null)) return;
  myShips = placementShips;
  socket.emit('place-ships', { ships: placementShips });
}

// --- Firing ---
function startFiring() {
  phase = 'firing';
  document.getElementById('placement-controls').classList.add('hidden');
  createBoardDOM('my-board', null);
  createBoardDOM('op-board', onFireClick);
  opShotsBoard =
    opShotsBoard ||
    Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  incomingShotsBoard =
    incomingShotsBoard ||
    Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  renderMyBoardFiring(incomingShotsBoard);
  renderOpBoard();
}

function onFireClick(x, y) {
  if (phase !== 'firing') return;
  if (opShotsBoard[y][x] !== null) return;
  socket.emit('fire', { x, y });
}

// --- Socket events ---
socket.on('game-created', ({ gameId: gid, playerId: pid, token }) => {
  gameId = gid;
  playerId = pid;
  sessionStorage.setItem('gameId', gid);
  sessionStorage.setItem('playerId', pid);
  sessionStorage.setItem('sessionToken', token);
  showScreen('game-screen');
  if (gameMode === 'mp') {
    const link = `${location.origin}?join=${gid}`;
    const el = document.getElementById('share-link');
    el.innerHTML = `Share this link: <a href="${link}">${link}</a> (or ID: <code>${gid}</code>)`;
    el.classList.remove('hidden');
    setStatus('Waiting for opponent to join...');
  }
  startPlacement();
});

socket.on('game-joined', ({ gameId: gid, playerId: pid, token }) => {
  gameId = gid;
  playerId = pid;
  sessionStorage.setItem('gameId', gid);
  sessionStorage.setItem('playerId', pid);
  sessionStorage.setItem('sessionToken', token);
  showScreen('game-screen');
  startPlacement();
});

socket.on('player-joined', () => {
  setStatus('Opponent joined! Place your ships.');
});

socket.on('ships-placed', () => {
  setStatus('Ships placed! Waiting for opponent...');
});

socket.on('phase-change', ({ phase: p, turn }) => {
  if (p === 'firing') {
    startFiring();
    updateTurnDisplay(turn);
  }
});

function updateTurnDisplay(turn) {
  if (turn === playerId) {
    setTurn('🎯 Your turn — pick a target!');
    setStatus('');
    document.getElementById('op-board').classList.add('clickable');
  } else {
    setTurn("⏳ Opponent's turn...");
    document.getElementById('op-board').classList.remove('clickable');
  }
}

socket.on('shot-result', ({ player, x, y, result, sunk, winner }) => {
  if (player === playerId) {
    opShotsBoard[y][x] = result;
    renderOpBoard();
    if (sunk) {
      setStatus(`You sunk their ${sunk}! 💥`);
      sunkShips.op.add(sunk);
    } else {
      setStatus(result === 'hit' ? 'Hit! 🔥' : 'Miss 🌊');
    }
  } else {
    incomingShotsBoard[y][x] = result;
    renderMyBoardFiring(incomingShotsBoard);
    if (sunk) {
      setStatus(`They sunk your ${sunk}! 💥`);
      sunkShips.me.add(sunk);
    } else if (result === 'hit') {
      setStatus('They hit your ship! 🔥');
    }
  }
  if (winner) {
    phase = 'finished';
    const won = winner === playerId;
    document.getElementById('win-text').textContent = won
      ? '🎉 You Win!'
      : '😞 You Lose';
    document.getElementById('win-overlay').classList.remove('hidden');
    sessionStorage.removeItem('gameId');
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('sessionToken');
  } else {
    const nextTurn = player === 'p1' ? 'p2' : 'p1';
    updateTurnDisplay(nextTurn);
  }
});

socket.on(
  'rejoin-state',
  ({
    phase: p,
    turn,
    myShips: ships,
    myShots,
    incomingShots,
    winner,
    mode,
  }) => {
    gameMode = mode;
    myShips = ships;
    opShotsBoard = myShots;
    incomingShotsBoard = incomingShots;
    if (winner) {
      phase = 'finished';
      showScreen('game-screen');
      startFiring();
      const won = winner === playerId;
      document.getElementById('win-text').textContent = won
        ? '🎉 You Win!'
        : '😞 You Lose';
      document.getElementById('win-overlay').classList.remove('hidden');
    } else if (p === 'firing') {
      showScreen('game-screen');
      startFiring();
      updateTurnDisplay(turn);
    } else if (p === 'placement') {
      showScreen('game-screen');
      if (ships) {
        placementShips = ships;
        setStatus('Ships placed! Waiting for opponent...');
        createBoardDOM('my-board', null);
        createBoardDOM('op-board', null);
        renderMyBoard();
      } else {
        startPlacement();
      }
    }
  }
);

socket.on('error-msg', (msg) => setStatus(`⚠️ ${msg}`));

// --- Actions ---
function startAI() {
  gameMode = 'ai';
  sunkShips = { me: new Set(), op: new Set() };
  opShotsBoard = null;
  incomingShotsBoard = null;
  socket.emit('create-ai-game');
}

function createMP() {
  gameMode = 'mp';
  sunkShips = { me: new Set(), op: new Set() };
  opShotsBoard = null;
  incomingShotsBoard = null;
  socket.emit('create-mp-game');
}

function joinMP() {
  const id = document.getElementById('join-input').value.trim();
  if (!id) return;
  gameMode = 'mp';
  sunkShips = { me: new Set(), op: new Set() };
  opShotsBoard = null;
  incomingShotsBoard = null;
  socket.emit('join-game', { gameId: id });
}

function rematch() {
  document.getElementById('win-overlay').classList.add('hidden');
  document.getElementById('share-link').classList.add('hidden');
  if (gameMode === 'ai') startAI();
  else createMP();
}

function backToMenu() {
  document.getElementById('win-overlay').classList.add('hidden');
  document.getElementById('share-link').classList.add('hidden');
  showScreen('menu-screen');
  phase = 'menu';
  sessionStorage.removeItem('gameId');
  sessionStorage.removeItem('playerId');
  sessionStorage.removeItem('sessionToken');
}

async function showHistory() {
  showScreen('history-screen');
  const res = await fetch('/api/history');
  const data = await res.json();
  const tbody = document.querySelector('#history-table tbody');
  tbody.innerHTML = '';
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;color:#607d8b">No completed games yet</td></tr>';
    return;
  }
  data.forEach((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(g.finished_at + 'Z').toLocaleString()}</td><td>${g.mode === 'ai' ? 'vs AI' : 'Multiplayer'}</td><td>${g.winner === 'p1' ? 'Player 1' : g.winner === 'p2' ? (g.mode === 'ai' ? 'AI' : 'Player 2') : '-'}</td><td>${g.total_moves}</td>`;
    tbody.appendChild(tr);
  });
}

// --- Auto-join from URL & refresh recovery ---
window.addEventListener('load', () => {
  const params = new URLSearchParams(location.search);
  const joinId = params.get('join');
  if (joinId) {
    document.getElementById('join-input').value = joinId;
    joinMP();
    return;
  }
  // Try to rejoin after refresh
  const savedGame = sessionStorage.getItem('gameId');
  const savedPlayer = sessionStorage.getItem('playerId');
  if (savedGame && savedPlayer) {
    gameId = savedGame;
    playerId = savedPlayer;
    socket.emit('rejoin', { gameId: savedGame, playerId: savedPlayer, token: sessionStorage.getItem('sessionToken') });
  }
});
