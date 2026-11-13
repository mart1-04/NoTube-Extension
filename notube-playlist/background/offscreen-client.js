/*
 * Côté service worker : ouverture du document invisible (offscreen) et
 * échanges avec lui pour récupérer + étiqueter les MP3.
 */
self.NTX = self.NTX || {};

NTX.offscreen = {
  async ensure() {
    if (chrome.runtime.getContexts) {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (ctx.length) return;
    }
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Écrire le titre et l’artiste dans le MP3 avant de l’enregistrer',
      });
    } catch (e) {
      if (!/single offscreen/i.test(e.message)) throw e; // déjà ouvert : rien à faire
    }
  },

  /** Récupère le fichier et l'étiquette. Réponse : { ok, blobUrl, size, tagged } ou { ok:false, error, server|network }. */
  async fetchTag(payload) {
    await NTX.offscreen.ensure();
    return chrome.runtime.sendMessage({ target: 'ntx-offscreen', type: 'fetch-tag', ...payload });
  },

  /** Libère la mémoire d'un fichier déjà enregistré. */
  revoke(blobUrl) {
    if (!blobUrl) return;
    chrome.runtime.sendMessage({ target: 'ntx-offscreen', type: 'revoke', blobUrl }).catch(() => {});
  },
};
