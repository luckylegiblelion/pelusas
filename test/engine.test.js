import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeck, newGame, applyAction, sum, stealTargets, mulberry32,
} from '../game.js';

test('deck has 90 cards with the right distribution', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 90);
  const counts = {};
  for (const c of deck) counts[c] = (counts[c] || 0) + 1;
  for (const v of [1, 2, 3, 4, 5]) assert.equal(counts[v], 11);
  for (const v of [6, 7, 8, 9, 10]) assert.equal(counts[v], 7);
});

test('duplicate with fewer than 3 cards up is safe', () => {
  const s = newGame(['A', 'B'], 1);
  s.players[0].tableau = [4, 4];
  s.deck.push(4); // next flip
  applyAction(s, 0, { t: 'draw' });
  assert.deepEqual(s.players[0].tableau, [4, 4, 4]);
  assert.notEqual(s.lastEvent.type, 'bust');
});

test('duplicate with 3+ cards up busts and removes cards from game', () => {
  const s = newGame(['A', 'B'], 1);
  s.players[0].tableau = [2, 4, 7];
  s.deck.push(4);
  const removedBefore = s.removed.length;
  applyAction(s, 0, { t: 'draw' });
  assert.equal(s.lastEvent.type, 'bust');
  assert.deepEqual(s.players[0].tableau, []);
  assert.equal(s.removed.length - removedBefore, 4);
  assert.equal(s.current, 1); // turn passed
});

test('stealing takes all matching face-up cards from all opponents', () => {
  const s = newGame(['A', 'B', 'C'], 1);
  s.players[1].tableau = [7, 7, 3];
  s.players[2].tableau = [7];
  s.deck.push(7);
  applyAction(s, 0, { t: 'draw' });
  assert.equal(s.phase, 'steal');
  assert.equal(s.pendingValue, 7);
  applyAction(s, 0, { t: 'steal', take: true });
  assert.deepEqual(s.players[0].tableau, [7, 7, 7, 7]);
  assert.deepEqual(s.players[1].tableau, [3]);
  assert.deepEqual(s.players[2].tableau, []);
  assert.equal(s.phase, 'draw');
});

test('declining a steal keeps opponents cards in place', () => {
  const s = newGame(['A', 'B'], 1);
  s.players[1].tableau = [5];
  s.deck.push(5);
  applyAction(s, 0, { t: 'draw' });
  assert.equal(s.phase, 'steal');
  applyAction(s, 0, { t: 'steal', take: false });
  assert.deepEqual(s.players[1].tableau, [5]);
  assert.deepEqual(s.players[0].tableau, [5]);
});

test('cannot stop before flipping at least once', () => {
  const s = newGame(['A', 'B'], 1);
  const r = applyAction(s, 0, { t: 'stop' });
  assert.equal(r.ok, false);
});

test('face-up cards bank at the start of your next turn', () => {
  const s = newGame(['A', 'B'], 1);
  applyAction(s, 0, { t: 'draw' });
  if (s.phase === 'steal') applyAction(s, 0, { t: 'steal', take: false });
  applyAction(s, 0, { t: 'stop' });
  // B's turn: B flips once and stops; then it's A's turn again and A banks.
  const aTableau = [...s.players[0].tableau];
  assert.ok(aTableau.length === 1);
  applyAction(s, 1, { t: 'draw' });
  if (s.phase === 'steal') applyAction(s, 1, { t: 'steal', take: false });
  applyAction(s, 1, { t: 'stop' });
  assert.equal(s.current, 0);
  assert.deepEqual(s.players[0].tableau, []);
  assert.deepEqual(s.players[0].banked, aTableau);
});

test('out-of-turn and wrong-phase actions are rejected', () => {
  const s = newGame(['A', 'B'], 1);
  assert.equal(applyAction(s, 1, { t: 'draw' }).ok, false);
  assert.equal(applyAction(s, 0, { t: 'steal', take: true }).ok, false);
});

test('full random playthrough conserves all 90 cards and ends', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = newGame(['A', 'B', 'C'], seed);
    const rand = mulberry32(seed * 7919);
    let guard = 10000;
    while (s.phase !== 'over' && guard-- > 0) {
      if (s.phase === 'steal') {
        applyAction(s, s.current, { t: 'steal', take: rand() < 0.7 });
      } else if (s.turnDraws >= 1 && rand() < 0.4) {
        applyAction(s, s.current, { t: 'stop' });
      } else {
        applyAction(s, s.current, { t: 'draw' });
      }
    }
    assert.ok(guard > 0, 'game terminated');
    assert.equal(s.phase, 'over');
    const inPlay = s.players.reduce(
      (n, p) => n + p.banked.length + p.tableau.length, 0);
    assert.equal(inPlay + s.removed.length + s.deck.length, 90);
    assert.ok(Array.isArray(s.winners) && s.winners.length >= 1);
    const best = Math.max(...s.totals);
    for (const w of s.winners) assert.equal(s.totals[w], best);
  }
});
