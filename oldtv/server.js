// old.tv — signaling + matchmaking + VIP server
// Video/audio go peer-to-peer (WebRTC). This server matches users, relays
// connection setup messages and text chat, handles reports/bans, and VIP.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const REPORTS_TO_BAN = Number(process.env.REPORTS_TO_BAN || 3);
const BAN_HOURS = Number(process.env.BAN_HOURS || 24);

// ---- VIP settings ----
const VIP_AMOUNT = Number(process.env.VIP_AMOUNT || 3750);        // smallest unit: 3750 halalas = 37.50 SAR ≈ $10
const VIP_CURRENCY = process.env.VIP_CURRENCY || 'SAR';
const VIP_DAYS = Number(process.env.VIP_DAYS || 30);
const VIP_PRICE_LABEL = process.env.VIP_PRICE_LABEL || '10$ (37.50 ريال)';
const MOYASAR_PUBLISHABLE_KEY = process.env.MOYASAR_PUBLISHABLE_KEY || '';
const MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY || '';
const VIP_SECRET = process.env.VIP_SECRET || '';
if (!VIP_SECRET) console.warn('[warn] VIP_SECRET is not set — VIP is disabled until you set it.');

// Paid payments we already turned into VIP time (so one payment = one month only).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
let payments = {};
try { payments = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8')); } catch (_) {}
const savePayments = () => fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments));

// VIP token = base64url(payload).signature  — payload: { pid, exp }
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', VIP_SECRET).update(data).digest('base64url');
function makeToken(pid, exp) {
  const body = b64(JSON.stringify({ pid, exp }));
  return body + '.' + sign(body);
}
function readToken(token) {
  if (!VIP_SECRET || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (_) { return null; }
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Client config: ICE servers (WebRTC) + VIP price/payment key
app.get('/config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(','),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS
    });
  }
  res.json({
    iceServers,
    vip: {
      enabled: Boolean(VIP_SECRET && MOYASAR_PUBLISHABLE_KEY && MOYASAR_SECRET_KEY),
      demo: process.env.DEMO_VIP === '1' && Boolean(VIP_SECRET),
      amount: VIP_AMOUNT,
      currency: VIP_CURRENCY,
      days: VIP_DAYS,
      priceLabel: VIP_PRICE_LABEL,
      publishableKey: MOYASAR_PUBLISHABLE_KEY
    }
  });
});

// After paying, Moyasar redirects the buyer to /vip-done.html?id=<payment id>.
// That page calls this endpoint; we verify the payment with Moyasar's API.
app.post('/api/vip/claim', async (req, res) => {
  const id = String(req.body.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'رقم العملية غير صحيح' });
  if (!VIP_SECRET || !MOYASAR_SECRET_KEY) return res.status(503).json({ error: 'الاشتراك غير مفعّل حالياً' });

  // Already claimed? Return the same token (refreshing the page is safe).
  if (payments[id]) return res.json({ token: makeToken(id, payments[id]), exp: payments[id] });

  try {
    const r = await fetch('https://api.moyasar.com/v1/payments/' + encodeURIComponent(id), {
      headers: { Authorization: 'Basic ' + Buffer.from(MOYASAR_SECRET_KEY + ':').toString('base64') }
    });
    if (!r.ok) return res.status(400).json({ error: 'ما لقينا العملية' });
    const p = await r.json();
    if (p.status !== 'paid' || p.amount !== VIP_AMOUNT || p.currency !== VIP_CURRENCY) {
      return res.status(402).json({ error: 'الدفع ما اكتمل' });
    }
    // Renewal: add the month on top of any VIP time the buyer still has.
    const current = readToken(req.body.prevToken);
    const start = Math.max(Date.now(), current ? current.exp : 0);
    const exp = start + VIP_DAYS * 24 * 3600 * 1000;
    payments[id] = exp;
    savePayments();
    console.log(`[vip] payment ${id} -> VIP until ${new Date(exp).toISOString()}`);
    res.json({ token: makeToken(id, exp), exp });
  } catch (err) {
    console.error('[vip] verify failed', err);
    res.status(502).json({ error: 'صار خطأ أثناء التحقق، حاول بعد شوي' });
  }
});

// TEST MODE ONLY: DEMO_VIP=1 lets anyone get 1 day of VIP for free (for trying the site).
// Never set DEMO_VIP on the real public site.
const DEMO_VIP = process.env.DEMO_VIP === '1' && Boolean(VIP_SECRET);
if (DEMO_VIP) console.warn('[warn] DEMO_VIP is ON — free test VIP is available. Turn it off before launch.');
app.post('/api/vip/demo', (req, res) => {
  if (!DEMO_VIP) return res.status(404).json({ error: 'غير متاح' });
  const exp = Date.now() + 24 * 3600 * 1000;
  res.json({ token: makeToken('demo-' + crypto.randomUUID(), exp), exp });
});

app.post('/api/vip/status', (req, res) => {
  const t = readToken(req.body.token);
  res.json(t ? { vip: true, exp: t.exp } : { vip: false });
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });

// ---- state (in memory; use Redis/DB when you scale to several servers) ----
const waiting = [];              // sockets waiting for a partner
const reports = new Map();       // ip -> { count, reporters:Set }
const bans = new Map();          // ip -> ban expiry timestamp

const ipOf = (s) =>
  (s.handshake.headers['x-forwarded-for'] || s.handshake.address || '')
    .split(',')[0].trim();

function isBanned(ip) {
  const until = bans.get(ip);
  if (!until) return false;
  if (Date.now() > until) { bans.delete(ip); return false; }
  return true;
}

function onlineCount() { return io.engine.clientsCount; }

function removeFromQueue(s) {
  const i = waiting.indexOf(s);
  if (i !== -1) waiting.splice(i, 1);
}

// Does a want b? (gender: 'male' | 'female'; want: 'any' | gender; country: ISO code)
function accepts(a, b) {
  const p = a.data.prefs;
  if (p.want !== 'any' && p.want !== b.data.prefs.gender) return false;
  if (p.wantCountry !== 'any' && p.wantCountry !== b.data.prefs.country) return false;
  // don't rematch the same two people within 10 seconds
  if (a.data.lastPartner === b.id && Date.now() - a.data.lastPairAt < 10000) return false;
  return true;
}

function tryMatch(s) {
  // VIP priority: waiting VIP users are offered first.
  const candidates = waiting
    .filter((o) => o !== s && o.connected)
    .sort((x, y) => Number(Boolean(y.data.vip)) - Number(Boolean(x.data.vip)));
  for (const other of candidates) {
    if (accepts(s, other) && accepts(other, s)) {
      removeFromQueue(other);
      removeFromQueue(s);
      pair(s, other);
      return;
    }
  }
  if (!waiting.includes(s)) {
    if (s.data.vip) waiting.unshift(s);   // VIP goes to the front of the queue
    else waiting.push(s);
  }
  s.emit('waiting');
}

function pair(a, b) {
  a.data.partner = b.id;
  b.data.partner = a.id;
  a.data.lastPartner = b.id;
  b.data.lastPartner = a.id;
  a.data.lastPairAt = b.data.lastPairAt = Date.now();
  a.emit('matched', { initiator: true, country: b.data.prefs.country, vip: Boolean(b.data.vip) });
  b.emit('matched', { initiator: false, country: a.data.prefs.country, vip: Boolean(a.data.vip) });
}

function partnerOf(s) {
  return s.data.partner ? io.sockets.sockets.get(s.data.partner) : null;
}

function leave(s) {
  const p = partnerOf(s);
  s.data.partner = null;
  if (p) {
    p.data.partner = null;
    p.emit('partner-left');
  }
}

const GENDERS = ['male', 'female'];
const clean = (v, allowed, def) => (allowed.includes(v) ? v : def);
const cleanCountry = (v) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : 'any');

io.on('connection', (s) => {
  const ip = ipOf(s);
  if (isBanned(ip)) {
    s.emit('banned', { hours: BAN_HOURS });
    s.disconnect(true);
    return;
  }
  s.data.prefs = { gender: 'male', want: 'any', country: 'any', wantCountry: 'any' };
  s.data.lastFind = 0;
  io.emit('online', onlineCount());

  s.on('find', (prefs = {}) => {
    // simple rate limit: one search per 700ms
    const now = Date.now();
    if (now - s.data.lastFind < 700) return;
    s.data.lastFind = now;

    if (prefs.adult !== true) return s.emit('error-msg', 'لازم تأكد إن عمرك 18 أو أكثر');
    s.data.vip = Boolean(readToken(prefs.vipToken));
    s.data.prefs = {
      gender: clean(prefs.gender, GENDERS, 'male'),
      country: cleanCountry(prefs.country),
      // Gender and country filters are VIP-only
      want: s.data.vip ? clean(prefs.want, ['any', ...GENDERS], 'any') : 'any',
      wantCountry: s.data.vip ? cleanCountry(prefs.wantCountry) : 'any'
    };
    s.emit('vip-status', s.data.vip);
    leave(s);
    removeFromQueue(s);
    tryMatch(s);
  });

  // WebRTC offer/answer/ICE relay — only to the current partner
  s.on('signal', (data) => {
    const p = partnerOf(s);
    if (p) p.emit('signal', data);
  });

  s.on('chat', (text) => {
    const p = partnerOf(s);
    if (!p || typeof text !== 'string') return;
    const msg = text.trim().slice(0, 500);
    if (msg) p.emit('chat', msg);
  });

  s.on('stop', () => {
    leave(s);
    removeFromQueue(s);
  });

  s.on('report', (reason) => {
    const p = partnerOf(s);
    if (!p) return;
    const pip = ipOf(p);
    const r = reports.get(pip) || { count: 0, reporters: new Set() };
    if (!r.reporters.has(ip)) {        // one report per reporter IP
      r.reporters.add(ip);
      r.count++;
      reports.set(pip, r);
      console.log(`[report] ${new Date().toISOString()} ip=${pip} reason=${String(reason).slice(0, 50)} total=${r.count}`);
    }
    leave(s);
    if (r.count >= REPORTS_TO_BAN) {
      bans.set(pip, Date.now() + BAN_HOURS * 3600 * 1000);
      reports.delete(pip);
      p.emit('banned', { hours: BAN_HOURS });
      p.disconnect(true);
    }
  });

  s.on('disconnect', () => {
    leave(s);
    removeFromQueue(s);
    io.emit('online', onlineCount());
  });
});

// Retry waiting users every few seconds (e.g. once the 10s no-rematch window passes)
setInterval(() => {
  for (const s of [...waiting]) {
    if (!waiting.includes(s)) continue;   // already matched in this sweep
    removeFromQueue(s);
    if (s.connected) tryMatch(s);
  }
}, 3000);

server.listen(PORT, () => console.log(`old.tv running on http://localhost:${PORT}`));
