/*
 * Journalisation dans la console, avec un préfixe reconnaissable.
 * Activable / désactivable dans les options (« Journal détaillé »).
 * Les erreurs sont toujours affichées.
 * Utilisable dans le service worker, les scripts de contenu et les pages.
 */
(function () {
  const PREFIX = '[NoTube-Playlist]';
  let enabled = true;

  // Lecture du réglage, puis suivi de ses changements.
  try {
    chrome.storage.local.get('settings').then((r) => {
      if (r.settings && typeof r.settings.debug === 'boolean') enabled = r.settings.debug;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings && changes.settings.newValue) {
        enabled = changes.settings.newValue.debug !== false;
      }
    });
  } catch (e) {
    /* contexte sans accès au stockage : on garde la valeur par défaut */
  }

  self.NTX_log = {
    debug: (...a) => enabled && console.debug(PREFIX, ...a),
    info: (...a) => enabled && console.info(PREFIX, ...a),
    warn: (...a) => enabled && console.warn(PREFIX, ...a),
    error: (...a) => console.error(PREFIX, ...a),
  };
})();
