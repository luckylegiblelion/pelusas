// Pelusas / No Mercy — pure game engine. No DOM, no network.
// Rules implemented (Knizia's HIT! / No Mercy / Pelusas):
//   Deck: eleven each of 1-5, seven each of 6-10 (90 cards).
//   On your turn: flip cards one at a time. Each flip you may steal all
//   face-up cards of the flipped value from every opponent. Stop whenever
//   you like (after at least one flip); your face-up cards stay in front
//   of you until the start of your next turn, when they bank face-down.
//   Bust: you flip a value already face-up in front of you while holding
//   3+ face-up cards — everything in front of you is removed from the game.
//   Deck runs out: everyone banks what's in front of them; highest total wins.

export const DECK_SPEC = [
  [1, 11], [2, 11], [3, 11], [4, 11], [5, 11],
  [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
];

export function buildDeck() {
  const deck = [];
  for (const [value, count] of DECK_SPEC) {
    for (let i = 0; i < count; i++) deck.push(value);
  }
  return deck;
}

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(names, seed) {
  if (names.length < 2 || names.length > 6) {
    throw new Error('Pelusas is for 2-6 players');
  }
  return {
    seed,
    deck: shuffle(buildDeck(), mulberry32(seed)),
    removed: [],
    players: names.map((name) => ({ name, tableau: [], banked: [] })),
    current: 0,
    phase: 'draw', // 'draw' | 'steal' | 'over'
    pendingValue: null,
    turnDraws: 0,
    lastEvent: { type: 'start' },
    log: [],
    totals: null,
    winners: null,
  };
}

export function sum(cards) {
  return cards.reduce((a, b) => a + b, 0);
}

export function stealTargets(state, value) {
  return state.players
    .map((p, i) => ({ i, name: p.name, count: p.tableau.filter((c) => c === value).length }))
    .filter((t) => t.i !== state.current && t.count > 0);
}

function pushLog(state, text) {
  state.log.push(text);
  if (state.log.length > 40) state.log.shift();
}

function name(state, i) {
  return state.players[i].name;
}

function endTurn(state) {
  state.current = (state.current + 1) % state.players.length;
  state.turnDraws = 0;
  state.phase = 'draw';
  const p = state.players[state.current];
  if (p.tableau.length) {
    const banked = sum(p.tableau);
    p.banked.push(...p.tableau);
    p.tableau = [];
    pushLog(state, `${p.name} banks ${banked} points`);
  }
}

function endGame(state) {
  for (const p of state.players) {
    p.banked.push(...p.tableau);
    p.tableau = [];
  }
  state.totals = state.players.map((p) => sum(p.banked));
  const best = Math.max(...state.totals);
  state.winners = state.totals
    .map((t, i) => (t === best ? i : -1))
    .filter((i) => i !== -1);
  state.phase = 'over';
  state.pendingValue = null;
  pushLog(state, `Deck empty — game over!`);
}

function afterResolve(state) {
  if (state.deck.length === 0) endGame(state);
}

// action: {t:'draw'} | {t:'stop'} | {t:'steal', take:boolean}
// Returns {ok:true} or {ok:false, error}. Mutates state.
export function applyAction(state, playerIdx, action) {
  if (state.phase === 'over') return { ok: false, error: 'game is over' };
  if (playerIdx !== state.current) return { ok: false, error: 'not your turn' };

  if (action.t === 'draw') {
    if (state.phase !== 'draw') return { ok: false, error: 'resolve the steal first' };
    const p = state.players[state.current];
    const value = state.deck.pop();
    state.turnDraws++;
    if (p.tableau.includes(value) && p.tableau.length >= 3) {
      const lost = [...p.tableau, value];
      state.removed.push(...lost);
      p.tableau = [];
      state.lastEvent = { type: 'bust', value, player: state.current, lostPoints: sum(lost) };
      pushLog(state, `${p.name} flips a ${value} — BUST! ${sum(lost)} points swept away`);
      if (state.deck.length === 0) return (endGame(state), { ok: true });
      endTurn(state);
      return { ok: true };
    }
    p.tableau.push(value);
    p.tableau.sort((a, b) => a - b);
    state.lastEvent = { type: 'draw', value, player: state.current };
    pushLog(state, `${p.name} flips a ${value}`);
    const targets = stealTargets(state, value);
    if (targets.length) {
      state.phase = 'steal';
      state.pendingValue = value;
      return { ok: true };
    }
    afterResolve(state);
    return { ok: true };
  }

  if (action.t === 'steal') {
    if (state.phase !== 'steal') return { ok: false, error: 'nothing to steal' };
    const value = state.pendingValue;
    state.pendingValue = null;
    state.phase = 'draw';
    if (action.take) {
      let taken = 0;
      for (let i = 0; i < state.players.length; i++) {
        if (i === state.current) continue;
        const pl = state.players[i];
        const grabbed = pl.tableau.filter((c) => c === value);
        if (grabbed.length) {
          taken += grabbed.length;
          pl.tableau = pl.tableau.filter((c) => c !== value);
          state.players[state.current].tableau.push(...grabbed);
        }
      }
      state.players[state.current].tableau.sort((a, b) => a - b);
      state.lastEvent = { type: 'steal', value, count: taken, player: state.current };
      pushLog(state, `${name(state, state.current)} steals ${taken} × ${value}`);
    } else {
      state.lastEvent = { type: 'skipSteal', value, player: state.current };
    }
    afterResolve(state);
    return { ok: true };
  }

  if (action.t === 'stop') {
    if (state.phase !== 'draw') return { ok: false, error: 'resolve the steal first' };
    if (state.turnDraws < 1) return { ok: false, error: 'flip at least one card first' };
    const p = state.players[state.current];
    state.lastEvent = { type: 'stop', player: state.current, kept: sum(p.tableau) };
    pushLog(state, `${p.name} stops with ${sum(p.tableau)} showing`);
    endTurn(state);
    return { ok: true };
  }

  return { ok: false, error: `unknown action ${action.t}` };
}
