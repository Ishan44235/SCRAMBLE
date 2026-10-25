# MERGE CONFLICT AT MACH 2

A retro pixel-art arcade party game for phones in one room.

**Answer trivia → build a fighter jet → dogfight with what you earned.**
Everyone has a secret agenda. Before the fight, the table marks one pilot as
**the Threat**, who flies with a 3× bounty on their head and an afterburner to
survive it.

No app install — players scan a QR code or type a 4-letter room code.

---

## Running it locally

```bash
pip install -r requirements.txt
python server.py
```

Open the printed address. You'll get the arcade home screen:

- **HOST GAME** creates a room and puts the big screen up (QR + room code)
- **JOIN GAME** asks for the 4-letter code

Several groups can play at once — each room is completely independent.

**Testing alone:** click **SOLO TEST** on the host display. It fills the room
with stand-in pilots who pass questions at you and fly in the dogfight.

---

## Deploying to Render

The game is a stateful WebSocket server, so static hosts (Netlify, GitHub
Pages, Vercel's static tier) **cannot** run it. Render works well.

### 1. Push to GitHub

```bash
git init && git add -A
git commit -m "Merge Conflict at Mach 2"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Create the service

In Render: **New → Web Service → connect your repo.** `render.yaml` is
included, so Render will offer to use it. If you'd rather fill the form in by
hand:

| Field | Value |
|---|---|
| Runtime | Python 3 |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn server:app --host 0.0.0.0 --port $PORT --workers 1` |
| Health check path | `/api/health` |

**Keep it to one worker.** Rooms are held in memory, so a second worker would
put players in a different copy of the room from the host and the game would
silently break.

Free instances sleep after ~15 minutes idle and take ~50 seconds to wake. For a
demo, use the Starter plan or hit the URL a minute before you present.

### 3. Point the domain at it

In **Render → your service → Settings → Custom Domains**, add both
`mergeconflictatmach2.study` and `www.mergeconflictatmach2.study`. Render shows
you the DNS records it wants.

Then in **Porkbun → your domain → DNS**:

| Type | Host | Value |
|---|---|---|
| ALIAS (or CNAME) | *blank / @* | the `...onrender.com` hostname Render gave you |
| CNAME | `www` | the same `...onrender.com` hostname |

Porkbun supports ALIAS on the root, which is what you want — a root CNAME is
not valid DNS. Delete Porkbun's default parking records first or they'll
conflict.

DNS usually propagates in minutes; Render issues the TLS certificate
automatically once it resolves.

### 4. Nothing else to configure

QR codes and join links are built from the incoming request (honouring
`X-Forwarded-Host`/`X-Forwarded-Proto`), so they point at your real domain with
no env vars set. If you ever want to force it, set `PUBLIC_URL` to
`https://mergeconflictatmach2.study`.

**HTTPS matters here beyond the padlock:** iOS refuses motion sensor access on
plain HTTP, so tilt controls only work once the site is served over HTTPS.
Deploying to Render fixes that for free.

---

## The game

### 1. Quiz — build the jet

A question lands on your phone with a timer. **Tilt toward an answer, twist to
lock it in.** If you don't know it, **flick the phone at someone** to dump it
on them.

Each pass makes the question *hotter*: the clock shrinks and the payout
multiplies. Hot questions drop rarer parts, so the question nobody wanted is
the one worth taking.

Every correct answer earns a part for one of five bays — **engine, guns,
missiles, wings, armor** — in five rarity tiers:

`COMMON` → `UNCOMMON` → `RARE` → `EPIC` → `LEGENDARY`

A better part upgrades the bay. Your jet is drawn live above the question and
changes colour as you fit things.

### 2. Cards — every 20 seconds

**Powers:** Mystery Crate (sealed, opens in the hangar), Fifty-Fifty, Tailwind
(next correct answer drops as if red hot), Deflector.

**Handicaps:** Rust (corrodes your best part a tier), Locked Bay, Hot Hands,
Blind Spot.

### 3. The Threat Vote

Not a whodunnit — a targeting decision. Everyone marks the pilot they think is
most dangerous. The marked pilot gets a **3× bounty** on them, and an
**afterburner** to survive it. Guessing right earns you nothing; it just paints
a target.

### 4. Dogfight

Bank the phone to turn, pitch forward for throttle, hold **GUNS**, tap
**MISSILE**. All jets fly on one screen.

---

## Secret agendas

Everyone draws one. Nobody is a traitor — each agenda pushes you toward
behaviour that looks suspicious for a *different* reason.

| Agenda | Also known as | Wins by |
|---|---|---|
| **Magpie** | The Shiny Thief | Finishing with the rarest single part at the table |
| **Duelist** | The Dogfight Ace | Shooting down one secret rival, repeatedly |
| **Scavenger** | The Scrap Baron | Tearing parts off jets they down, mid-fight |
| **Mechanic** | The Grease Wizard | Forcing a part swap in discussion and coming out ahead |
| **Inspector** | The Parts Inspector | Strip-inspecting the pilot the table ends up marking |
| **Quartermaster** | The Supply Line | Parts fitted by pilots they passed questions to |
| **Featherweight** | The Bare Airframe | Finishing with 3 bays or fewer |

Final score = dogfight score + agenda bonus. Agendas reveal at the end, which
is when everyone finds out why you kept dumping questions on them.

---

## Your own questions

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

`answer` is the index of the correct option. Options are shuffled per player
per question at runtime, so keeping the answer at index 0 throughout the file
gives nothing away.

**The answer key never leaves the server.** Players receive the question text
and shuffled options only; correctness is decided server-side on commit.
Opening devtools tells you nothing.

---

## Files

```
server.py            Rooms, match state machine, agendas, Threat Vote
quiz.py              Question engine — dealing, scoring, heat, queueing
parts.py             Jet loadout — 5 bays x 5 tiers, drops, rust, scavenging
dogfight.py          30 Hz flight sim — jets, bullets, homing missiles
questions.json       The question deck. Edit this.
render.yaml          Render deployment config
launch.py            Local one-click startup (deps, tunnel, browser)
START.bat            Windows launcher — local Wi-Fi
START-TUNNEL.bat     Windows launcher — public HTTPS tunnel
static/
  index.html         Arcade home screen — HOST / JOIN
  host.html          Big screen — QR, lobby, scores, arena, reveal
  player.html        Phone client
  css/style.css      Design system
  js/skyfield.js     Animated pixel sky — jets, contrails, tracers, clouds
  js/quizmode.js     Quiz UI and two-axis tilt answering
  js/jetparts.js     Pixel jets, coloured by your loadout
  js/dogfightclient.js  Hangar, cockpit HUD, flight controls
  js/avatars.js      10 pixel-art animal avatars
  js/motion.js       Sensor permissions, filtering, gesture detection
  js/player.js       Phone client state machine
```

---

## Known rough edges

- **Rooms live in memory.** Restarting the server drops every room. Fine for a
  demo; a real deployment would want Redis.
- **Compass passing is unreliable indoors.** The aim screen has a tap-a-name
  fallback for exactly this — don't remove it.
- **Free Render instances sleep.** First visitor waits ~50 seconds.
- Phones that lock mid-game reconnect and keep their pilot, but miss whatever
  happened while the screen was off.
