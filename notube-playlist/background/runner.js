/*
 * L'automate : choisit le prochain titre, gère pause / reprise, essais,
 * watchdog, rythme et plafond horaire.
 *
 * Convention : les fonctions « …Locked » reçoivent l'état chargé (s) et
 * doivent être appelées À L'INTÉRIEUR de NTX.exclusive.
 */
self.NTX = self.NTX || {};

NTX.ALARMS = {
  TICK: 'ntx-tick',         // passage au titre suivant
  WATCHDOG: 'ntx-watchdog', // abandon d'un titre trop long
  ONLINE: 'ntx-online',     // vérification du retour de la connexion
};

NTX.PAUSE_LABELS = {
  manual: 'Pause manuelle',
  captcha: 'Captcha à résoudre dans l’onglet noTube',
  offline: 'Connexion perdue : reprise automatique au retour du réseau',
  restart: 'Navigateur redémarré ou extension rechargée : cliquez sur Reprendre',
};

NTX.runner = {
  /** Programme le passage au titre suivant (alarme + minuterie, l'appel est idempotent). */
  scheduleTick(when) {
    const now = Date.now();
    chrome.alarms.create(NTX.ALARMS.TICK, { when: Math.max(when, now + 100) });
    setTimeout(() => NTX.runner.tick(), Math.max(0, when - now) + 50);
  },

  tick() {
    return NTX.exclusive(async () => tickLocked(await NTX.store.load()));
  },

  /* ---------- Commandes de la popup ---------- */

  start() {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      if (s.run.state === 'running') return { ok: true };
      if (s.run.state === 'paused') return resumeLocked(s);
      const now = Date.now();
      // Un élément resté « en cours » (arrêt brutal) repasse en attente.
      for (const it of s.queue) if (it.status === 'running') it.status = 'pending';
      Object.assign(s.run, {
        state: 'running', pauseReason: null, consecutiveFailures: 0, nextAt: now,
        currentId: null, jobToken: null, phase: null, downloadId: null, statusText: 'Démarrage…',
      });
      await NTX.store.save({ run: s.run, queue: s.queue });
      NTX_log.info('Démarrage de la file');
      NTX.runner.scheduleTick(now);
      return { ok: true };
    });
  },

  pause(reason = 'manual') {
    return NTX.exclusive(async () => pauseLocked(await NTX.store.load(), reason));
  },

  resume() {
    return NTX.exclusive(async () => resumeLocked(await NTX.store.load()));
  },

  clear() {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      await cancelCurrentDownload(s.run);
      await chrome.alarms.clear(NTX.ALARMS.TICK);
      await chrome.alarms.clear(NTX.ALARMS.WATCHDOG);
      await chrome.alarms.clear(NTX.ALARMS.ONLINE);
      const run = { ...NTX.DEFAULT_RUN, workTabId: s.run.workTabId, statusText: 'File vidée' };
      await NTX.store.save({ run, queue: [] });
      NTX_log.info('File vidée');
      return { ok: true };
    });
  },

  retryErrors() {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      let n = 0;
      for (const it of s.queue) {
        if (it.status === 'error') {
          Object.assign(it, { status: 'pending', attempts: 0, error: null, preferClick: false, updatedAt: Date.now() });
          n++;
        }
      }
      await NTX.store.save({ queue: s.queue });
      NTX_log.info(`${n} titre(s) en erreur remis en attente`);
      return { ok: true, count: n };
    });
  },

  /** Ajoute des vidéos [{id, title}] en ignorant celles déjà présentes (quel que soit leur statut). */
  addItems(items) {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      const known = new Set(s.queue.map((i) => i.id));
      const now = Date.now();
      let added = 0;
      let duplicates = 0;
      for (const v of items) {
        if (!NTX.util.isVideoId(v.id)) continue;
        if (known.has(v.id)) { duplicates++; continue; }
        known.add(v.id);
        s.queue.push({
          id: v.id,
          title: v.title || v.id,
          channel: v.channel || '',
          url: NTX.util.canonicalUrl(v.id),
          status: 'pending',
          attempts: 0,
          error: null,
          addedAt: now,
          updatedAt: now,
        });
        added++;
      }
      await NTX.store.save({ queue: s.queue });
      return { added, duplicates };
    });
  },

  /* ---------- Alarmes ---------- */

  onWatchdog() {
    return NTX.exclusive(async () => watchdogLocked(await NTX.store.load()));
  },

  onOnlineCheck() {
    return NTX.exclusive(async () => {
      const s = await NTX.store.load();
      if (s.run.state !== 'paused' || s.run.pauseReason !== 'offline') {
        await chrome.alarms.clear(NTX.ALARMS.ONLINE);
        return;
      }
      if (await NTX.runner.isOnline()) {
        NTX_log.info('Connexion rétablie : reprise');
        await chrome.alarms.clear(NTX.ALARMS.ONLINE);
        await resumeLocked(s);
      }
    });
  },

  /**
   * À chaque réveil du worker (appelé AVANT tout autre traitement).
   * chrome.storage.session est vidé à chaque fermeture du navigateur et au
   * rechargement de l'extension : son absence signale une nouvelle session,
   * même si l'événement onStartup n'a pas été reçu. Comme cet appel est le
   * premier de la file exclusive, aucun message d'un onglet restauré ne peut
   * être traité avec l'état de la session précédente.
   */
  startupCheck() {
    return NTX.exclusive(async () => {
      const { ntxSession } = await chrome.storage.session.get('ntxSession');
      if (!ntxSession) {
        await chrome.storage.session.set({ ntxSession: Date.now() });
        await recoverLocked();
      }
      const { run } = await NTX.store.load();
      if (run.state === 'running' && !run.currentId) NTX.runner.scheduleTick(run.nextAt || Date.now());
    });
  },

  /** Test de connexion réel (navigator.onLine seul n'est pas fiable). */
  async isOnline() {
    if (!navigator.onLine) return false;
    try {
      // « no-cors » : seule compte la réponse du réseau, pas son contenu.
      await fetch(NTX_CONFIG.notube.converterUrl, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch (e) {
      return false;
    }
  },

  /* Accès « verrouillé » pour les autres modules. */
  endJobLocked: (...a) => endJobLocked(...a),
  pauseLocked: (...a) => pauseLocked(...a),
  resumeLocked: (...a) => resumeLocked(...a),
};

/* ====================================================================== */

/** Nouvelle session : on remet le titre interrompu en attente et on se met en pause. (verrouillé) */
async function recoverLocked() {
  const s = await NTX.store.load();
  // Ancien état sans titre en cours ni marche : rien à faire.
  requeueCurrent(s, 'Interrompu par la fermeture du navigateur');
  const wasRunning = s.run.state === 'running';
  Object.assign(s.run, {
    workTabId: null, // les identifiants d'onglets changent après un redémarrage
    state: wasRunning ? 'paused' : s.run.state,
    pauseReason: wasRunning ? 'restart' : s.run.pauseReason,
    statusText: wasRunning ? NTX.PAUSE_LABELS.restart : s.run.statusText,
  });
  await chrome.alarms.clear(NTX.ALARMS.TICK);
  await chrome.alarms.clear(NTX.ALARMS.WATCHDOG);
  await NTX.store.save({ run: s.run, queue: s.queue });
  NTX_log.info('Nouvelle session du navigateur : état remis au propre');
  if (wasRunning) {
    const left = s.queue.filter((i) => i.status === 'pending').length;
    NTX.notify('ntx-restart', 'NoTube Playlist en pause',
      `Navigateur redémarré (ou extension rechargée). ${left} titre(s) en attente : ouvrez l’extension et cliquez sur Reprendre.`);
  }
}

async function tickLocked(s) {
  const { run, settings, queue } = s;
  if (run.state !== 'running' || run.currentId) return;
  const now = Date.now();

  if (run.nextAt && now < run.nextAt - 200) {
    NTX.runner.scheduleTick(run.nextAt);
    return;
  }

  // Plafond horaire : on compte les titres commencés depuis une heure.
  run.startsLog = (run.startsLog || []).filter((t) => t > now - 3600e3);
  if (run.startsLog.length >= settings.maxPerHour) {
    run.nextAt = run.startsLog[0] + 3600e3 + 1000;
    run.statusText = `Plafond de ${settings.maxPerHour} titres/heure atteint : reprise à ${NTX.util.formatTime(run.nextAt)}`;
    await NTX.store.save({ run });
    NTX_log.info(run.statusText);
    NTX.runner.scheduleTick(run.nextAt);
    return;
  }

  if (!(await NTX.runner.isOnline())) {
    await pauseLocked(s, 'offline');
    return;
  }

  const item = queue.find((i) => i.status === 'pending');
  if (!item) {
    run.state = 'stopped';
    run.nextAt = null;
    const done = queue.filter((i) => i.status === 'done').length;
    const errors = queue.filter((i) => i.status === 'error').length;
    run.statusText = `File terminée : ${done} terminé(s), ${errors} erreur(s)`;
    await NTX.store.save({ run });
    NTX_log.info(run.statusText);
    NTX.notify('ntx-finished', 'NoTube Playlist : file terminée', run.statusText);
    return;
  }

  // Début d'un nouveau titre : tout ce qui concerne le titre précédent est remis à zéro.
  item.status = 'running';
  item.attempts = (item.attempts || 0) + 1;
  item.updatedAt = now;
  Object.assign(run, {
    currentId: item.id,
    jobToken: NTX.util.token(),
    phase: 'loading',
    downloadId: null,
    expectedFilename: null,
    dlStartedAt: null,
    clickAt: null,
    clickAttempts: 0,
    lastBytes: 0,
    jobStartedAt: now,
    nextAt: null,
    progressText: 'Chargement de noTube…',
    statusText: `Essai ${item.attempts}/${settings.maxAttempts}`,
  });
  run.startsLog.push(now);
  await NTX.store.save({ run, queue });
  await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when: now + settings.watchdogSec * 1000 });
  NTX_log.info(`Titre ${item.id} « ${item.title} » (essai ${item.attempts}/${settings.maxAttempts})`);

  try {
    const tabId = await NTX.workTab.open(NTX_CONFIG.notube.converterUrl, run.workTabId);
    if (tabId !== run.workTabId) {
      run.workTabId = tabId;
      await NTX.store.save({ run });
    }
  } catch (e) {
    await endJobLocked(s, { ok: false, reason: 'Impossible d’ouvrir l’onglet de travail : ' + e.message });
  }
}

/**
 * Termine le titre en cours.
 * opts : { ok, reason, retry = true, countAttempt = true, kind, filename, preferClick }
 *  - countAttempt=false : l'échec n'est pas imputable au titre (onglet fermé, réseau…)
 *  - kind='limit'       : message de limite noTube -> longue pause
 *  - retry=false        : erreur définitive (vidéo trop longue…)
 */
async function endJobLocked(s, opts) {
  const { run, settings, queue } = s;
  const { ok, reason = '', retry = true, countAttempt = true, kind, filename, preferClick, waitMs = 0 } = opts;
  const now = Date.now();
  const item = queue.find((i) => i.id === run.currentId);

  if (item) {
    item.updatedAt = now;
    if (ok) {
      Object.assign(item, { status: 'done', error: null, filename: filename || null, doneAt: now });
      run.durations = [...(run.durations || []), now - (run.jobStartedAt || now)].slice(-20);
      run.consecutiveFailures = 0;
      NTX_log.info(`Terminé : ${item.title} -> ${filename}`);
    } else {
      if (!countAttempt) item.attempts = Math.max(0, (item.attempts || 1) - 1);
      if (preferClick) item.preferClick = true;
      item.error = reason;
      // Réglage illisible ou vide : 3 essais par défaut (jamais d'abandon dès le premier échec).
      const maxAttempts = Number(settings.maxAttempts) >= 1 ? Number(settings.maxAttempts) : NTX.DEFAULT_SETTINGS.maxAttempts;
      item.status = retry && item.attempts < maxAttempts ? 'pending' : 'error';
      if (countAttempt) run.consecutiveFailures = (run.consecutiveFailures || 0) + 1;
      NTX_log.warn(`Échec (${item.status === 'error' ? 'abandon' : 'nouvel essai prévu'}) : ${item.title} : ${reason}`);
    }
  }

  if (!ok) await cancelCurrentDownload(run);
  releaseBlob(run);
  chrome.notifications.clear('ntx-captcha'); // la vérification éventuelle de ce titre est dépassée
  Object.assign(run, {
    currentId: null, jobToken: null, phase: null, downloadId: null,
    jobStartedAt: null, dlStartedAt: null, clickAt: null, progressText: '',
  });
  await chrome.alarms.clear(NTX.ALARMS.WATCHDOG);

  // Rythme : pause aléatoire, allongée après des échecs consécutifs.
  let pause = NTX.util.randomBetween(settings.pauseMinSec, settings.pauseMaxSec) * 1000;
  if (!ok && countAttempt) pause *= Math.min(2 ** run.consecutiveFailures, 16);
  if (!ok && countAttempt && run.consecutiveFailures === settings.alertAfterFailures) {
    NTX.notify('ntx-failures', 'NoTube Playlist : échecs répétés',
      `${run.consecutiveFailures} échecs consécutifs. Dernier : ${reason}. Le rythme est ralenti automatiquement.`);
  }
  run.nextAt = now + pause;
  run.statusText = `Prochain titre à ${NTX.util.formatTime(run.nextAt)}`;
  // Limite noTube : toute la file attend la durée annoncée (ou le réglage), + 2 min de marge.
  if (kind === 'limit') {
    pause = Math.max(pause, waitMs ? waitMs + 120e3 : settings.limitPauseMin * 60e3);
    run.nextAt = now + pause;
    run.statusText = `Limite noTube : reprise automatique à ${NTX.util.formatTime(run.nextAt)}`;
    NTX.notify('ntx-limit', 'noTube : limite gratuite atteinte',
      `${reason}. La file reprendra seule à ${NTX.util.formatTime(run.nextAt)}. Baissez le plafond horaire pour l’éviter.`);
  }
  await NTX.store.save({ run, queue });
  if (run.state === 'running') NTX.runner.scheduleTick(run.nextAt);
}

/** Libère la copie étiquetée gardée en mémoire par le document invisible. */
function releaseBlob(run) {
  if (run.blobUrl) {
    NTX.offscreen.revoke(run.blobUrl);
    run.blobUrl = null;
  }
}

/** Remet le titre en cours en attente sans compter l'essai (pause, redémarrage…). */
function requeueCurrent(s, reason) {
  const item = s.queue.find((i) => i.id === s.run.currentId);
  if (item && item.status === 'running') {
    item.status = 'pending';
    item.attempts = Math.max(0, (item.attempts || 1) - 1);
    item.error = reason || item.error;
    item.updatedAt = Date.now();
  }
  releaseBlob(s.run);
  Object.assign(s.run, {
    currentId: null, jobToken: null, phase: null, downloadId: null,
    jobStartedAt: null, dlStartedAt: null, clickAt: null, progressText: '',
  });
}

async function pauseLocked(s, reason) {
  const { run } = s;
  if (run.state === 'stopped' && reason !== 'manual') return { ok: true };
  await cancelCurrentDownload(run);
  requeueCurrent(s, run.currentId ? NTX.PAUSE_LABELS[reason] : null);
  run.state = 'paused';
  run.pauseReason = reason;
  run.statusText = NTX.PAUSE_LABELS[reason] || 'En pause';
  await chrome.alarms.clear(NTX.ALARMS.TICK);
  await chrome.alarms.clear(NTX.ALARMS.WATCHDOG);
  await NTX.store.save({ run, queue: s.queue });
  NTX_log.info('Pause :', run.statusText);
  if (reason === 'offline') {
    chrome.alarms.create(NTX.ALARMS.ONLINE, { periodInMinutes: 0.5 });
    NTX.notify('ntx-offline', 'NoTube Playlist : connexion perdue',
      'La file est en pause et reprendra seule au retour du réseau.');
  }
  return { ok: true };
}

async function resumeLocked(s) {
  const { run } = s;
  if (run.state !== 'paused') return { ok: true };
  const now = Date.now();
  Object.assign(run, { state: 'running', pauseReason: null, nextAt: now, statusText: 'Reprise…' });
  await NTX.store.save({ run });
  NTX_log.info('Reprise de la file');
  NTX.runner.scheduleTick(now);
  return { ok: true };
}

async function watchdogLocked(s) {
  const { run, settings } = s;
  if (run.state !== 'running' || !run.currentId) return;
  if (run.phase === 'captcha') return; // l'utilisateur doit cocher la case : aucun délai
  const now = Date.now();

  if (!(await NTX.runner.isOnline())) {
    await pauseLocked(s, 'offline');
    return;
  }

  // Pendant le téléchargement : on prolonge tant que des octets arrivent.
  if (run.phase === 'downloading' && run.downloadId != null) {
    const [d] = await chrome.downloads.search({ id: run.downloadId });
    const elapsed = now - (run.dlStartedAt || now);
    if (d && d.state === 'in_progress' && d.bytesReceived > (run.lastBytes || 0)
        && elapsed < settings.downloadTimeoutSec * 1000) {
      run.lastBytes = d.bytesReceived;
      await NTX.store.save({ run });
      await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when: now + 60e3 });
      return;
    }
    await endJobLocked(s, { ok: false, reason: 'Téléchargement bloqué ou trop long' });
    return;
  }

  const phaseLabel = {
    loading: 'chargement de noTube',
    converting: 'conversion',
    'awaiting-click': 'attente du fichier',
    fetching: 'téléchargement du fichier',
  }[run.phase] || run.phase;
  // Le dernier message affiché par noTube est joint : il dit pourquoi ça a bloqué.
  const last = (run.progressText || '').trim();
  await endJobLocked(s, {
    ok: false,
    reason: `Délai dépassé (étape : ${phaseLabel})` + (last ? ` – dernier message noTube : « ${last} »` : ''),
  });
}

async function cancelCurrentDownload(run) {
  if (run.downloadId == null) return;
  try {
    const [d] = await chrome.downloads.search({ id: run.downloadId });
    if (d && d.state === 'in_progress') await chrome.downloads.cancel(run.downloadId);
  } catch (e) {
    /* déjà terminé ou supprimé */
  }
}
