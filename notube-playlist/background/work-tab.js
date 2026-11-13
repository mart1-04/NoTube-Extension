/*
 * Onglet de travail : un seul onglet noTube, en arrière-plan, réutilisé
 * pour tous les titres. Tout onglet ou fenêtre qu'il ouvre (publicité) est
 * fermé automatiquement.
 */
self.NTX = self.NTX || {};

NTX.workTab = {
  /** Charge l'adresse dans l'onglet de travail (le recrée s'il a été fermé). Retourne son id. */
  async open(url, tabId) {
    if (tabId != null) {
      try {
        await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { url });
        return tabId;
      } catch (e) {
        NTX_log.info('Onglet de travail introuvable : création d’un nouvel onglet');
      }
    }
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      return tab.id;
    } catch (e) {
      // Aucune fenêtre ouverte : on crée une fenêtre réduite.
      const win = await chrome.windows.create({ url, focused: false, state: 'minimized' });
      return win.tabs[0].id;
    }
  },

  /** Met l'onglet au premier plan (captcha à résoudre). */
  async focus(tabId) {
    if (tabId == null) return;
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    } catch (e) {
      NTX_log.warn('Impossible de mettre l’onglet au premier plan :', e.message);
    }
  },

  /** Ferme les onglets / fenêtres ouverts par l'onglet de travail (publicités). */
  async onTabCreated(tab) {
    if (tab.openerTabId == null) return;
    const { run } = await chrome.storage.local.get('run');
    if (!run || run.workTabId == null || tab.openerTabId !== run.workTabId) return;
    NTX_log.info('Fermeture d’un onglet ouvert par noTube (publicité) :', tab.pendingUrl || tab.url || tab.id);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* déjà fermé */
    }
  },

  /** L'onglet de travail a été fermé (à la main ou non). */
  onTabRemoved(tabId) {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      if (tabId !== s.run.workTabId) return;
      s.run.workTabId = null;
      await NTX.store.save({ run: s.run });
      // Un téléchargement déjà lancé continue sans l'onglet.
      if (s.run.state === 'running' && s.run.currentId && s.run.phase !== 'downloading') {
        await NTX.runner.endJobLocked(s, {
          ok: false,
          reason: 'Onglet de travail fermé : nouvel essai',
          countAttempt: false,
        });
      }
    });
  },
};
