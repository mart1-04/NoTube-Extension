/*
 * Notifications système (captcha, limite, échecs répétés, fin de file).
 */
self.NTX = self.NTX || {};

NTX.notify = function (id, title, message, requireInteraction = false) {
  chrome.notifications
    .create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
      requireInteraction,
    })
    .catch((e) => NTX_log.warn('Notification impossible :', e.message));
};

/** Un clic sur la notification de captcha ramène l'onglet noTube au premier plan. */
NTX.onNotificationClicked = async function (id) {
  if (id === 'ntx-captcha') {
    const { run } = await chrome.storage.local.get('run');
    if (run) await NTX.workTab.focus(run.workTabId);
  }
  chrome.notifications.clear(id);
};
