# SCRAMBLE navigation verification — 2026-10-25

## Scope
The provided Python backend and available `static/` frontend files were audited and updated for section 14 (Lobby navigation and aircraft-logo exit). The original full-featured frontend files described in README (pixel art, motion, gameplay overlays) were **not** present in the uploaded material. The included static pages provide limited lobby/countdown/quiz UI, not proof that the original full game UI has been preserved.

## Changes
- `server.py`: only host-display connections can issue `start` and `reset`/room-wide `return_lobby`; returning as an ordinary player instead opts that player out of ongoing play while retaining their WebSocket and room membership. Reset cancels the match task, stops the dogfight, empties projectiles, clears transient match states and broadcasts updated lobby state. Adds an explicit five-second server countdown and guards against starting duplicate matches. Removes duplicate `/rules` route.
- `static/js/navigation.js`: clickable full-size logo and lobby controls; match-exit confirmation with Cancel and Return to Lobby; duplicate-action guard. Non-gameplay logo navigation goes home without a room reset.
- `static/js/room.js`: WebSocket navigation events, visible connected roster, countdown updates, local-lobby state; gameplay messages are ignored after a local exit, and reconnect warnings are surfaced.
- `static/*.html`, `static/css/style.css`: functional minimal host, pilot, home, rules screens with accessible logo, hover/touch press states, confirmation dialog and appropriately sized buttons.
- `tests/test_navigation.py`: end-to-end server WebSocket integration tests.

## Actually executed
`python -m py_compile server.py dogfight.py launch.py parts.py quiz.py` — PASS
`node --check static/js/navigation.js` — PASS
`node --check static/js/room.js` — PASS
`python -m unittest discover -s tests -v` — PASS (3 tests):
1. Host starts countdown; multiple client sockets receive countdown; host cancels; everyone receives lobby event; player connections remain in the room.
2. Ordinary player cannot start game or reset entire room; local exit leaves ongoing countdown untouched; host reset succeeds.
3. All available core HTML and JS/CSS routes return HTTP 200.

## Not verified / limitations
- No real desktop or mobile browser was available for clicking the logo and every button. CSS/touch interactions, confirmation Cancel leaving actual gameplay uninterrupted, iOS Safari behavior, and real sensor lifecycle remain unverified.
- No actual missile/obstacle challenge, results-screen, or full aircraft-building UI interaction was verified. This archive does not contain the original full gameplay frontend described in the README; current `static/` UI is intentionally minimal and does not implement all its advertised features.
- A non-host exiting a match stays connected and is marked in the lobby but cannot participate again until the next room-wide reset. Other gameplay event broadcasts may continue over their socket, although the local UI ignores gameplay while exited.
- Host authorization is based on establishing a `host_watch` WebSocket, with no host credential. A malicious client that knows a room code could impersonate a host. Production deployment requires host authentication before this feature can be considered secure.
- Rooms are in process memory and are lost on server restart, as before.

## Start / deploy
`pip install -r requirements.txt` then `python server.py`. Keep Render configuration unchanged (`render.yaml`, one worker). The domain `mergeconflictatmach2.study` is unchanged.
