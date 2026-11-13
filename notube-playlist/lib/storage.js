/*
 * Stockage persistant (chrome.storage.local) : rien d'important n'est gardé
 * en mémoire, car le service worker MV3 est endormi régulièrement.
 *
 * Trois clés :
 *  - settings : réglages (page d'options)
 *  - queue    : la file  [{ id, title, status, attempts, error, addedAt, updatedAt, ... }]
 *  - run      : l'état de l'automate (en marche / en pause, titre en cours, etc.)
 *
 * Statuts d'un élément : 'pending' (en attente), 'running' (en cours),
 * 'done' (terminé), 'error' (abandonné après le nombre d'essais maximal).
 */
self.NTX = self.NTX || {};

NTX.DEFAULT_SETTINGS = {
  folder: 'Musique',        // sous-dossier de Téléchargements
  format: 'mp3',            // format noTube
  pauseMinSec: 6,           // pause aléatoire entre deux titres
  pauseMaxSec: 15,
  maxPerHour: 10,           // plafond de débit (noTube gratuit a bloqué après ~25 titres en 40 min)
  maxAttempts: 3,           // essais par titre
  watchdogSec: 90,          // délai max pour la conversion d'un titre
  downloadTimeoutSec: 300,  // délai max pour le téléchargement du fichier
  minSizeKb: 50,            // en dessous : fichier considéré comme raté
  limitPauseMin: 120,       // pause après une limite noTube si sa durée n'est pas lisible
  alertAfterFailures: 3,    // notification après N échecs consécutifs
  downloadMode: 'direct',   // 'direct' (lien du bouton) ou 'click' (clic sur le bouton)
  cleanTitles: true,        // nom du fichier = titre nettoyé (sans « (Clip Officiel) »…)
  writeTags: true,          // écrire titre et artiste dans le MP3
  debug: true,              // journal détaillé dans la console
  simulateCaptchaOnce: false, // test : simule un captcha au prochain titre
};

NTX.DEFAULT_RUN = {
  state: 'stopped',         // 'stopped' | 'running' | 'paused'
  pauseReason: null,        // 'manual' | 'captcha' | 'offline' | 'restart'
  currentId: null,          // identifiant vidéo en cours
  jobToken: null,           // jeton du travail en cours (ignore les messages périmés)
  phase: null,              // 'loading' | 'converting' | 'awaiting-click' | 'downloading'
  workTabId: null,          // onglet de travail noTube
  downloadId: null,         // téléchargement associé au titre en cours (remis à zéro à chaque titre)
  expectedFilename: null,   // chemin voulu pour ce téléchargement (« Musique/Titre.mp3 »)
  jobStartedAt: null,
  dlStartedAt: null,
  clickAt: null,
  clickAttempts: 0,
  lastBytes: 0,
  nextAt: null,             // date du prochain titre
  consecutiveFailures: 0,
  startsLog: [],            // dates de début des titres de la dernière heure (plafond)
  durations: [],            // durées des derniers titres réussis (estimation)
  progressText: '',
  statusText: '',
};

NTX.store = {
  /** Charge tout l'état, complété par les valeurs par défaut. */
  async load() {
    const r = await chrome.storage.local.get(['settings', 'run', 'queue']);
    return {
      settings: { ...NTX.DEFAULT_SETTINGS, ...(r.settings || {}) },
      run: { ...NTX.DEFAULT_RUN, ...(r.run || {}) },
      queue: Array.isArray(r.queue) ? r.queue : [],
    };
  },

  async save(obj) {
    await chrome.storage.local.set(obj);
  },
};

/*
 * Exécution exclusive : les événements (messages, alarmes, téléchargements…)
 * peuvent arriver en même temps ; on les traite un par un pour ne jamais
 * écraser l'état. Ne JAMAIS appeler NTX.exclusive à l'intérieur d'une
 * fonction déjà exclusive (blocage).
 */
(function () {
  let chain = Promise.resolve();
  NTX.exclusive = function (fn) {
    const next = chain.then(() => fn());
    chain = next.catch((e) => self.NTX_log && NTX_log.error('Erreur interne :', e));
    return next;
  };
})();
