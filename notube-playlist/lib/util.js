/*
 * Petites fonctions utilitaires partagées par le service worker et les pages.
 */
self.NTX = self.NTX || {};

NTX.util = {
  /** Texte en minuscules, sans accents ni espaces superflus (comparaisons robustes). */
  normalize(s) {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  },

  /** Nom de fichier sûr pour Windows / macOS / Linux et accepté par chrome.downloads. */
  sanitizeFilename(name, maxLen = 150) {
    let s = String(name ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')                        // caractères de contrôle
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '') // caractères invisibles / bidi
      .replace(/\s*[/\\]\s*/g, '-')                                  // « AC/DC » -> « AC-DC »
      .replace(/[<>:"|?*~]/g, ' ')                                   // autres caractères interdits
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s-]+|[.\s]+$/g, '');                             // points / espaces aux bords
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s; // noms réservés Windows
    if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[.\s]+$/, '');
    return s || 'sans-titre';
  },

  /** Sous-dossier relatif au dossier Téléchargements (jamais de « .. »). */
  sanitizeFolder(path) {
    return String(path ?? '')
      .split(/[\\/]+/)
      .map((p) => p.trim())
      .filter((p) => p && p !== '.' && p !== '..')
      .map((p) => NTX.util.sanitizeFilename(p, 60))
      .join('/');
  },

  /**
   * Nom de la musique à partir du titre YouTube : retire « (Clip Officiel) »,
   * « [Official Video] », « - Lyrics »… (règles dans config/notube-config.js).
   */
  cleanTitle(raw) {
    const rules = (self.NTX_CONFIG && NTX_CONFIG.naming && NTX_CONFIG.naming.titleCleanup) || [];
    let s = String(raw || '');
    for (const re of rules) s = s.replace(re, '');
    s = s.replace(/\s{2,}/g, ' ').replace(/[\s\-–—|:]+$/, '').trim();
    return s || String(raw || '').trim();
  },

  /**
   * Titre et artiste pour les étiquettes du MP3.
   * « SDM - BOLIDE ALLEMAND (Clip Officiel) » -> { artist: 'SDM', title: 'BOLIDE ALLEMAND' }
   * Sans « Artiste - » dans le titre, l'artiste est le nom de la chaîne nettoyé
   * (« SDM - Topic » -> « SDM »).
   */
  trackMeta(item) {
    const N = (self.NTX_CONFIG && NTX_CONFIG.naming) || {};
    const title = NTX.util.cleanTitle(item.title);
    const m = N.artistSeparator && title.match(N.artistSeparator);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    let artist = String(item.channel || '');
    for (const re of N.channelCleanup || []) artist = artist.replace(re, '');
    return { artist: artist.trim(), title };
  },

  /** Lien officiel canonique d'une vidéo. */
  canonicalUrl(id) {
    return 'https://www.youtube.com/watch?v=' + id;
  },

  isVideoId(id) {
    return /^[A-Za-z0-9_-]{11}$/.test(String(id || ''));
  },

  randomBetween(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.random() * (hi - lo);
  },

  token() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  },

  /** Durée lisible : « 1 h 05 min », « 4 min 12 s », « 9 s ». */
  formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m) return `${m} min ${String(sec).padStart(2, '0')} s`;
    return `${sec} s`;
  },

  formatTime(ts) {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  },
};
