import { createHost, createGuest } from './net.js';

const $ = (sel) => document.querySelector(sel);

const screens = {
  home: $('#screen-home'),
  lobby: $('#screen-lobby'),
  game: $('#screen-game'),
};

let session = null;      // createHost/createGuest handle
let isHost = false;
let inviteLink = '';
let lastSeq = -1;
let lastView = null;

// ---------- helpers ----------

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function cardEl(value, size = '') {
  const div = document.createElement('div');
  div.className = `card ${size}`.trim();
  div.setAttribute('aria-label', `card ${value}`);
  div.innerHTML = `
    <span class="pip tl">${value}</span>
    <span class="pip br">${value}</span>
    <svg viewBox="0 0 74 104" aria-hidden="true">
      <circle cx="37" cy="58" r="21" fill="var(--c${value})" filter="url(#fuzz)"/>
      <circle cx="30" cy="51" r="6" fill="#fff"/>
      <circle cx="45" cy="51" r="6" fill="#fff"/>
      <circle class="pupil" cx="30" cy="52" r="2.6" fill="#241a10"/>
      <circle class="pupil" cx="45" cy="52" r="2.6" fill="#241a10"/>
    </svg>`;
  return div;
}

// googly eyes follow the cursor
addEventListener('pointermove', (e) => {
  const x = (e.clientX / innerWidth) * 2 - 1;
  const y = (e.clientY / innerHeight) * 2 - 1;
  document.documentElement.style.setProperty('--look-x', x.toFixed(3));
  document.documentElement.style.setProperty('--look-y', y.toFixed(3));
}, { passive: true });

// ---------- home screen ----------

const nameInput = $('#name-input');
nameInput.value = localStorage.getItem('pelusas-name') || '';

const joinId = new URLSearchParams(location.search).get('join');
if (joinId) {
  $('#home-host-ui').hidden = true;
  $('#home-join-ui').hidden = false;
}

function myName() {
  const n = nameInput.value.trim().slice(0, 16);
  if (!n) {
    toast('Type your name first!');
    nameInput.focus();
    return null;
  }
  localStorage.setItem('pelusas-name', n);
  return n;
}

const netCallbacks = {
  onLobby: renderLobby,
  onView: onView,
  onInfo: toast,
  onError: (msg) => { toast(msg); $('#home-status').textContent = msg; },
  onClosed: () => toast('Connection to host lost — reload this page to rejoin.'),
};

$('#btn-host').addEventListener('click', () => {
  const n = myName();
  if (!n) return;
  $('#home-status').textContent = 'Opening room…';
  isHost = true;
  session = createHost(n, {
    ...netCallbacks,
    onOpen: (id) => {
      inviteLink = `${location.origin}${location.pathname}?join=${id}`;
      $('#invite-link').value = inviteLink;
      renderLobby([n]);
      show('lobby');
    },
  });
});

$('#btn-join').addEventListener('click', () => {
  const n = myName();
  if (!n) return;
  $('#home-status').textContent = 'Joining room…';
  isHost = false;
  session = createGuest(joinId, n, netCallbacks);
});

// ---------- lobby ----------

$('#btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteLink);
    toast('Link copied — send it to your friend!');
  } catch {
    $('#invite-link').select();
    toast('Copy blocked — the link is selected, press Ctrl+C');
  }
});

$('#btn-start').addEventListener('click', () => session?.start?.());

function renderLobby(names) {
  show('lobby');
  if (!isHost) {
    $('#invite-row').hidden = true;
    $('#btn-start').hidden = true;
    $('#lobby-status').textContent = 'Waiting for the host to start…';
  } else {
    $('#btn-start').disabled = names.length < 2;
    $('#lobby-status').textContent = names.length < 2
      ? 'Waiting for at least one friend to join…' : '';
  }
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  names.forEach((n, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = `var(--c${(i % 10) + 1})`;
    li.append(dot, document.createTextNode(n + (i === 0 ? ' (host)' : '')));
    ul.append(li);
  });
}

// ---------- game rendering ----------

function onView(view) {
  lastView = view;
  show('game');
  $('#overlay').hidden = view.phase !== 'over';

  renderPlayers(view);
  $('#deck-count').textContent = view.deckCount;
  $('#removed-count').textContent = view.removedCount || '';
  renderStage(view);
  renderActions(view);
  renderLog(view);
  if (view.phase === 'over') renderGameOver(view);
  lastSeq = view.seq;
}

function renderPlayers(view) {
  const opp = $('#opponents');
  opp.innerHTML = '';
  view.players.forEach((p, i) => {
    if (i === view.you) return;
    const div = document.createElement('div');
    div.className = 'opp' + (i === view.current && view.phase !== 'over' ? ' active' : '');
    const head = document.createElement('div');
    head.className = 'player-head';
    head.innerHTML = `
      <span class="player-name">${escapeHtml(p.name)}${p.connected ? '' : ' <span class="disc">(offline)</span>'}</span>
      <span class="banked-chip">${p.bankedCount} banked${p.bankedSum != null ? ` · ${p.bankedSum} pts` : ''}</span>`;
    const tab = document.createElement('div');
    tab.className = 'tableau';
    p.tableau.forEach((v) => tab.append(cardEl(v, 'mini')));
    if (p.tableau.length) {
      const sumChip = document.createElement('span');
      sumChip.className = 'banked-chip';
      sumChip.style.alignSelf = 'center';
      sumChip.textContent = `${p.tableauSum} up for grabs`;
      tab.append(sumChip);
    }
    div.append(head, tab);
    opp.append(div);
  });

  const me = view.players[view.you];
  $('#you-area').classList.toggle('active', view.current === view.you && view.phase !== 'over');
  $('#you-name').textContent = `${me.name} (you)`;
  $('#you-banked').textContent = `${me.bankedCount} banked · ${me.bankedSum} pts` +
    (me.tableau.length ? ` · ${me.tableauSum} showing` : '');
  const tab = $('#you-tableau');
  tab.innerHTML = '';
  me.tableau.forEach((v) => tab.append(cardEl(v)));
}

function renderStage(view) {
  const stage = $('#stage');
  const ev = view.lastEvent;
  const isNew = view.seq !== lastSeq;
  if (!ev || ev.type === 'start') { stage.innerHTML = ''; return; }
  if (ev.type === 'draw' || ev.type === 'bust') {
    stage.innerHTML = '';
    const c = cardEl(ev.value, 'big');
    if (isNew) c.classList.add('flip-in');
    stage.append(c);
    if (ev.type === 'bust') {
      c.classList.add('shake');
      const poof = document.createElement('div');
      poof.className = 'poof-msg';
      poof.textContent = 'POOF!';
      stage.append(poof);
    }
  }
  // steals / stops keep the previous card visible
}

function renderActions(view) {
  const box = $('#actions');
  box.innerHTML = '';
  if (view.phase === 'over') return;

  const cur = view.players[view.current];
  const myTurn = view.current === view.you;

  if (!myTurn) {
    const span = document.createElement('span');
    span.className = 'waiting';
    if (view.phase === 'steal') {
      const iAmTarget = view.steal.targets.some((t) => t.i === view.you);
      span.innerHTML = `${escapeHtml(cur.name)} is deciding whether to steal the ${view.steal.value}s${iAmTarget ? ' — yours!' : ''}<span class="dots"></span>`;
    } else {
      span.innerHTML = `Waiting for ${escapeHtml(cur.name)}<span class="dots"></span>`;
    }
    box.append(span);
    return;
  }

  if (view.phase === 'steal') {
    const total = view.steal.targets.reduce((n, t) => n + t.count, 0);
    const who = view.steal.targets
      .map((t) => `${t.count} from ${escapeHtml(t.name)}`).join(', ');
    const q = document.createElement('div');
    q.className = 'steal-q';
    q.innerHTML = `You flipped a ${view.steal.value} — steal ${who}?`;
    const yes = button(`Steal ${total} × ${view.steal.value}!`, 'btn-steal',
      () => session.act({ t: 'steal', take: true }));
    const no = button('No thanks', '', () => session.act({ t: 'steal', take: false }));
    box.append(q, yes, no);
    return;
  }

  const me = view.players[view.you];
  const flip = button('FLIP!', 'btn-flip', () => session.act({ t: 'draw' }));
  const stop = button(
    me.tableau.length ? `Stop (keep ${me.tableauSum})` : 'Stop', 'btn-stop',
    () => session.act({ t: 'stop' }));
  stop.disabled = view.turnDraws < 1;
  box.append(flip, stop);

  if (me.tableau.length >= 3) {
    const uniq = [...new Set(me.tableau)];
    const warn = document.createElement('div');
    warn.className = 'steal-q';
    warn.style.color = 'var(--risk)';
    warn.textContent = `⚠ flipping a ${uniq.join(', ')} poofs you!`;
    box.append(warn);
  }
}

function renderLog(view) {
  const ol = $('#log');
  ol.innerHTML = '';
  view.log.forEach((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    ol.append(li);
  });
}

function renderGameOver(view) {
  const panel = $('#overlay-panel');
  panel.innerHTML = '<h2>Deck empty — final fuzz count!</h2>';
  const order = view.players
    .map((p, i) => ({ name: p.name, total: view.totals[i], win: view.winners.includes(i) }))
    .sort((a, b) => b.total - a.total);
  order.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (r.win ? ' winner' : '');
    row.innerHTML = `<span>${r.win ? '👑 ' : ''}${escapeHtml(r.name)}</span><span>${r.total}</span>`;
    panel.append(row);
  });
  if (isHost) {
    const again = button('Play again', 'btn-go btn-big', () => session.playAgain());
    again.style.marginTop = '16px';
    panel.append(again);
  } else {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Waiting for the host to start a rematch…';
    panel.append(p);
  }
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
