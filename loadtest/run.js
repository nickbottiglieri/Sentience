/**
 * Load test for Battleship — simulates concurrent AI games end-to-end.
 *
 * Usage:
 *   node loadtest/run.js [OPTIONS]
 *
 *   --url=URL          Server URL (default: http://localhost:3000)
 *   --games=N          Concurrent games (default: 50)
 *   --rounds=N         Sequential rounds per slot (default: 3)
 *
 * Setup (two-process with nginx):
 *   redis-server
 *   REDIS_URL=redis://localhost:6379 PORT=3001 node server.js
 *   REDIS_URL=redis://localhost:6379 PORT=3002 node server.js
 *   docker run --rm -p 3000:3000 -v $(pwd)/loadtest/nginx.conf:/etc/nginx/nginx.conf:ro nginx
 *   node loadtest/run.js
 */

const { io } = require('socket.io-client');

const args = Object.fromEntries(
  process.argv.slice(2).map(a => { const [k, v] = a.split('='); return [k.replace(/^--/, ''), v]; })
);

const URL = args.url || 'http://localhost:3000';
const CONCURRENT = parseInt(args.games) || 50;
const ROUNDS = parseInt(args.rounds) || 3;

const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

function placeShips() {
  const ships = [];
  const occupied = new Set();
  for (const ship of SHIPS) {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * (horizontal ? 10 - ship.size + 1 : 10));
      const y = Math.floor(Math.random() * (horizontal ? 10 : 10 - ship.size + 1));
      const cells = [];
      let ok = true;
      for (let j = 0; j < ship.size; j++) {
        const k = `${horizontal ? x + j : x},${horizontal ? y : y + j}`;
        if (occupied.has(k)) { ok = false; break; }
        cells.push(k);
      }
      if (ok) { cells.forEach(k => occupied.add(k)); ships.push({ x, y, horizontal }); placed = true; }
    }
  }
  return ships;
}

function runGame(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'] });
    const shotLatencies = [];
    const shotQueue = [];
    let myTurn = false;
    let phase = 'connecting';

    // Build a shuffled list of all cells to fire at
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++)
        shotQueue.push({ x, y });
    for (let i = shotQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shotQueue[i], shotQueue[j]] = [shotQueue[j], shotQueue[i]];
    }

    let shotStart;

    function fireNext() {
      if (!myTurn || phase !== 'firing' || shotQueue.length === 0) return;
      myTurn = false;
      const { x, y } = shotQueue.pop();
      shotStart = Date.now();
      socket.emit('fire', { x, y });
    }

    socket.on('connect', () => {
      phase = 'creating';
      socket.emit('create-ai-game');
    });

    socket.on('game-created', () => {
      phase = 'placement';
      socket.emit('place-ships', { ships: placeShips() });
    });

    socket.on('phase-change', ({ phase: p, turn }) => {
      phase = 'firing';
      myTurn = turn === 'p1';
      fireNext();
    });

    socket.on('shot-result', ({ player, winner }) => {
      if (player === 'p1' && shotStart) {
        shotLatencies.push(Date.now() - shotStart);
      }
      if (winner) {
        socket.disconnect();
        resolve({ latencies: shotLatencies, winner });
        return;
      }
      if (player === 'p2') {
        myTurn = true;
        fireNext();
      }
    });

    socket.on('error-msg', (msg) => {
      // Duplicate shot — skip and fire next
      if (msg === 'Already fired there') { myTurn = true; fireNext(); return; }
    });

    socket.on('connect_error', (err) => reject(err));
    setTimeout(() => { socket.disconnect(); reject(new Error('Game timeout')); }, 60000);
  });
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log(`\n⚓ Battleship Load Test`);
  console.log(`  Target:     ${URL}`);
  console.log(`  Concurrent: ${CONCURRENT} games`);
  console.log(`  Rounds:     ${ROUNDS}\n`);

  const allLatencies = [];
  let totalGames = 0;
  let errors = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    const roundStart = Date.now();
    const promises = Array.from({ length: CONCURRENT }, () =>
      runGame(URL).catch(err => { errors++; return null; })
    );
    const results = await Promise.all(promises);
    const roundMs = Date.now() - roundStart;

    for (const r of results) {
      if (r) { allLatencies.push(...r.latencies); totalGames++; }
    }

    const roundLatencies = results.filter(Boolean).flatMap(r => r.latencies);
    console.log(`  Round ${round}/${ROUNDS}: ${results.filter(Boolean).length}/${CONCURRENT} games completed in ${(roundMs / 1000).toFixed(1)}s` +
      (roundLatencies.length ? ` | p50=${percentile(roundLatencies, 50)}ms p95=${percentile(roundLatencies, 95)}ms p99=${percentile(roundLatencies, 99)}ms` : ''));
  }

  console.log(`\n  ── Results ──`);
  console.log(`  Total games:  ${totalGames}`);
  console.log(`  Errors:       ${errors}`);
  console.log(`  Total shots:  ${allLatencies.length}`);
  if (allLatencies.length) {
    console.log(`  Shot latency: p50=${percentile(allLatencies, 50)}ms  p95=${percentile(allLatencies, 95)}ms  p99=${percentile(allLatencies, 99)}ms`);
    console.log(`  Min/Max:      ${Math.min(...allLatencies)}ms / ${Math.max(...allLatencies)}ms`);
  }
  console.log('');
}

main().catch(console.error);
