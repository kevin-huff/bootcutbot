/* Profile-page push subscribe toggle. Requires a #push-subscribe-btn with a
   data-username attribute (the watched user's profile slug). */
(function () {
  const btn = document.getElementById('push-subscribe-btn');
  if (!btn) return;
  const statusEl = document.getElementById('push-status');
  const username = btn.dataset.username;
  const stateKey = 'bootcut-push:' + username;

  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg || ''; };

  if (!supported || window.isSecureContext === false) {
    btn.disabled = true;
    btn.textContent = 'Notifications not supported here';
    setStatus('Your browser or connection does not support push notifications.');
    return;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function getRegistration() {
    return (
      (await navigator.serviceWorker.getRegistration('/push-sw.js')) ||
      (await navigator.serviceWorker.register('/push-sw.js'))
    );
  }

  async function refreshUI() {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const on = !!sub && localStorage.getItem(stateKey) === '1';
    if (on) {
      btn.classList.add('is-on');
      btn.textContent = '🔔 Notifications on — tap to turn off';
    } else {
      btn.classList.remove('is-on');
      btn.textContent = "🔔 Notify me when it's their turn";
      if (!sub) localStorage.removeItem(stateKey);
    }
    return on;
  }

  async function subscribe() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      setStatus('Notifications are blocked. Enable them in your browser settings to subscribe.');
      return;
    }
    const keyResp = await fetch('/push/vapid-public-key');
    if (!keyResp.ok) {
      setStatus('Push notifications are not available right now.');
      return;
    }
    const vapidKey = (await keyResp.text()).trim();
    const reg = await getRegistration();
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    const resp = await fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, subscription: sub }),
    });
    if (!resp.ok) {
      setStatus('Could not save your subscription — please try again.');
      return;
    }
    localStorage.setItem(stateKey, '1');
    setStatus("Done — you'll get a notification the moment it's their turn.");
    await refreshUI();
  }

  async function unsubscribe() {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      // Only drop this user's mapping — the browser subscription may serve other
      // watched users, so we don't call sub.unsubscribe() here.
      await fetch('/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, endpoint: sub.endpoint }),
      }).catch(() => {});
    }
    localStorage.removeItem(stateKey);
    setStatus('Notifications turned off for this contestant.');
    await refreshUI();
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const on = await refreshUI();
      if (on) await unsubscribe();
      else await subscribe();
    } catch (err) {
      console.error('[push] toggle failed', err);
      setStatus('Something went wrong — please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  refreshUI().catch(() => {});
})();
