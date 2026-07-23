# Pelusas — online, peer-to-peer

A fan-made web version of **Pelusas** (also published as **HIT!** and **No Mercy**),
Reiner Knizia's push-your-luck card game, playable with 2–6 friends over the
internet with nothing but a link.

**Play:** open the page, click *Start a room*, send the invite link to a friend.

- No server, no accounts: the host's browser owns the game and everyone else
  connects directly to it over WebRTC (via the free PeerJS broker for the
  initial handshake).
- The host tab must stay open — it *is* the game server. Guests who drop can
  reopen the invite link with the same name to rejoin.

## Rules implemented

90-card deck: eleven each of 1–5, seven each of 6–10. On your turn, flip cards
one at a time. Flipping a value that's face-up in front of an opponent lets you
steal every copy of it. Stop whenever you like (your cards stay face-up and
stealable until your next turn, when they bank). Flip a value you already have
face-up while holding 3+ cards and you bust — everything in front of you leaves
the game. When the deck runs out, everyone banks; highest total wins.

## Development

Pure-logic engine in `game.js` (no DOM), tests via `node --test`.
`net.js` is the PeerJS host/guest layer; `ui.js` renders. Serve statically:

```
python3 -m http.server 8123
```

## Credits

Game design © Reiner Knizia; published as Pelusas (Mercurio), HIT!/No Mercy
(Ravensburger). This is an unofficial implementation with original artwork,
made for private play among friends — please buy the real deck.
