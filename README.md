# SCRAMBLE

A retro arcade party game for 3–12 players in one room. Everyone plays on their phone; one laptop or TV is the big screen.

**Earn jet parts → vote on the biggest threat → dogfight with the jet you built.**

## Getting in

1. One person opens the site and hits **HOST GAME** on the big screen.
2. Everyone else scans the QR code or enters the 4-letter room code. No app needed.
3. The host picks a mode, adds bots if the table is short, and hits **START**.

## Modes

**TRIVIA**: AI-generated questions on any topic (Easy / Medium / Hard).

**STUDY**: Upload a lecture PDF and the AI writes questions from it. Set the class's comfort level: **Shaky** gets easier recall questions, **Steady** a mix, **Confident** harder application questions.

**ARCADE**: No questions. Climb a ladder of 5-second tilt games: Ring Run, Missile Dodge, Canyon Run, Lock-On and Supply Drop. Clear a level to earn a part; each level is harder and pays rarer parts. Miss and you drop a level.

## During a round

- **Tap** to answer. **Shake** to reroll a question (2 per round).
- **Slide** the phone left or right to pass a question you don't know. Passed questions get hotter and pay out better parts.
- **Rotate** the phone about 50° to install a part you've won.
- **Any 3 right answers** load a missile. **Push the phone forward** to fire it at a random pilot, who has to tilt to dodge a barrage or lose their best part.
- **3 wrong in a row** drops you into a ring run.
- Won a part that isn't an upgrade? It arrives as a ticking crate: **KEEP IT** or **pass it** to a neighbour, and it goes up a tier on the way.

## Your jet

Five bays (engine, guns, missiles, wings, armor) and five tiers, from Common to Legendary. Better parts make a faster, tougher, deadlier jet.

## The finale

1. **Discuss**: argue about who's the most dangerous.
2. **Threat vote**: the marked pilot gets an afterburner and a 3× bounty on their head.
3. **Dogfight**: bank the phone to steer, tilt forward and back for throttle, and hold **FIRE**.

Everyone also has a **secret agenda** (Magpie, Duelist, Scavenger and others) that pays bonus points and makes them act a little suspicious.

## Winning

**Final score = quiz or arcade points + dogfight score + agenda bonus.** The top three take the podium on the big screen, and everyone's agenda is revealed.

## Running it

```
pip install -r requirements.txt
python server.py
```

Put `XAI_API_KEY` and/or `GEMINI_API_KEY` in `.env` for Trivia and Study (Arcade needs no key). iPhones need HTTPS for motion controls, so use `START-TUNNEL.bat` or deploy to Render.
