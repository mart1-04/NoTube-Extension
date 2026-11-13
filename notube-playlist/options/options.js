/*
 * Page d'options : lecture, validation et enregistrement des réglages.
 */
const FIELDS = {
  folder: 'text',
  format: 'text',
  minSizeKb: 'number',
  downloadMode: 'text',
  cleanTitles: 'bool',
  writeTags: 'bool',
  pauseMinSec: 'number',
  pauseMaxSec: 'number',
  maxPerHour: 'number',
  limitPauseMin: 'number',
  maxAttempts: 'number',
  watchdogSec: 'number',
  downloadTimeoutSec: 'number',
  alertAfterFailures: 'number',
  debug: 'bool',
};

const $ = (id) => document.getElementById(id);
const msg = (t) => {
  $('msg').textContent = t;
  setTimeout(() => ($('msg').textContent = ''), 4000);
};

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  fill({ ...NTX.DEFAULT_SETTINGS, ...(settings || {}) });
}

function fill(s) {
  for (const [k, type] of Object.entries(FIELDS)) {
    if (type === 'bool') $(k).checked = !!s[k];
    else $(k).value = s[k];
  }
}

function read() {
  const out = {};
  for (const [k, type] of Object.entries(FIELDS)) {
    if (type === 'bool') out[k] = $(k).checked;
    else if (type === 'number') out[k] = Number($(k).value);
    else out[k] = $(k).value.trim();
  }
  return out;
}

function validate(s) {
  for (const [k, type] of Object.entries(FIELDS)) {
    if (type === 'number' && (!Number.isFinite(s[k]) || s[k] < 0)) return `Valeur invalide : ${k}`;
  }
  if (s.pauseMinSec > s.pauseMaxSec) return 'La pause minimale doit être inférieure ou égale à la pause maximale.';
  if (s.maxPerHour < 1) return 'Le plafond horaire doit être d’au moins 1 titre.';
  if (s.maxAttempts < 1) return 'Il faut au moins 1 essai par titre.';
  if (s.watchdogSec < 30) return 'Le délai de conversion doit être d’au moins 30 s.';
  s.folder = NTX.util.sanitizeFolder(s.folder);
  return null;
}

$('save').addEventListener('click', async () => {
  const s = read();
  const err = validate(s);
  if (err) return msg(err);
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...NTX.DEFAULT_SETTINGS, ...(settings || {}), ...s } });
  fill({ ...NTX.DEFAULT_SETTINGS, ...(settings || {}), ...s });
  msg('Réglages enregistrés.');
});

$('reset').addEventListener('click', () => {
  fill(NTX.DEFAULT_SETTINGS);
  msg('Valeurs par défaut affichées : cliquez sur Enregistrer pour les appliquer.');
});

$('simulate').addEventListener('click', async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...NTX.DEFAULT_SETTINGS, ...(settings || {}), simulateCaptchaOnce: true } });
  msg('Un faux captcha apparaîtra sur la prochaine page noTube du prochain titre.');
});

load();
