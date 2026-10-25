"""Live WebSocket integration checks for SCRAMBLE navigation."""
import asyncio
import json
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path

import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]


async def recv_type(ws, kind, timeout=4):
    end = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < end:
        msg = json.loads(await asyncio.wait_for(ws.recv(), end - asyncio.get_running_loop().time()))
        if msg.get('t') == kind:
            return msg
    raise AssertionError('missing event ' + kind)


class NavigationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        s = socket.socket(); s.bind(('127.0.0.1', 0)); self.port = s.getsockname()[1]; s.close()
        self.proc = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', str(self.port)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.http = httpx.AsyncClient(base_url=f'http://127.0.0.1:{self.port}')
        for _ in range(80):
            try:
                if (await self.http.get('/api/health')).status_code == 200:
                    break
            except (httpx.ConnectError, httpx.ReadError):
                pass
            await asyncio.sleep(.1)
        else:
            self.fail('server did not start')
        self.code = (await self.http.post('/api/room')).json()['code']
        self.sockets = []

    async def asyncTearDown(self):
        for ws in self.sockets:
            await ws.close()
        await self.http.aclose()
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    async def ws(self, message):
        w = await websockets.connect(f'ws://127.0.0.1:{self.port}/ws')
        self.sockets.append(w)
        await w.send(json.dumps(message))
        return w

    async def test_host_countdown_and_cancel_preserves_players(self):
        host = await self.ws({'t':'host_watch','code':self.code})
        players = [await self.ws({'t':'join','code':self.code,'name':f'P{i}'}) for i in range(3)]
        identities = [await recv_type(w,'joined') for w in players]
        await host.send(json.dumps({'t':'start'}))
        await recv_type(host,'countdown')
        for w in players:
            await recv_type(w,'countdown')
        self.assertEqual((await self.http.get(f'/api/room/{self.code}')).json()['phase'],'countdown')
        await host.send(json.dumps({'t':'return_lobby'}))
        await recv_type(host,'to_lobby')
        for w in players:
            await recv_type(w,'to_lobby')
        state = (await self.http.get(f'/api/room/{self.code}')).json()
        self.assertEqual(state['phase'], 'lobby')
        self.assertEqual(state['players'], 3)
        self.assertTrue(all(w.state.name == 'OPEN' for w in players))
        self.assertEqual(len(set(x['pid'] for x in identities)),3)
        await asyncio.sleep(.4)
        self.assertEqual((await self.http.get(f'/api/room/{self.code}')).json()['phase'],'lobby')

    async def test_nonhost_cannot_reset_everyone(self):
        host = await self.ws({'t':'host_watch','code':self.code})
        players = [await self.ws({'t':'join','code':self.code,'name':f'P{i}'}) for i in range(3)]
        for w in players:
            await recv_type(w,'joined')
        await players[0].send(json.dumps({'t':'start'}))
        await asyncio.sleep(.1)
        self.assertEqual((await self.http.get(f'/api/room/{self.code}')).json()['phase'],'lobby')
        await host.send(json.dumps({'t':'start'}))
        await recv_type(host,'countdown')
        await players[0].send(json.dumps({'t':'reset'}))
        err = await recv_type(players[0],'error')
        self.assertEqual(err['reason'], 'HOST ONLY')
        await players[0].send(json.dumps({'t':'return_lobby'}))
        await recv_type(players[0], 'lobby_view')
        self.assertEqual((await self.http.get(f'/api/room/{self.code}')).json()['phase'],'countdown')
        await host.send(json.dumps({'t':'reset'}))
        await recv_type(host,'to_lobby')
        self.assertEqual((await self.http.get(f'/api/room/{self.code}')).json()['phase'],'lobby')

    async def test_routes_exist(self):
        for url in ('/','/host','/play','/rules','/static/js/navigation.js','/static/js/room.js','/static/css/style.css'):
            resp=await self.http.get(url)
            self.assertEqual(resp.status_code,200,url)
