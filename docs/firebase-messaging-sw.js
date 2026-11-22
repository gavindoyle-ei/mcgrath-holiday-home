importScripts(
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js',
  'config.js'
);
firebase.initializeApp(self.CFG.FIREBASE);
const messaging = firebase.messaging();

// Messages are data-only, so we always show the notification ourselves.
messaging.onBackgroundMessage(p => {
  const d = p.data || {};
  return self.registration.showNotification(d.title || 'Holiday Homes', {
    body: d.body || '',
    icon: 'icon-192.png',
    data: { url: d.url || './' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});
