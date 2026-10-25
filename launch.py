#!/usr/bin/env python3
"""
launch.py — one-click startup for MERGE CONFLICT AT MACH 2.

Handles everything the manual steps did:
  * installs missing dependencies
  * optionally opens a public HTTPS tunnel (needed for iPhone motion sensors)
  * starts the server
  * opens the host display in your browser

Usage:
    python launch.py              # local Wi-Fi only
    python launch.py --tunnel     # public HTTPS via cloudflared
    python launch.py --no-browser # don't auto-open the display
"""

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8000
TUNNEL_RE = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")


def say(msg=""):
    print(msg, flush=True)


def rule():
    say("=" * 58)


def pause():
    """Keep the window open so a double-clicked launcher shows its error."""
    try:
        input("  Press Enter to close...")
    except (EOFError, KeyboardInterrupt):
        pass


# ---------------------------------------------------------------- deps
def ensure_deps():
    try:
        import fastapi, uvicorn, qrcode  # noqa: F401
        return
    except ImportError:
        pass

    say("  Installing dependencies (first run only)...")
    req = os.path.join(HERE, "requirements.txt")
    cmd = [sys.executable, "-m", "pip", "install", "--quiet", "-r", req]
    try:
        subprocess.check_call(cmd)
    except subprocess.CalledProcessError:
        say("  [X] Dependency install failed.")
        say("      Try manually:  pip install -r requirements.txt")
        pause()
        sys.exit(1)

    try:
        import fastapi, uvicorn, qrcode  # noqa: F401
    except ImportError:
        say("  [X] Dependencies still missing after install.")
        sys.exit(1)
    say("  Dependencies ready.")


# ---------------------------------------------------------------- tunnel
def find_cloudflared():
    exe = shutil.which("cloudflared")
    if exe:
        return exe
    # common winget / manual install locations
    for p in [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe"),
        os.path.expandvars(r"%ProgramFiles%\cloudflared\cloudflared.exe"),
        os.path.join(HERE, "cloudflared.exe"),
    ]:
        if os.path.isfile(p):
            return p
    return None


def start_tunnel(timeout=40):
    """Start cloudflared and return its public https URL, or None."""
    exe = find_cloudflared()
    if not exe:
        say("  [!] cloudflared not found — skipping tunnel.")
        say("      Install it with:  winget install --id Cloudflare.cloudflared")
        say("      Without it, iPhones cannot use motion controls.")
        return None

    say("  Opening public HTTPS tunnel...")
    proc = subprocess.Popen(
        [exe, "tunnel", "--url", f"http://localhost:{PORT}"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )

    url = {"v": None}

    def read():
        for line in proc.stdout:
            m = TUNNEL_RE.search(line)
            if m and not url["v"]:
                url["v"] = m.group(0)

    threading.Thread(target=read, daemon=True).start()

    deadline = time.time() + timeout
    while time.time() < deadline and not url["v"]:
        if proc.poll() is not None:
            say("  [!] cloudflared exited early — continuing without a tunnel.")
            return None
        time.sleep(0.3)

    if not url["v"]:
        say("  [!] Tunnel did not come up in time — continuing on local Wi-Fi.")
        try:
            proc.terminate()
        except Exception:
            pass
        return None

    say(f"  Tunnel ready: {url['v']}")
    return url["v"]


# ---------------------------------------------------------------- net
def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tunnel", action="store_true",
                    help="open a public HTTPS tunnel (needed for iPhones)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    os.chdir(HERE)
    rule()
    say("  MERGE CONFLICT AT MACH 2 — starting up")
    rule()

    if port_in_use(PORT):
        say(f"  [X] Port {PORT} is already in use.")
        say("      Another copy of the game is probably still running.")
        say("      Close that window and try again.")
        rule()
        pause()
        sys.exit(1)

    ensure_deps()

    public = None
    if args.tunnel:
        public = start_tunnel()
    if public:
        os.environ["PUBLIC_URL"] = public

    import uvicorn
    import server  # imported AFTER the env var is set

    host_url = f"http://localhost:{PORT}"
    join_url = server.PUBLIC_URL["url"] + "/play"

    rule()
    say(f"  HOST DISPLAY  ->  {host_url}")
    say(f"  PHONES JOIN   ->  {join_url}")
    say(f"  ROOM CODE     ->  {server.GAME.code}")
    rule()
    if join_url.startswith("https://"):
        say("  HTTPS tunnel active — motion works on iPhones.")
    else:
        say(f"  Local network only (this PC is {lan_ip()}).")
        say("  Phones must be on the SAME Wi-Fi, and iPhones will NOT")
        say("  have motion controls. Run START-TUNNEL for that.")
    say("")
    say("  Open the link, hit HOST GAME, then scan the QR.")
    say("  Close this window to stop the game.")
    rule()

    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(host_url)).start()

    try:
        uvicorn.run(server.app, host="0.0.0.0", port=PORT, log_level="warning")
    except KeyboardInterrupt:
        pass
    say("\n  Server stopped.")


if __name__ == "__main__":
    main()
