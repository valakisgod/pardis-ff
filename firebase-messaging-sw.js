/* Service worker اعلان‌های پردیس (Firebase Cloud Messaging).
   وقتی برنامه بسته است هم اعلان می‌رسه و این فایل نشونش می‌ده.
   باید دقیقاً کنارِ index.html (ریشه‌ی سایت) باشه. */
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBd6MELjPRHqUTPuXwrLIGJWr4n1i2btHk",
  authDomain: "pardis-b.firebaseapp.com",
  projectId: "pardis-b",
  storageBucket: "pardis-b.firebasestorage.app",
  messagingSenderId: "943540130003",
  appId: "1:943540130003:web:89c23d6e54797d66cc0426"
});

const messaging = firebase.messaging();

// سرور فقط «data» می‌فرسته؛ خودمون اعلان رو می‌سازیم تا آلارم قوی‌تر از آگهیِ معمولی باشه.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const isAlarm = d.type === 'alarm';
  return self.registration.showNotification(d.title || 'پردیس', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag: d.tag || (isAlarm ? 'pardis-alarm' : 'pardis-new-ads'),
    renotify: true,                      // هر اعلانِ تازه دوباره صدا/لرزش بده
    requireInteraction: isAlarm,         // آلارم تا کاربر بازش نکنه یا نبندتش روی صفحه می‌مونه
    vibrate: isAlarm ? [600, 200, 600, 200, 600, 200, 600] : [200, 100, 200],
    dir: 'rtl',
    lang: 'fa',
    data: { url: d.url || (self.registration.scope) },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    }
    return clients.openWindow(url);
  })());
});
