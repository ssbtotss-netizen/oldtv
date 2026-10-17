// old.tv — client
(() => {
  const $ = (id) => document.getElementById(id);

  const C = window.OLDTV_COUNTRIES;
  const countryName = (c) => (c && c !== 'any' ? C.name(c) : 'مكان ما');

  const opt = ([v, n]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = n;
    return o;
  };
  const group = (label, list) => {
    const g = document.createElement('optgroup');
    g.label = label;
    list.forEach((x) => g.appendChild(opt(x)));
    return g;
  };
  document.querySelectorAll('select.countries').forEach((sel) => {
    if (sel.dataset.any) sel.appendChild(opt(['any', 'كل الدول']));
    sel.appendChild(group('الدول العربية', C.arab));
    sel.appendChild(group('دول العالم', C.others));
  });

  // ---------- VIP ----------
  const VIP_KEY = 'oldtv_vip';
  const store = {
    get() { try { return localStorage.getItem(VIP_KEY); } catch (_) { return null; } },
    del() { try { localStorage.removeItem(VIP_KEY); } catch (_) {} }
  };
  let vipToken = store.get();
  let isVip = false;

  function applyVip(on) {
    isVip = on;
    $('vipBadge').hidden = !on;
    $('vipLink').hidden = on;
    $('vipPromo').hidden = on;
    document.querySelectorAll('[data-vip-only]').forEach((el) => {
      el.disabled = !on;
      if (!on) el.value = 'any';
    });
    document.querySelectorAll('[data-vip-lock]').forEach((el) => { el.hidden = on; });
  }
  applyVip(false);
  if (vipToken) {
    fetch('/api/vip/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: vipToken })
    }).then((r) => r.json()).then((d) => {
      if (d.vip) applyVip(true); else { store.del(); vipToken = null; }
    }).catch(() => {});
  }
  // Clicking a locked filter sends the visitor to the VIP page
  document.querySelectorAll('[data-vip-only]').forEach((el) => {
    el.parentElement.addEventListener('click', () => { if (!isVip) location.href = '/vip.html'; });
  });

  // ---------- state ----------
  const socket = io();
  let localStream = null;
  let pc = null;
  let pendingCandidates = [];
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let prefs = null;
  let connected = false;

  fetch('/config').then((r) => r.json()).then((c) => {
    iceServers = c.iceServers;
    if (c.vip && c.vip.priceLabel) $('vipPrice').textContent = c.vip.priceLabel;
  }).catch(() => {});

  // ---------- home ----------
  const adult = $('adult');
  adult.addEventListener('change', () => { $('startBtn').disabled = !adult.checked; });

  async function getCamera() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    $('preview').srcObject = localStream;
    $('local').srcObject = localStream;
    $('previewPh').hidden = true;
    return localStream;
  }

  $('startForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('homeErr').textContent = '';
    if (!adult.checked) return;
    try {
      await getCamera();
    } catch (err) {
      $('homeErr').textContent = 'ما قدرنا نشغّل الكاميرا. اسمح للمتصفح يستخدم الكاميرا والمايك وحاول مرة ثانية.';
      return;
    }
    prefs = {
      adult: true,
      gender: $('gender').value,
      country: $('country').value,
      want: isVip ? $('want').value : 'any',
      wantCountry: isVip ? $('wantCountry').value : 'any',
      vipToken: vipToken || undefined
    };
    $('home').hidden = true;
    $('chat').hidden = false;
    find();
  });

  // ---------- chat UI ----------
  function setSearching() {
    connected = false;
    $('remotePh').hidden = false;
    $('remotePh').textContent = 'نبحث لك عن أحد…';
    $('remoteCountry').hidden = true;
    $('remoteVip').hidden = true;
    $('remote').srcObject = null;
    $('reportBtn').disabled = true;
    $('msg').disabled = true;
    $('sendBtn').disabled = true;
    $('messages').innerHTML = '';
  }

  function addMsg(text, who) {
    const d = document.createElement('div');
    d.className = 'msg ' + who;
    d.textContent = text;                // textContent: never render HTML from strangers
    $('messages').appendChild(d);
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  function notice(text) {
    const n = $('notice');
    n.textContent = text;
    n.hidden = false;
    clearTimeout(notice.t);
    notice.t = setTimeout(() => { n.hidden = true; }, 4000);
  }

  function find() {
    closePeer();
    setSearching();
    socket.emit('find', prefs);
  }

  $('nextBtn').addEventListener('click', find);

  $('stopBtn').addEventListener('click', () => {
    socket.emit('stop');
    closePeer();
    setSearching();
    $('chat').hidden = true;
    $('home').hidden = false;
  });

  $('reportBtn').addEventListener('click', () => {
    if (!connected) return;
    socket.emit('report', 'inappropriate');
    notice('وصلنا بلاغك، وبنراجعه. نقلناك لشخص جديد.');
    find();
  });

  $('micBtn').addEventListener('click', (e) => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    e.currentTarget.setAttribute('aria-pressed', String(!t.enabled));
  });

  $('camBtn').addEventListener('click', (e) => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    e.currentTarget.setAttribute('aria-pressed', String(!t.enabled));
  });

  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('msg').value.trim();
    if (!text || !connected) return;
    socket.emit('chat', text);
    addMsg(text, 'me');
    $('msg').value = '';
  });

  // ---------- WebRTC ----------
  function closePeer() {
    if (pc) {
      pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
    pendingCandidates = [];
  }

  function createPeer() {
    closePeer();
    pc = new RTCPeerConnection({ iceServers });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    pc.ontrack = (ev) => {
      $('remote').srcObject = ev.streams[0];
      $('remotePh').hidden = true;
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit('signal', { candidate: ev.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc && pc.connectionState === 'failed') {
        addMsg('تعذّر الاتصال بالفيديو، جرّب «التالي».', 'sys');
      }
    };
  }

  async function flushCandidates() {
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(c); } catch (_) {}
    }
    pendingCandidates = [];
  }

  socket.on('matched', async ({ initiator, country, vip }) => {
    connected = true;
    createPeer();
    $('remoteVip').hidden = !vip;
    $('remotePh').textContent = 'جاري الاتصال…';
    $('remoteCountry').textContent = countryName(country);
    $('remoteCountry').hidden = false;
    $('reportBtn').disabled = false;
    $('msg').disabled = false;
    $('sendBtn').disabled = false;
    addMsg('تم توصيلك بشخص من ' + countryName(country), 'sys');
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { sdp: pc.localDescription });
    }
  });

  socket.on('signal', async (data) => {
    if (!pc) return;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        await flushCandidates();
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pendingCandidates.push(data.candidate);
      }
    } catch (err) {
      console.warn('signal error', err);
    }
  });

  socket.on('vip-status', (on) => {
    if (!on && vipToken) { store.del(); vipToken = null; }
    applyVip(Boolean(on));
  });

  socket.on('chat', (text) => addMsg(String(text), 'them'));

  socket.on('partner-left', () => {
    addMsg('الطرف الآخر طلع. نبحث لك عن شخص جديد…', 'sys');
    setTimeout(find, 800);
  });

  socket.on('waiting', () => { $('remotePh').textContent = 'نبحث لك عن أحد…'; });
  socket.on('online', (n) => { $('online').textContent = n; });
  socket.on('error-msg', (m) => notice(m));
  socket.on('banned', ({ hours }) => {
    closePeer();
    document.body.innerHTML =
      '<main style="padding:48px;text-align:center"><h1>تم إيقاف حسابك مؤقتاً</h1>' +
      '<p>بسبب بلاغات متكررة. تقدر ترجع بعد ' + Number(hours) + ' ساعة.</p></main>';
  });
})();
