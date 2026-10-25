# TRENCHCOAT

Hidden-role Tetris for phones. Pieces fall on your phone, you tilt to move them,
and you can flick the ones you don't want onto somebody else. One player is the
Imposter, quietly dumping garbage on the table. One is the Detective, trying to
trace where the pieces are really coming from. Every 10 seconds everyone draws a
power or a handicap.

Built for **4+ players in one room**. No app install — players scan a QR code.

---

Two games share one engine. Pick the mode on the host display before you start.

| Mode | What it is |
|---|---|
| **TRENCHCOAT** | Hidden-role Tetris. Tilt to move, flick to dump pieces on rivals. |
| **SCRAMBLE** (quiz) | Trivia that builds a fighter jet, then everyone dogfights with what they earned. |

## SCRAMBLE at a glance

1. **Quiz.** Tilt to aim at an answer, twist to lock it in, or flick the phone
   at someone to dump a question you don't know on them.
2. **Parts.** Every correct answer earns a jet part. The hotter the question —
   the more times it's been passed — the rarer the drop.
3. **Sabotage.** The Cheat can swap the answer key when they pass. You're marked
   wrong for answering honestly and you earn a part that *looks fine and fails
   mid-flight*.
4. **Vote.** Name the Cheat.
5. **Dogfight.** Everyone flies the jet they built. Bank the phone to turn,
   pitch forward for throttle, thumbs on guns and missiles. Sabotaged parts give
   out partway through, by name, on the big screen.

---

## Quick start — just double-click it

| File | What it does |
|---|---|
| **START.bat** | Local Wi-Fi only. Good for testing on your own PC. |
| **START-TUNNEL.bat** | Opens a public HTTPS address. **Use this for real phones.** |

Either one creates the virtual environment, installs dependencies, starts the
server, and opens the host display in your browser. First run takes a minute;
after that it's a few seconds.

### Testing alone

Click **SOLO TEST** on the host display. It fills the table with stand-in
players who pass pieces at you, so you can exercise the whole match — roles,
powers, the vote, the reveal — with one phone or none.

### Or run it by hand

```bash
pip install -r requirements.txt
python launch.py            # or: python launch.py --tunnel
```

The terminal prints three things:

```
HOST DISPLAY  ->  http://192.168.1.42:8000
PHONES JOIN   ->  http://192.168.1.42:8000/play
ROOM CODE     ->  CG84
```

1. Open the **host display** URL on your laptop and put it on the projector.
   It shows a big QR code and the join link.
2. Players scan the QR with their phone camera. No install, no app store.
3. Each player types a name and taps **Allow motion access**.
4. Once 3+ phones are connected, hit **START GAME** on the laptop.
5. Every phone rings. They answer the call and get their secret role.

---

## ⚠️ Read this before demo day: iPhones need HTTPS

This is the thing that kills hackathon teams at hour 23.

iOS **will not give a web page motion sensor data over plain HTTP.** On
`http://192.168.x.x` the permission prompt either never appears or silently
returns denied, and your controls just don't work. Android is fine over HTTP.

Two fixes, both take two minutes:

### Option A — Cloudflare tunnel (recommended, free, no account)

```bash
brew install cloudflared          # or: https://github.com/cloudflare/cloudflared/releases
cloudflared tunnel --url http://localhost:8000
```

It prints a public `https://something-random.trycloudflare.com` URL. Pass it to
the server and the QR code will point there:

```bash
TRENCHCOAT_PUBLIC_URL="https://something-random.trycloudflare.com" python server.py
```

The startup banner confirms it with `HTTPS tunnel active`. Everything now runs
over HTTPS and motion works on every phone.

### Option B — ngrok

```bash
ngrok http 8000
TRENCHCOAT_PUBLIC_URL="https://your-id.ngrok-free.app" python server.py
```

**Test this on a real iPhone in your first two hours, not your last two.**
Everything else in this project is recoverable; this one isn't, at 3am.

---

## Controls

**Moving the piece is tilt-only.** There are no swipe controls — this is a motion
game and swiping would let people opt out of the whole point of it.

| Action | Motion | Button fallback |
|---|---|---|
| Move piece | Tilt phone left / right | *(none — tilt only)* |
| Rotate | Twist like a steering wheel | ROTATE |
| Hard drop | Flick phone down sharply | DROP |
| Pass the piece | Flick phone forward, then aim | PASS IT ON |
| Trace (Detective) | Shake hard | TRACE |
| Cycle piece (Piece Forge) | Shake | — |

### Calibration

After granting motion access you get a calibration screen. Hold the phone the way
you'll actually play, then tap **SET THIS AS NEUTRAL**. That angle becomes centre,
so holding the phone tipped back doesn't make the piece drift.

### ⚠️ iPhones: turn off Shake to Undo

**Settings → Accessibility → Touch → Shake to Undo → off**, on every iPhone
playing.

iOS pops a system "Undo Typing" dialog when you shake the phone, which lands
right on top of the game when someone shakes to Trace or to cycle Piece Forge.
**A website cannot disable this** — there's no API for it, so it has to be done
in iOS settings per device. Do it when players join, not during the demo.

The game does what it can from its side: the name field is blurred, cleared and
removed from the page the moment you join, so there's no pending text edit for
iOS to offer undoing. That removes most triggers, but the OS setting is the only
complete fix.

### The tilt meter

During play there's a live bar under the board with a needle. It moves as you tilt
and turns green once you're past the dead zone. If it's grey and a warning shows,
your sensors aren't reporting — tap the warning to re-request permission. This
exists so a broken sensor is obvious instead of you wondering why nothing moves.

### Passing

Flicking forward opens an aim ring. Point your phone at whoever you want to stick
with the piece — the compass picks them out — then tap the ring to send it.
Tapping a name works too, for when the compass is confused indoors.

---

## POP QUIZ mode

A question lands on your phone with a timer. Answer it, or flick it at someone
else. Passing is admitting you don't know it, and it's public.

Each pass makes the question **hotter**: the clock shrinks by 3 seconds and the
stakes multiply. A question that's been round the table three times is worth a
fortune to whoever finally nails it and ruinous to whoever eats it.

### Controls

Four answers, four quadrants. **Tilt the phone toward the one you want** —
left/right picks the column, forward/back picks the row — then **twist to lock
it in**. Tapping works too.

Drunk Tilt inverting both axes just as you commit is the best handicap in the game.

### The Cheat

The Imposter becomes **the Cheat**. When they pass a question they can *doctor*
it: the answer key is secretly swapped, so whoever receives it is marked wrong
for answering honestly. They get 3 doctors, and they win if group accuracy falls
below 60%.

The **Proctor** (the Detective) can audit the last question passed to them —
revealing whether it was tampered with and who handed it over. Two audits.

### Cards, same six

| Card | Quiz version |
|---|---|
| Piece Forge | **Fifty-Fifty** — two wrong answers burn away |
| Mirror Shield | Passed questions bounce back, hotter |
| Free Pass | Pass one question with your name hidden |
| Stuck With It | You cannot pass this one |
| Hot Hands | Must pass your next 2 unanswered |
| Drunk Tilt | Aiming axes inverted |

### Writing your own questions

Edit `questions.json`:

```json
{
  "title": "My Deck",
  "questions": [
    { "q": "Question text?",
      "options": ["right answer", "wrong", "wrong", "wrong"],
      "answer": 0 }
  ]
}
```

`answer` is the index of the correct option. Options are **shuffled per player
per question** at runtime, so having the answer at index 0 throughout the file
gives nothing away.

The deck is validated on load — malformed questions are skipped, and if the file
is missing or unreadable the game falls back to a built-in question rather than
crashing mid-demo.

**The answer key never leaves the server.** Players are sent the question text
and shuffled options and nothing else; correctness is decided server-side when
they commit. Opening devtools tells you nothing. This is verified by a test.

---

## Roles

| Role | Team | Goal |
|---|---|---|
| **Imposter** | Imposter | Pass 12 pieces without being identified. Has 3 Clean Passes that arrive with no animation. |
| **Mule** | Imposter | Knows the Imposter; the Imposter doesn't know them. Silently absorbs 3 passes per round. |
| **Detective** | Crew | Name the Imposter at the vote. 2 Traces reveal the true origin of the last piece received. |
| **Builder** | Crew | Clear lines, survive, vote well. No powers, no secret knowledge. |
| **Analyst** | Crew | At the vote, sees everyone's pass count — each number off by up to ±3. |

Roles are added in priority order as the table grows, so a small table simply
loses the extra roles:

| Players | Roles in play |
|---|---|
| 1 | Imposter |
| 2 | Imposter, Detective |
| 3 | Imposter, Detective, Builder |
| 4 | Imposter, Detective, Builder, **Mule** |
| 5 | + Builder |
| 6 | + **Analyst** |
| 7+ | + Builders |

The Mule is the first role dropped below 4 players — with 3 at the table an
accomplice means the crew is outnumbered and the game isn't winnable for them.
The Analyst needs 6 before its noisy pass counts carry any signal.

---

## Powers and handicaps (3 draws per round, at 10s / 30s / 50s)

**Powers**
- **Piece Forge** — shake to cycle pieces, pick the one you want
- **Mirror Shield** — 5s: incoming passes bounce back with +1 heat
- **Free Pass** — one pass with no heat and no arrival animation

**Handicaps**
- **Stuck With It** — your next piece cannot be passed
- **Hot Hands** — you must pass your next 2 pieces, no placing
- **Drunk Tilt** — 5s: tilt controls inverted

Free Pass and Hot Hands both exist to muddy the Detective's evidence: a player who
passed four pieces in a row might be the Imposter, or might have drawn Hot Hands.
That ambiguity is the game.

---

## Passed pieces look passed

A piece that's been thrown around picks up damage. The more times it's been
passed (its "heat"), the more it desaturates, sits crooked in its cell, and shows
cracks, with red pips in the corner counting the hops. A board full of other
people's garbage *looks* like a board full of other people's garbage.

---

## Tuning

Everything is at the top of `server.py`:

```python
ROUND_SECONDS    = 60   # length of each round
ROUNDS           = 3    # rounds before the vote
POWERS_PER_ROUND = 3    # card draws, spread evenly through the round
IMPOSTER_QUOTA   = 12   # passes needed for the Imposter to win on objective
```

Draws are spaced automatically, so changing either number just works — 4 cards in
a 60s round lands them at 7.5s, 22.5s, 37.5s and 52.5s.

If playtesting feels slow, drop `ROUNDS` to 2. If the Imposter wins too easily,
raise `IMPOSTER_QUOTA`. If people aren't passing enough, lower it.

---

## Files

```
START.bat              One-click launcher (local Wi-Fi)
START-TUNNEL.bat       One-click launcher (public HTTPS, for real phones)
launch.py              Startup logic: deps, tunnel, browser, server
server.py              FastAPI + WebSocket game server, all game logic
quiz.py                Question engine — dealing, scoring, doctoring, audits
parts.py               Jet loadout — 5 slots x 5 rarity tiers, drops, stats
dogfight.py            The finale — 30 Hz flight sim, bullets, missiles, faults
questions.json         The question deck. Edit this.
requirements.txt
static/
  host.html            Laptop/projector display — QR, roster, scores, reveal
  player.html          Phone client — all screens
  css/style.css        Design system
  js/tetris.js         Tetris engine, heat-damaged block rendering
  js/motion.js         Sensor permissions, filtering, gesture detection
  js/quizmode.js       Quiz UI and two-axis tilt answering
  js/avatars.js        The 10 pixel-art animals, as scalable SVG
  js/jetparts.js       Pixel jets — one silhouette coloured by your loadout
  js/dogfightclient.js Hangar, cockpit HUD and flight controls
  js/player.js         Phone client state machine
```

---

## Known rough edges

- **Compass indoors is unreliable** near metal and electronics. The tap-a-name
  fallback in the aim screen exists for exactly this; don't cut it.
- **Hot Hands is charge-based, not timed** (2 pieces, not 5 seconds) because at a
  5-second window it often expired before a piece arrived and did nothing.
- The server holds **one room**. Fine for a demo. If you want concurrent games,
  key `GAME` by room code and look it up on join.
- Phones that lock mid-game reconnect and keep their identity, but their board
  resets. Tell people to turn auto-lock off.

---

## Demo script (90 seconds)

1. Projector shows the QR. Four judges scan it. *(This is the hook — no install.)*
2. All four phones ring at once. Everyone answers. "You are THE IMPOSTER."
3. Round starts. Show someone tilting to move, twisting to rotate.
4. Flick a piece at a judge. Their phone buzzes and flashes red.
5. Hit a Hot Hands draw on camera — forced to dump on someone.
6. Cut to the vote: everyone points. The reveal screen shows who was who.
