/*
 * Service worker (Manifest V3) : point d'entrée de l'arrière-plan.
 *
 * Il peut être endormi à tout moment par Chrome : aucun état important
 * n'est gardé en variable globale, tout est relu depuis chrome.storage.
 * Les écouteurs sont enregistrés immédiatement (obligatoire en MV3) pour
 * que Chrome puisse réveiller le worker sur chaque événement.
 */
importScripts(
  '/config/notube-config.js',
  '/lib/log.js',
  '/lib/util.js',
  '/lib/storage.js',
  '/background/notify.js',
  '/background/work-tab.js',
  '/background/offscreen-client.js',
  '/background/runner.js',
  '/background/downloads.js',
  '/background/playlist.js',
  '/background/messages.js'
);

/*
 * Vérification de démarrage : placée en tête de la file exclusive, elle est
 * traitée avant tout événement (nouvelle session -> titre interrompu remis en
 * attente, file en pause ; sinon relance de l'horloge si besoin).
 */
NTX.runner.startupCheck();

/* Messages (popup + pages noTube) : réponse asynchrone. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  NTX.messages
    .handle(msg, sender)
    .then((r) => sendResponse(r === undefined ? { ok: true } : r))
    .catch((e) => {
      NTX_log.error('Erreur sur le message', msg && msg.type, e);
      sendResponse({ ok: false, error: e.message });
    });
  return true;
});

/* Alarmes : titre suivant, watchdog, retour du réseau. */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NTX.ALARMS.TICK) NTX.runner.tick();
  else if (alarm.name === NTX.ALARMS.WATCHDOG) NTX.runner.onWatchdog();
  else if (alarm.name === NTX.ALARMS.ONLINE) NTX.runner.onOnlineCheck();
});

/* Onglets : publicités ouvertes par l'onglet de travail, fermeture de celui-ci. */
chrome.tabs.onCreated.addListener((tab) => NTX.workTab.onTabCreated(tab));
chrome.tabs.onRemoved.addListener((tabId) => NTX.workTab.onTabRemoved(tabId));

/* Téléchargements. */
chrome.downloads.onCreated.addListener((dl) => NTX.downloads.onCreated(dl));
chrome.downloads.onChanged.addListener((delta) => NTX.downloads.onChanged(delta));
chrome.downloads.onDeterminingFilename.addListener((dl, suggest) => NTX.downloads.onDeterminingFilename(dl, suggest));

/* Notifications. */
chrome.notifications.onClicked.addListener((id) => NTX.onNotificationClicked(id));

/* Démarrage du navigateur : reprise propre de la file. */
chrome.runtime.onStartup.addListener(() => NTX.runner.startupCheck());

/* Installation / mise à jour : réglages par défaut complétés. */
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...NTX.DEFAULT_SETTINGS, ...(settings || {}) } });
  NTX_log.info('Extension installée / mise à jour');
});

