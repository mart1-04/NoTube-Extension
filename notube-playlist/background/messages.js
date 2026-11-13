/*
 * Messages reçus :
 *  - de la popup (commandes) ;
 *  - du script de contenu noTube (avancement du titre en cours).
 *
 * Un message de page n'est accepté que s'il vient de l'onglet de travail
 * ET porte le jeton du titre en cours : un vieux message ne peut jamais
 * agir sur un nouveau titre.
 */
self.NTX = self.NTX || {};

NTX.messages = {
  async handle(msg, sender) {
    switch (msg && msg.type) {
      /* ----- Popup ----- */
      case 'ntx:start': return NTX.runner.start();
      case 'ntx:pause': return NTX.runner.pause('manual');
      case 'ntx:resume': return NTX.runner.resume();
      case 'ntx:clear': return NTX.runner.clear();
      case 'ntx:retry-errors': return NTX.runner.retryErrors();
      case 'ntx:fetch-playlist': return NTX.playlist.fetchFromTab(msg.tabId);

      /* ----- Script de contenu noTube ----- */
      case 'ntx:hello': return NTX.exclusive(() => helloLocked(sender));
      case 'ntx:progress':
      case 'ntx:fail':
      case 'ntx:download-url':
      case 'ntx:clicked':
        return NTX.exclusive(() => fromPageLocked(msg, sender));
      case 'ntx:captcha': return NTX.exclusive(() => captchaLocked(msg, sender));
      case 'ntx:captcha-cleared': return NTX.exclusive(() => captchaClearedLocked(msg, sender));
      default:
        return { ok: false, error: 'Message inconnu' };
    }
  },
};

/** Phases où la page noTube n'a plus rien à faire (le fichier est en cours de récupération). */
const LATE_PHASES = ['awaiting-click', 'fetching', 'downloading'];

/** La page noTube demande ce qu'elle doit faire. */
async function helloLocked(sender) {
  const s = await NTX.store.load();
  const { run, settings, queue } = s;
  if (!sender.tab || sender.tab.id !== run.workTabId) return { active: false };
  if (run.state === 'paused' && run.pauseReason === 'captcha') return { active: false, watchCaptcha: true };
  if (run.state !== 'running' || !run.currentId) return { active: false };
  const item = queue.find((i) => i.id === run.currentId);
  if (!item) return { active: false };

  const job = {
    active: true,
    token: run.jobToken,
    phase: run.phase,
    url: item.url || NTX.util.canonicalUrl(item.id),
    title: item.title,
    format: settings.format,
    mode: settings.downloadMode === 'click' || item.preferClick ? 'click' : 'direct',
    simulateCaptcha: !!settings.simulateCaptchaOnce,
  };
  if (settings.simulateCaptchaOnce) {
    settings.simulateCaptchaOnce = false;
    await NTX.store.save({ settings });
  }
  return job;
}

async function fromPageLocked(msg, sender) {
  const s = await NTX.store.load();
  const { run } = s;
  const valid = sender.tab && sender.tab.id === run.workTabId && run.state === 'running'
    && run.currentId && msg.token && msg.token === run.jobToken;
  if (!valid) return { ok: false, ignored: true };

  switch (msg.type) {
    case 'ntx:progress':
      run.progressText = String(msg.text || '').slice(0, 200);
      if (msg.phase && !LATE_PHASES.includes(run.phase) && run.phase !== 'captcha') run.phase = msg.phase;
      if (run.phase === 'captcha') return { ok: true }; // le texte « Cochez la case » reste affiché tel quel
      await NTX.store.save({ run });
      // File d'attente noTube : le délai max de conversion repart après l'attente annoncée.
      if (msg.waitSec > 0 && msg.waitSec < 600) {
        const when = Date.now() + (msg.waitSec + s.settings.watchdogSec) * 1000;
        await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when });
        NTX_log.info(`File d’attente noTube de ${msg.waitSec} s : watchdog prolongé`);
      }
      return { ok: true };

    case 'ntx:fail':
      await NTX.runner.endJobLocked(s, {
        ok: false,
        reason: String(msg.reason || 'Erreur inconnue'),
        retry: msg.kind !== 'fatal',
        kind: msg.kind,
        // Une limite noTube n'est pas la faute du titre : l'essai n'est pas compté.
        countAttempt: msg.kind !== 'limit',
        waitMs: Number(msg.waitMs) || 0,
      });
      return { ok: true };

    case 'ntx:download-url':
      if (LATE_PHASES.includes(run.phase)) return { ok: true, ignored: true };
      await NTX.downloads.startDirectLocked(s, String(msg.url || ''));
      return { ok: true };

    case 'ntx:clicked': {
      if (run.phase === 'downloading' || run.phase === 'fetching') return { ok: true, ignored: true };
      Object.assign(run, {
        phase: 'awaiting-click',
        clickAt: Date.now(),
        clickAttempts: (run.clickAttempts || 0) + 1,
        progressText: `Clic sur « Télécharger » (${(run.clickAttempts || 0) + 1}/${NTX_CONFIG.timing.maxClicks})`,
      });
      await NTX.store.save({ run });
      const token = run.jobToken;
      setTimeout(() => NTX.exclusive(() => checkClickLocked(token)), NTX_CONFIG.timing.clickWaitMs);
      return { ok: true };
    }
  }
  return { ok: false };
}

/** Mode clic : si aucun fichier n'est arrivé, on recharge la page et on reclique (nombre limité). */
async function checkClickLocked(token) {
  const s = await NTX.store.load();
  const { run } = s;
  if (run.jobToken !== token || run.phase !== 'awaiting-click' || run.state !== 'running') return;
  if ((run.clickAttempts || 0) < NTX_CONFIG.timing.maxClicks) {
    NTX_log.info('Aucun fichier après le clic (publicité ?) : nouveau clic');
    try {
      await chrome.tabs.reload(run.workTabId); // le bouton est désactivé après un clic
    } catch (e) {
      await NTX.runner.endJobLocked(s, { ok: false, reason: 'Onglet de travail indisponible', countAttempt: false });
    }
    return;
  }
  await NTX.runner.endJobLocked(s, {
    ok: false,
    reason: `Aucun téléchargement après ${run.clickAttempts} clics sur « Télécharger »`,
  });
}

/**
 * Captcha / case « Cochez la case » détecté. Jamais de contournement :
 * l'extension s'arrête sur place (le titre en cours est gardé, sans délai qui
 * court), prévient et met l'onglet noTube au premier plan pour que l'utilisateur
 * coche lui-même. Hors titre en cours, la file passe en pause.
 */
async function captchaLocked(msg, sender) {
  const s = await NTX.store.load();
  const { run } = s;
  if (!sender.tab || sender.tab.id !== run.workTabId) return { ok: false };
  if (run.state === 'paused' && run.pauseReason === 'captcha') return { ok: true };
  if (run.state !== 'running') return { ok: false };

  if (run.currentId && msg.token && msg.token === run.jobToken) {
    if (run.phase === 'captcha') return { ok: true };
    Object.assign(run, {
      phaseBeforeCaptcha: run.phase,
      phase: 'captcha',
      progressText: 'Cochez la case dans l’onglet noTube',
    });
    await NTX.store.save({ run });
    await chrome.alarms.clear(NTX.ALARMS.WATCHDOG); // pas de délai pendant que l'utilisateur vérifie
  } else {
    await NTX.runner.pauseLocked(s, 'captcha');
  }
  NTX_log.warn('Vérification demandée par noTube : en attente de l’utilisateur');
  NTX.notify('ntx-captcha', 'noTube : cochez la case',
    'noTube demande une vérification. Cochez la case dans l’onglet noTube (il vient de passer au premier plan) : '
    + 'la conversion reprendra toute seule. Si la case n’apparaît pas, désactivez votre bloqueur de pub sur notube.lol.', true);
  await NTX.workTab.focus(run.workTabId);
  return { ok: true };
}

async function captchaClearedLocked(msg, sender) {
  const s = await NTX.store.load();
  const { run, settings } = s;
  if (!sender.tab || sender.tab.id !== run.workTabId) return { ok: false };
  chrome.notifications.clear('ntx-captcha');

  // Vérification faite pendant un titre : la même conversion continue.
  if (run.state === 'running' && run.phase === 'captcha' && msg.token && msg.token === run.jobToken) {
    Object.assign(run, { phase: run.phaseBeforeCaptcha || 'converting', phaseBeforeCaptcha: null, progressText: 'Vérification faite, la conversion continue…' });
    await NTX.store.save({ run });
    await chrome.alarms.create(NTX.ALARMS.WATCHDOG, { when: Date.now() + settings.watchdogSec * 1000 });
    NTX_log.info('Vérification faite : la conversion continue');
    return { ok: true };
  }
  // File en pause pour captcha (sans titre en cours) : reprise.
  if (run.state === 'paused' && run.pauseReason === 'captcha') {
    NTX_log.info('Captcha résolu : reprise');
    return NTX.runner.resumeLocked(s);
  }
  return { ok: false };
}
