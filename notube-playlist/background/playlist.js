/*
 * Récupération d'une playlist YouTube depuis l'onglet actif.
 * Le script est injecté uniquement à la demande (bouton de la popup),
 * grâce à la permission « activeTab » : aucun accès permanent à YouTube.
 */
self.NTX = self.NTX || {};

NTX.playlist = {
  async fetchFromTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    if (!NTX_CONFIG.youtube.playlistUrl.test(url)) {
      if (/youtube\.com\/watch\?.*list=/i.test(url)) {
        const list = new URL(url).searchParams.get('list');
        return {
          ok: false,
          error: `Ouvrez la page de la playlist elle-même : https://www.youtube.com/playlist?list=${list}`,
        };
      }
      return { ok: false, error: 'L’onglet actif n’est pas une page de playlist YouTube (youtube.com/playlist?list=…).' };
    }

    await NTX.store.save({ fetchStatus: { running: true, text: 'Lecture de la playlist (défilement)…', at: Date.now() } });
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['config/notube-config.js', 'lib/util.js', 'content/dom-helpers.js', 'content/youtube-scraper.js'],
      });
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => self.NTX_scrapePlaylist().catch((e) => ({ error: e.message })),
      });
      const data = res && res.result;
      if (data && data.error) throw new Error(data.error);
      if (!data || !Array.isArray(data.items)) throw new Error('Aucun résultat renvoyé par la page');
      // Garde-fou : la liste lue doit être celle de l'onglet au moment du clic.
      const expected = new URL(url).searchParams.get('list');
      if (data.listId !== expected) throw new Error('La page a changé pendant la lecture. Réessayez sans quitter la playlist.');

      const { added, duplicates } = await NTX.runner.addItems(data.items);
      const summary = {
        ok: true,
        playlistTitle: data.playlistTitle,
        found: data.items.length,
        added,
        duplicates: duplicates + data.duplicates,
        unavailable: data.unavailable,
      };
      const text = `« ${data.playlistTitle} » : ${data.items.length} vidéo(s) lue(s), ${added} ajoutée(s), `
        + `${summary.duplicates} doublon(s), ${data.unavailable} indisponible(s) ignorée(s).`;
      await NTX.store.save({ fetchStatus: { running: false, text, at: Date.now() } });
      NTX_log.info(text);
      return summary;
    } catch (e) {
      const text = 'Échec de la récupération : ' + e.message;
      await NTX.store.save({ fetchStatus: { running: false, text, at: Date.now() } });
      NTX_log.error(text);
      return { ok: false, error: text };
    }
  },
};
