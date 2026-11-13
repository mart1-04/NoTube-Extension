/*
 * Suivi des téléchargements via l'API chrome.downloads.
 *
 * Mode « direct » (par défaut) : le script de contenu lit le lien du bouton
 * « Télécharger » et l'extension lance elle-même le téléchargement, avec le
 * bon dossier et le bon nom. La publicité liée au bouton n'est jamais ouverte.
 *
 * Mode « clic » (secours) : le script de contenu clique sur le bouton ; le
 * téléchargement créé ensuite est associé au titre en cours et renommé.
 * L'extension bascule seule en mode clic pour un titre dont le lien direct a
 * échoué (refus du serveur, fichier HTML ou trop petit).
 */
self.NTX = self.NTX || {};

NTX.downloads = {
  /** Chemin relatif au dossier Téléchargements : « Musique/Titre.mp3 ». */
  buildFilename(settings, item, useIdOnly = false) {
    const ext = NTX_CONFIG.notube.formatExtensions[settings.format] || 'mp3';
    const folder = NTX.util.sanitizeFolder(settings.folder);
    // Nom de la musique : titre YouTube nettoyé (« (Clip Officiel) » retiré…), sauf si désactivé.
    const name = settings.cleanTitles === false ? item.title || item.id : NTX.util.cleanTitle(item.title || item.id);
    const base = useIdOnly ? item.id : NTX.util.sanitizeFilename(name);
    return (folder ? folder + '/' : '') + base + '.' + ext;
  },

  /** Mode direct : lance le téléchargement du lien fourni par la page. (verrouillé) */
  async startDirectLocked(s, url) {
    const { run, settings, queue } = s;
    const item = queue.find((i) => i.id === run.currentId);
    if (!item) return;
    if (!NTX_CONFIG.notube.downloadUrlPattern.test(url)) {
      await NTX.runner.endJobLocked(s, { ok: false, reason: 'Lien de téléchargement inattendu : ' + url.slice(0, 80) });
      return;
    }
    // Le nom voulu est aussi mémorisé : Chrome ignore le « filename » de download()
    // dès qu'un écouteur onDeterminingFilename existe, on le redonne donc là-bas.
    const expectedFilename = NTX.downloads.buildFilename(settings, item);

    // Avec étiquettes : le document invisible récupère le fichier, écrit titre et
    // artiste, puis on enregistre la copie étiquetée (voir fetchTagAndSave).
    if (settings.writeTags) {
      Object.assign(run, {
        phase: 'fetching', downloadId: null, dlStartedAt: Date.now(), lastBytes: 0,
        progressText: 'Téléchargement du fichier…', expectedFilename,
      });
      await NTX.store.save({ run });
      await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when: Date.now() + (settings.downloadTimeoutSec + 30) * 1000 });
      const tagIt = ['mp3', 'mp3hd'].includes(settings.format);
      // Lancé hors du verrou : la récupération peut durer, les autres événements continuent.
      NTX.downloads.fetchTagAndSave(run.jobToken, url, NTX.util.trackMeta(item), tagIt);
      return;
    }

    Object.assign(run, {
      phase: 'downloading', downloadId: null, dlStartedAt: Date.now(), lastBytes: 0,
      progressText: 'Téléchargement du fichier…', expectedFilename,
    });
    await NTX.store.save({ run });
    await NTX.downloads.saveToDiskLocked(s, item, url);
  },

  /**
   * Récupère le fichier via le document invisible, l'étiquette, puis l'enregistre.
   * Appelé hors verrou ; le résultat est appliqué sous verrou et ignoré si le
   * titre a changé entre-temps (jeton différent).
   */
  async fetchTagAndSave(token, url, meta, tagIt) {
    const { settings } = await NTX.store.load();
    let res;
    try {
      res = await NTX.offscreen.fetchTag({
        url, meta, tag: tagIt,
        minBytes: settings.minSizeKb * 1024,
        timeoutMs: settings.downloadTimeoutSec * 1000,
      });
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      const { run } = s;
      if (run.jobToken !== token || run.phase !== 'fetching') {
        if (res && res.blobUrl) NTX.offscreen.revoke(res.blobUrl);
        return;
      }
      if (!res || !res.ok) {
        if (res && res.network && !(await NTX.runner.isOnline())) {
          await NTX.runner.pauseLocked(s, 'offline');
          return;
        }
        await NTX.runner.endJobLocked(s, {
          ok: false,
          reason: 'Téléchargement impossible : ' + ((res && res.error) || 'erreur inconnue'),
          preferClick: !!(res && res.server),
        });
        return;
      }
      if (tagIt && !res.tagged) NTX_log.warn('Fichier non reconnu comme MP3 : enregistré sans étiquettes');
      else if (res.tagged) NTX_log.info(`Étiquettes écrites : « ${meta.title} » – ${meta.artist || '(artiste inconnu)'}`);
      const item = s.queue.find((i) => i.id === run.currentId);
      Object.assign(run, { phase: 'downloading', blobUrl: res.blobUrl, dlStartedAt: Date.now(), progressText: 'Enregistrement du fichier…' });
      await NTX.store.save({ run });
      await NTX.downloads.saveToDiskLocked(s, item, res.blobUrl);
    });
  },

  /** Confie l'adresse à chrome.downloads sous le nom prévu (repli sur l'identifiant si refusé). (verrouillé) */
  async saveToDiskLocked(s, item, url) {
    const { run, settings } = s;
    let id;
    try {
      id = await chrome.downloads.download({
        url,
        filename: run.expectedFilename,
        conflictAction: 'uniquify',
        saveAs: false,
      });
    } catch (e) {
      // Nom refusé par Chrome (caractère exotique) : on se rabat sur l'identifiant.
      if (/filename/i.test(e.message)) {
        NTX_log.warn('Nom de fichier refusé, utilisation de l’identifiant :', e.message);
        run.expectedFilename = NTX.downloads.buildFilename(settings, item, true);
        await NTX.store.save({ run });
        try {
          id = await chrome.downloads.download({
            url,
            filename: run.expectedFilename,
            conflictAction: 'uniquify',
            saveAs: false,
          });
        } catch (e2) {
          await NTX.runner.endJobLocked(s, { ok: false, reason: 'Téléchargement refusé : ' + e2.message });
          return;
        }
      } else {
        await NTX.runner.endJobLocked(s, { ok: false, reason: 'Téléchargement refusé : ' + e.message });
        return;
      }
    }
    run.downloadId = id;
    await NTX.store.save({ run });
    await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when: Date.now() + 60e3 });
    NTX_log.info(`Téléchargement ${id} lancé pour ${item.id}`);
  },

  /** Mode clic : associe le téléchargement créé après le clic au titre en cours. */
  onCreated(dl) {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      const { run } = s;
      if (run.state !== 'running' || run.phase !== 'awaiting-click') return;
      const url = dl.finalUrl || dl.url || '';
      if (!NTX_CONFIG.notube.downloadUrlPattern.test(dl.url || '') && !NTX_CONFIG.notube.downloadUrlPattern.test(url)) return;
      // Un téléchargement antérieur au clic ne peut pas être le nôtre.
      if (dl.startTime && new Date(dl.startTime).getTime() < (run.clickAt || 0) - 2000) return;
      Object.assign(run, { phase: 'downloading', downloadId: dl.id, dlStartedAt: Date.now(), lastBytes: 0, progressText: 'Téléchargement du fichier…' });
      await NTX.store.save({ run });
      await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when: Date.now() + 60e3 });
      NTX_log.info(`Téléchargement ${dl.id} associé au titre ${run.currentId} (mode clic)`);
    });
  },

  /** Fin (ou échec) du téléchargement associé au titre en cours. */
  onChanged(delta) {
    if (!delta.state && !delta.error) return;
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      const { run, settings } = s;
      if (run.downloadId == null || delta.id !== run.downloadId || !run.currentId) return;
      const [d] = await chrome.downloads.search({ id: delta.id });
      const state = delta.state ? delta.state.current : d && d.state;
      const item = s.queue.find((i) => i.id === run.currentId);
      const wasDirect = item && !item.preferClick && settings.downloadMode !== 'click';
      // Fichier étiqueté terminé (ou échoué) : on libère sa copie en mémoire.
      if ((state === 'complete' || state === 'interrupted') && run.blobUrl) {
        NTX.offscreen.revoke(run.blobUrl);
        run.blobUrl = null;
      }

      if (state === 'complete') {
        const size = d ? (d.fileSize > 0 ? d.fileSize : d.bytesReceived) : 0;
        const isHtml = d && /text\/html/i.test(d.mime || '');
        if (isHtml || size < settings.minSizeKb * 1024) {
          // Fichier invalide (page d'erreur ou fichier tronqué) : on le supprime du disque.
          try { await chrome.downloads.removeFile(delta.id); } catch (e) { /* déjà absent */ }
          const why = isHtml ? 'le serveur a renvoyé une page web' : `fichier anormalement petit (${Math.round(size / 1024)} Ko)`;
          await NTX.runner.endJobLocked(s, { ok: false, reason: 'Échec : ' + why, preferClick: wasDirect });
          return;
        }
        const filename = d ? d.filename.split(/[\\/]/).pop() : '';
        await NTX.runner.endJobLocked(s, { ok: true, filename });
        return;
      }

      if (state === 'interrupted') {
        const err = (delta.error && delta.error.current) || (d && d.error) || 'inconnu';
        if (/^NETWORK/.test(err) && !(await NTX.runner.isOnline())) {
          await NTX.runner.pauseLocked(s, 'offline');
          return;
        }
        await NTX.runner.endJobLocked(s, {
          ok: false,
          reason: `Téléchargement interrompu (${err})`,
          preferClick: wasDirect && /^SERVER/.test(err),
        });
      }
    });
  },

  /**
   * Mode clic : donne le bon nom au fichier. Pour tous les autres
   * téléchargements du navigateur, on ne change rien.
   */
  onDeterminingFilename(dl, suggest) {
    if (dl.byExtensionId === chrome.runtime.id) {
      // Nos téléchargements directs : on redonne le chemin complet « Musique/Titre.mp3 ».
      chrome.storage.local
        .get('run')
        .then(({ run }) => {
          if (run && run.expectedFilename) suggest({ filename: run.expectedFilename, conflictAction: 'uniquify' });
          else suggest();
        })
        .catch(() => suggest());
      return true;
    }
    const pattern = NTX_CONFIG.notube.downloadUrlPattern;
    if (!pattern.test(dl.url || '') && !pattern.test(dl.finalUrl || '')) {
      suggest();
      return;
    }
    NTX.store
      .load()
      .then(({ run, settings, queue }) => {
        const item = queue.find((i) => i.id === run.currentId);
        if (run.state === 'running' && item && (run.phase === 'awaiting-click' || run.downloadId === dl.id)) {
          suggest({ filename: NTX.downloads.buildFilename(settings, item), conflictAction: 'uniquify' });
        } else {
          suggest();
        }
      })
      .catch(() => suggest());
    return true; // réponse asynchrone
  },
};
