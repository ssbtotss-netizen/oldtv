// old.tv — VIP payment (vip.html) and activation (vip-done.html)
(() => {
  const $ = (id) => document.getElementById(id);
  const VIP_KEY = 'oldtv_vip';
  const store = {
    get() { try { return localStorage.getItem(VIP_KEY); } catch (_) { return null; } },
    set(v) { try { localStorage.setItem(VIP_KEY, v); } catch (_) {} }
  };

  // ---- payment page ----
  if (document.querySelector('.mysr-form')) {
    fetch('/config').then((r) => r.json()).then(({ vip }) => {
      $('price').textContent = vip.priceLabel;
      $('days').textContent = vip.days;
      if (vip.demo) {
        $('demoBox').hidden = false;
        $('demoBtn').addEventListener('click', () => {
          fetch('/api/vip/demo', { method: 'POST' }).then((r) => r.json()).then((d) => {
            if (d.token) { store.set(d.token); location.href = '/'; }
          });
        });
      }
      if (!vip.enabled || !window.Moyasar) {
        if (!vip.demo) $('err').textContent = 'الاشتراك غير متاح حالياً، جرّب بعدين.';
        return;
      }
      Moyasar.init({
        element: '.mysr-form',
        amount: vip.amount,
        currency: vip.currency,
        description: 'old.tv VIP — ' + vip.days + ' days',
        publishable_api_key: vip.publishableKey,
        callback_url: location.origin + '/vip-done.html',
        methods: ['creditcard', 'applepay', 'stcpay'],
        supported_networks: ['mada', 'visa', 'mastercard'],
        apple_pay: {
          country: 'SA',
          label: 'old.tv VIP',
          validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate'
        }
      });
    }).catch(() => { $('err').textContent = 'صار خطأ، حدّث الصفحة.'; });
    return;
  }

  // ---- return page: Moyasar redirects here with ?id=...&status=... ----
  const q = new URLSearchParams(location.search);
  const id = q.get('id');
  const fail = (text) => {
    $('title').textContent = 'ما اكتمل الدفع';
    $('msg').textContent = text;
    $('retry').hidden = false;
  };
  if (!id) return fail('ما لقينا رقم العملية.');
  if (q.get('status') && q.get('status') !== 'paid') {
    return fail(q.get('message') || 'العملية ما تمت. ما انخصم منك شي.');
  }

  fetch('/api/vip/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, prevToken: store.get() || undefined })
  })
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok || !d.token) return fail(d.error || 'ما قدرنا نتحقق من الدفع.');
      store.set(d.token);
      const until = new Date(d.exp).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });
      $('title').textContent = 'صرت VIP!';
      $('msg').textContent = 'اشتراكك فعّال لين ' + until + '. احتفظ برقم العملية: ' + id;
      $('go').hidden = false;
    })
    .catch(() => fail('صار خطأ في الاتصال. حدّث الصفحة.'));
})();
