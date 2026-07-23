// Peer-to-peer plumbing. The host is authoritative: it owns the real game
// state, applies every action through the engine, and sends each player a
// personalized view (guests never see the deck order or hidden totals).

import { newGame, applyAction, stealTargets, sum } from './game.js';

export function viewFor(state, idx, connected) {
  return {
    seq: state.seq || 0,
    deckCount: state.deck.length,
    removedCount: state.removed.length,
    current: state.current,
    phase: state.phase,
    turnDraws: state.turnDraws,
    lastEvent: state.lastEvent,
    log: state.log.slice(-8).reverse(),
    you: idx,
    totals: state.totals,
    winners: state.winners,
    steal: state.phase === 'steal'
      ? { value: state.pendingValue, targets: stealTargets(state, state.pendingValue) }
      : null,
    players: state.players.map((p, i) => ({
      name: p.name,
      tableau: p.tableau,
      tableauSum: sum(p.tableau),
      bankedCount: p.banked.length,
      bankedSum: (i === idx || state.phase === 'over') ? sum(p.banked) : null,
      connected: connected ? connected[i] : true,
    })),
  };
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0] || 42;
}

export function createHost(hostName, cbs) {
  const peer = new Peer();
  // guests[i] is player index i+1 once the game starts
  const guests = []; // { conn, name }
  let state = null;

  peer.on('open', (id) => cbs.onOpen(id));
  peer.on('error', (e) => cbs.onError(friendlyPeerError(e)));

  peer.on('connection', (conn) => {
    conn.on('data', (msg) => handle(conn, msg));
    conn.on('close', () => {
      const gi = guests.findIndex((g) => g.conn === conn);
      if (gi === -1) return;
      if (!state) {
        guests.splice(gi, 1);
        broadcastLobby();
      } else {
        guests[gi].conn = null;
        cbs.onInfo(`${guests[gi].name} disconnected — they can rejoin with the same link`);
        broadcastState();
      }
    });
  });

  function uniqueName(name) {
    const taken = [hostName, ...guests.map((g) => g.name)];
    let n = name || 'Player';
    let i = 2;
    while (taken.includes(n)) n = `${name} ${i++}`;
    return n;
  }

  function handle(conn, msg) {
    if (msg.t === 'hello') {
      if (!state) {
        if (guests.length >= 5) { conn.send({ t: 'err', msg: 'Room is full (6 players max)' }); return; }
        guests.push({ conn, name: uniqueName(msg.name) });
        broadcastLobby();
      } else {
        // rejoin by name
        const gi = guests.findIndex((g) => g.name === msg.name && !g.conn);
        if (gi !== -1) {
          guests[gi].conn = conn;
          cbs.onInfo(`${msg.name} reconnected`);
          broadcastState();
        } else {
          conn.send({ t: 'err', msg: 'Game already in progress' });
        }
      }
      return;
    }
    if (msg.t === 'act') {
      const gi = guests.findIndex((g) => g.conn === conn);
      if (gi === -1) return;
      act(gi + 1, msg.action, conn);
    }
  }

  function act(idx, action, conn) {
    if (!state) return;
    const r = applyAction(state, idx, action);
    if (!r.ok) {
      if (conn) conn.send({ t: 'err', msg: r.error });
      else cbs.onError(r.error);
      return;
    }
    state.seq++;
    broadcastState();
  }

  function connectedFlags() {
    return [true, ...guests.map((g) => !!(g.conn && g.conn.open))];
  }

  function broadcastLobby() {
    const names = [hostName, ...guests.map((g) => g.name)];
    guests.forEach((g, gi) => {
      if (g.conn?.open) g.conn.send({ t: 'lobby', names, youAre: gi + 1 });
    });
    cbs.onLobby(names);
  }

  function broadcastState() {
    const flags = connectedFlags();
    guests.forEach((g, gi) => {
      if (g.conn?.open) g.conn.send({ t: 'state', view: viewFor(state, gi + 1, flags) });
    });
    cbs.onView(viewFor(state, 0, flags));
  }

  return {
    isHost: true,
    canStart: () => !state && guests.length >= 1,
    start() {
      if (guests.length < 1) return;
      state = newGame([hostName, ...guests.map((g) => g.name)], randomSeed());
      state.seq = 0;
      broadcastState();
    },
    playAgain() {
      if (!state || state.phase !== 'over') return;
      const names = state.players.map((p) => p.name);
      state = newGame(names, randomSeed());
      state.seq = 0;
      broadcastState();
    },
    act(action) { act(0, action, null); },
  };
}

export function createGuest(hostId, name, cbs) {
  const peer = new Peer();
  let conn = null;

  peer.on('open', () => {
    conn = peer.connect(hostId, { reliable: true });
    conn.on('open', () => conn.send({ t: 'hello', name }));
    conn.on('data', (msg) => {
      if (msg.t === 'lobby') cbs.onLobby(msg.names, msg.youAre);
      else if (msg.t === 'state') cbs.onView(msg.view);
      else if (msg.t === 'err') cbs.onError(msg.msg);
    });
    conn.on('close', () => cbs.onClosed());
  });
  peer.on('error', (e) => cbs.onError(friendlyPeerError(e)));

  return {
    isHost: false,
    act(action) { if (conn?.open) conn.send({ t: 'act', action }); },
  };
}

function friendlyPeerError(e) {
  const type = e?.type || '';
  if (type === 'peer-unavailable') return 'Room not found — has the host closed their tab?';
  if (type === 'network' || type === 'disconnected') return 'Lost connection to the matchmaking server — check your internet and reload.';
  if (type === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return `Connection problem (${type || e})`;
}
