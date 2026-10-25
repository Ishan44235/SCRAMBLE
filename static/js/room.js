(function(){
  const host=document.body.dataset.role==='host';
  const params=new URLSearchParams(location.search);
  const code=(params.get('code')||sessionStorage.getItem(host?'scramble_host_code':'scramble_player_code')||'').toUpperCase();
  const status=document.getElementById('status'), roster=document.getElementById('roster'), phaseEl=document.getElementById('phase');
  let socket,phase='lobby', localLobby=false, timer=null, exitPending=false, connected=false;
  const send=o=>{if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(o));return true}return false};
  function clear(){if(timer!==null){clearInterval(timer);timer=null}document.getElementById('countdown')?.replaceChildren()}
  function showLobby(){localLobby=true;clear();document.getElementById('game')?.classList.add('hidden');document.getElementById('lobby')?.classList.remove('hidden');phaseEl.textContent='LOBBY';window.ScrambleNavigation.reset();exitPending=false}
  function showPhase(){if(localLobby)return;const playing=phase!=='lobby'&&phase!=='results';document.getElementById('game')?.classList.toggle('hidden',!playing);document.getElementById('lobby')?.classList.toggle('hidden',playing);phaseEl.textContent=phase.toUpperCase()}
  function updateRoster(players){roster.replaceChildren();players.forEach(p=>{const li=document.createElement('li');li.textContent=`${p.name} — ${p.connected?'CONNECTED':'DISCONNECTED'}${p.inLobby?' (in lobby)':''}`;roster.appendChild(li)})}
  function countdown(endsAt){clear();function tick(){const sec=Math.max(0,Math.ceil(endsAt-Date.now()/1000));const node=document.getElementById('countdown');if(node)node.textContent=sec?String(sec):'GO!';if(!sec)clearInterval(timer)}tick();timer=setInterval(tick,150)}
  function onMessage(m){if(m.t==='joined'){sessionStorage.setItem('scramble_player_pid',m.pid);sessionStorage.setItem('scramble_player_code',m.code)}
    if(m.t==='state'){phase=m.phase;updateRoster(m.players||[]);if(!localLobby||phase==='lobby'){localLobby=phase==='lobby';showPhase()}if(phase==='lobby')showLobby()}
    if(m.t==='countdown'&&!localLobby){phase='countdown';showPhase();countdown(m.endsAt)}
    if(m.t==='countdown_go'){clear();if(!localLobby){const c=document.getElementById('countdown');if(c)c.textContent='GO!'}}
    if(m.t==='lobby_view'){showLobby();updateRoster(m.players||[]);status.textContent=m.phase==='lobby'?'Room connected':`Room connected — match currently ${m.phase}`}
    if(m.t==='to_lobby'){phase='lobby';showLobby();status.textContent='Match ended. Room connected.'}
    if(m.t==='join_error'||m.t==='error'){status.textContent=m.reason;window.ScrambleNavigation.reset();exitPending=false}
    if(m.t==='fight_me'&&!localLobby){document.getElementById('game-info').textContent=`AIRCRAFT HP ${m.me.hp} | MISSILES ${m.me.missiles} | ${m.left}s`;}
    if(m.t==='question'&&!localLobby){document.getElementById('game-info').textContent=m.q;const opts=document.getElementById('options');opts.replaceChildren();m.options.forEach((choice,i)=>{let b=document.createElement('button');b.textContent=choice;b.onclick=()=>{send({t:'quiz_answer',choice:i,inst:m.inst});opts.replaceChildren()};opts.appendChild(b)})}
  }
  function connect(){if(!code){status.textContent='No room code. Return home and create or join a room.';return}status.textContent=`Connecting to ${code}...`;socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);socket.onopen=()=>{connected=true;status.textContent=`Connected to room ${code}`;if(host)send({t:'host_watch',code});else send({t:'join',code,pid:sessionStorage.getItem('scramble_player_pid'),name:sessionStorage.getItem('scramble_player_name')||'PILOT',avatar:'fox'})};socket.onmessage=e=>{try{onMessage(JSON.parse(e.data))}catch(err){console.error(err)}};socket.onclose=()=>{connected=false;clear();status.textContent='Disconnected. Reconnecting...';setTimeout(connect,1500)}}
  window.scrambleActive=()=>phase!=='lobby'&&phase!=='results'&&!localLobby;
  window.scrambleInRoom=()=>Boolean(code);
  window.scrambleReturn=()=>{if(exitPending)return;exitPending=true;clear();if(!connected){exitPending=false;window.ScrambleNavigation.reset();status.textContent='Connection unavailable; retry after reconnecting.';return}if(!send({t:'return_lobby'})){exitPending=false;window.ScrambleNavigation.reset()}};
  document.getElementById('start')?.addEventListener('click',()=>{localLobby=false;send({t:'start',settings:{}})});
  document.getElementById('cancel-match')?.addEventListener('click',()=>window.ScrambleNavigation.lobby());
  document.getElementById('fire-missile')?.addEventListener('click',()=>send({t:'missile'}));
  document.getElementById('go-home')?.addEventListener('click',()=>location.assign('/'));
  document.getElementById('room-code').textContent=code||'----';
  connect();
})();
