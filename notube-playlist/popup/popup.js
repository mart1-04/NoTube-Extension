/*
 * Popup : une phrase d'état claire, le titre en cours, la progression,
 * un seul bouton principal (Démarrer / Mettre en pause / Reprendre).
 * La page est construite une fois ; on ne met à jour que les textes
 * (pas de clignotement, la liste d'erreurs garde sa position).
 */
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const fmt = (ms) => NTX.util.formatDuration(ms);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const PLAYLIST_RE = /^https:\/\/(www\.|m\.)?youtube\.com\/playlist\?(.*&)?list=/i;

let cache = null;        // dernier état lu
let errorsSig = '';      // pour ne redessiner la liste d'erreurs que si elle change
let activeTab = null;    // onglet actif (pour savoir si c'est une playlist)
let fetchMsg = null;     // { text, kind } : retour du dernier ajout

/* ---------- Textes de l'état ---------- */

function describeStatus(run, counts, waitMs) {
  if (run.state === 'paused') {
    switch (run.pauseReason) {
      case 'captcha':
        return { cls: 'alert', title: 'Vérification demandée', detail: 'Résolvez le captcha dans l’onglet noTube. La file reprendra toute seule.' };
      case 'offline':
        return { cls: 'paused', title: 'Connexion perdue', detail: 'Reprise automatique dès le retour d’Internet.' };
      case 'restart':
        return { cls: 'paused', title: 'En pause', detail: 'Chrome a été redémarré. Cliquez sur Reprendre pour continuer.' };
      default:
        return { cls: 'paused', title: 'En pause', detail: `${plural(counts.pending, 'titre restant', 'titres restants')}.` };
    }
  }

  if (run.state === 'running') {
    if (run.currentId && run.phase === 'captcha') {
      return { cls: 'alert', title: 'Cochez la case dans l’onglet noTube', detail: 'noTube demande une vérification. La conversion reprendra toute seule. Si la case n’apparaît pas, désactivez votre bloqueur de pub sur notube.lol.' };
    }
    if (run.currentId) return { cls: 'running', title: 'Téléchargement en cours', detail: '' };
    const status = run.statusText || '';
    if (/^Limite/.test(status)) {
      return { cls: 'paused', title: 'Limite noTube atteinte', detail: `Pause imposée par noTube. Reprise automatique à ${NTX.util.formatTime(run.nextAt)} (dans ${fmt(waitMs)}).` };
    }
    if (/^Plafond/.test(status)) {
      return { cls: 'waiting', title: 'Plafond horaire atteint', detail: `Reprise à ${NTX.util.formatTime(run.nextAt)} (dans ${fmt(waitMs)}).` };
    }
    return { cls: 'waiting', title: 'En cours', detail: waitMs ? `Prochain titre dans ${fmt(waitMs)}` : 'Préparation du titre suivant…' };
  }

  // Arrêté
  if (counts.total === 0) return { cls: 'idle', title: 'File vide', detail: 'Ouvrez une playlist YouTube, puis ajoutez-la ci-dessous.' };
  if (counts.pending === 0) {
    return {
      cls: 'done',
      title: 'Terminé',
      detail: counts.errors
        ? `${plural(counts.done, 'titre téléchargé', 'titres téléchargés')}, ${plural(counts.errors, 'erreur', 'erreurs')}.`
        : `${plural(counts.done, 'titre téléchargé', 'titres téléchargés')} dans le dossier ${cache.settings.folder || 'Musique'}.`,
    };
  }
  return { cls: 'idle', title: 'Prêt', detail: `${plural(counts.pending, 'titre à télécharger', 'titres à télécharger')}.` };
}

/** Étape du titre en cours, en clair (au lieu des messages bruts de noTube). */
function describeStep(run, item) {
  const raw = run.progressText || '';
  const pct = (raw.match(/(\d{1,3})\s*%/) || [])[1];
  const wait = (raw.match(/patienter\s+(\d+)/i) || [])[1];
  let text;
  let percent = null;
  switch (run.phase) {
    case 'loading':
      text = 'Ouverture de noTube…';
      break;
    case 'converting':
      if (wait) text = `File d’attente noTube : ${wait} s`;
      else if (pct && Number(pct) > 0) { text = `Conversion en MP3 : ${pct} %`; percent = Number(pct); }
      else text = 'Envoi de la vidéo à noTube…';
      break;
    case 'awaiting-click':
      text = 'Ouverture du fichier…';
      break;
    case 'captcha':
      text = 'En attente de votre vérification (case à cocher)…';
      break;
    case 'fetching':
      text = 'Téléchargement et étiquetage du fichier…';
      break;
    case 'downloading':
      text = 'Enregistrement du fichier…';
      percent = 100;
      break;
    default:
      text = 'Préparation…';
  }
  if (item && item.attempts > 1) text += ` · essai ${item.attempts}/${cache.settings.maxAttempts || 3}`;
  return { text, percent };
}

/* ---------- Affichage ---------- */

async function render() {
  const r = await chrome.storage.local.get(['run', 'queue', 'settings', 'fetchStatus']);
  const run = r.run || { state: 'stopped' };
  const queue = r.queue || [];
  const settings = r.settings || {};
  cache = { run, queue, settings };

  const errors = queue.filter((i) => i.status === 'error');
  const counts = {
    total: queue.length,
    done: queue.filter((i) => i.status === 'done').length,
    errors: errors.length,
    pending: queue.filter((i) => i.status === 'pending' || i.status === 'running').length,
  };
  const waitMs = run.state === 'running' && !run.currentId && run.nextAt ? Math.max(0, run.nextAt - Date.now()) : 0;

  // État
  const st = describeStatus(run, counts, waitMs);
  $('status').className = 'status ' + st.cls;
  $('status-title').textContent = st.title;
  $('status-detail').textContent = st.detail;

  // Titre en cours
  const cur = queue.find((i) => i.id === run.currentId);
  $('now').hidden = !cur;
  if (cur) {
    const step = describeStep(run, cur);
    $('now-title').textContent = cur.title;
    $('now-title').title = cur.title;
    $('now-step').textContent = step.text;
    const bar = $('now-bar');
    bar.classList.toggle('indeterminate', step.percent == null);
    bar.style.width = step.percent == null ? '' : step.percent + '%';
  }

  // Progression (masquée tant que la file est vide)
  const empty = counts.total === 0;
  $('progress').hidden = empty;
  $('main-action').hidden = empty;
  $('btn-fetch').className = empty ? 'btn primary' : 'btn';
  const finished = counts.done + counts.errors;
  $('progress-count').textContent = counts.total ? `${finished} / ${plural(counts.total, 'titre', 'titres')}` : 'Aucun titre';
  $('bar-done').style.width = counts.total ? (counts.done / counts.total) * 100 + '%' : '0';
  $('bar-error').style.width = counts.total ? (counts.errors / counts.total) * 100 + '%' : '0';
  $('c-done').textContent = counts.done;
  $('c-pending').textContent = counts.pending;
  $('c-error').textContent = counts.errors;
  $('eta').textContent = counts.pending && run.state !== 'stopped'
    ? `≈ ${fmt(waitMs + estimate(run, settings, counts.pending))} restantes`
    : '';

  // Bouton principal
  const main = $('main-action');
  if (run.state === 'running') {
    main.textContent = 'Mettre en pause';
    main.dataset.action = 'pause';
    main.className = 'btn primary big secondary-look';
    main.disabled = false;
  } else if (run.state === 'paused') {
    main.textContent = 'Reprendre';
    main.dataset.action = 'resume';
    main.className = 'btn primary big';
    main.disabled = false;
  } else {
    main.textContent = counts.pending ? `Démarrer (${plural(counts.pending, 'titre', 'titres')})` : 'Démarrer';
    main.dataset.action = 'start';
    main.className = 'btn primary big';
    main.disabled = counts.pending === 0;
  }

  // Ajout de playlist
  const fs = r.fetchStatus;
  const fetching = !!(fs && fs.running && Date.now() - fs.at < 10 * 60e3);
  const isPlaylist = !!(activeTab && PLAYLIST_RE.test(activeTab.url || ''));
  const btn = $('btn-fetch');
  btn.disabled = fetching || !isPlaylist;
  btn.textContent = fetching ? 'Lecture de la playlist…' : 'Ajouter la playlist de cet onglet';
  if (fetching) setHint('La page défile jusqu’en bas pour tout charger. Vous pouvez fermer cette fenêtre.', '');
  else if (fetchMsg) setHint(fetchMsg.text, fetchMsg.kind);
  else if (fs && fs.text && Date.now() - fs.at < 120e3) setHint(fs.text, /^Échec/.test(fs.text) ? 'err' : 'ok');
  else if (!isPlaylist) setHint('Ouvrez d’abord la page d’une playlist : youtube.com/playlist?list=…', '');
  else setHint('', '');

  // Erreurs (redessinées seulement si la liste change)
  $('errors-box').hidden = errors.length === 0;
  $('errors-summary').textContent = plural(errors.length, 'titre en erreur', 'titres en erreur');
  const sig = errors.map((e) => e.id + e.error).join('|');
  if (sig !== errorsSig) {
    errorsSig = sig;
    const ul = $('errors');
    ul.textContent = '';
    for (const it of errors) {
      const li = document.createElement('li');
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = it.title;
      t.title = it.title;
      const why = document.createElement('div');
      why.className = 'r';
      why.textContent = it.error || 'Erreur inconnue';
      li.append(t, why);
      ul.append(li);
    }
  }

  $('btn-clear').disabled = counts.total === 0;
}

function setHint(text, kind) {
  const hint = $('fetch-hint');
  hint.textContent = text;
  hint.className = 'hint ' + kind;
}

/** Durée restante : durée moyenne d'un titre + pause moyenne, bornée par le plafond horaire. */
function estimate(run, settings, remaining) {
  const d = run.durations && run.durations.length ? run.durations.reduce((a, b) => a + b, 0) / run.durations.length : 30000;
  const pause = (((settings.pauseMinSec || 6) + (settings.pauseMaxSec || 15)) / 2) * 1000;
  const perItem = Math.max(d + pause, 3600e3 / (settings.maxPerHour || 10));
  return remaining * perItem;
}

/* ---------- Actions ---------- */

$('main-action').addEventListener('click', async (e) => {
  const action = e.currentTarget.dataset.action;
  e.currentTarget.disabled = true;
  await send({ type: 'ntx:' + action });
  render();
});

$('btn-fetch').addEventListener('click', async () => {
  if (!activeTab) return;
  fetchMsg = null;
  $('btn-fetch').disabled = true;
  const res = await send({ type: 'ntx:fetch-playlist', tabId: activeTab.id });
  if (res && res.ok) {
    fetchMsg = {
      kind: 'ok',
      text: res.added
        ? plural(res.added, 'titre ajouté', 'titres ajoutés') + (res.duplicates ? ` (${res.duplicates} déjà dans la file)` : '') + '.'
        : `Aucun nouveau titre : ${plural(res.found, 'titre est', 'titres sont')} déjà dans la file.`,
    };
  } else {
    fetchMsg = { kind: 'err', text: (res && res.error) || 'La lecture de la playlist a échoué.' };
  }
  render();
});

$('btn-retry').addEventListener('click', () => send({ type: 'ntx:retry-errors' }));

$('btn-clear').addEventListener('click', () => {
  if (confirm('Vider toute la file ? Les fichiers déjà téléchargés restent sur votre ordinateur.')) {
    send({ type: 'ntx:clear' });
  }
});

$('btn-export').addEventListener('click', () => {
  if (!cache) return;
  const errors = cache.queue.filter((i) => i.status === 'error');
  const lines = [
    `Titres en erreur – NoTube Playlist – ${new Date().toLocaleString('fr-FR')}`,
    '',
    ...errors.map((i) => `${i.title}\n  ${i.url || NTX.util.canonicalUrl(i.id)}\n  Raison : ${i.error || 'inconnue'} (${i.attempts} essai(s))\n`),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `erreurs-notube-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

/* ---------- Démarrage ---------- */

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  activeTab = tab || null;
  render();
});
chrome.storage.onChanged.addListener(render);
setInterval(render, 1000); // comptes à rebours
render();
