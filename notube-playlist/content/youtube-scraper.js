/*
 * Lecture d'une playlist YouTube (injecté à la demande dans l'onglet actif).
 *
 * Piège évité : YouTube ne recharge pas la page quand on passe de l'accueil
 * (ou d'une recherche) à une playlist. Les pages précédentes restent dans le
 * document, simplement cachées. On ne lit donc que :
 *   1. la zone de playlist VISIBLE ;
 *   2. les vidéos dont le lien contient « list=<identifiant de la playlist ouverte> ».
 *
 * YouTube ne charge qu'une centaine de vidéos à la fois : on fait défiler
 * jusqu'au bas de la liste et on attend chaque nouveau lot, jusqu'à ce que
 * le nombre d'éléments se stabilise et que l'indicateur « suite » disparaisse.
 *
 * Renvoie { items: [{id, title, channel}], unavailable, duplicates, playlistTitle, listId }.
 */
self.NTX_scrapePlaylist = async function () {
  const Y = self.NTX_CONFIG.youtube;
  const D = self.NTX_DOM;
  const listId = new URL(location.href).searchParams.get('list');
  if (!listId) throw new Error('Cette page n’est pas une playlist (aucun « list= » dans l’adresse).');

  const shown = (el) => el.getClientRects().length > 0; // faux pour les pages cachées par YouTube

  /** Zone de playlist visible. */
  const container = () => {
    for (const sel of Y.container) {
      const c = [...document.querySelectorAll(sel)].find(shown);
      if (c) return c;
    }
    return null;
  };

  /** Identifiants vidéo / playlist d'un élément. */
  const linkInfo = (el) => {
    const a = el.querySelector(Y.link);
    if (!a) return null;
    try {
      const u = new URL(a.getAttribute('href'), location.origin);
      return { id: u.searchParams.get('v'), list: u.searchParams.get('list') };
    } catch (e) {
      return null;
    }
  };

  /** Éléments de la playlist ouverte, et seulement elle. */
  const items = () => {
    const c = container();
    if (!c) return [];
    return D.queryAll(Y.items, c).filter((el) => {
      const info = linkInfo(el);
      return !info || !info.list || info.list === listId; // vidéo sans lien : comptée comme indisponible
    });
  };

  await D.waitFor(() => items().length > 0 || null, 20000, 'vidéos de la playlist')
    .catch(() => { throw new Error('Aucune vidéo de cette playlist trouvée. Attendez la fin du chargement de la page puis réessayez.'); });

  // Défilement progressif jusqu'à stabilisation.
  const start = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - start < Y.maxScrapeMs) {
    const list = items();
    const n = list.length;
    const c = container();
    const cont = c && D.query(Y.continuation, c);
    if (n === last) {
      stable++;
      if (!cont || stable >= 3) break;
    } else {
      stable = 0;
    }
    last = n;
    (cont || list[n - 1] || document.body).scrollIntoView({ block: 'end' });
    await D.waitFor(() => items().length > n || null, Y.loadWaitMs).catch(() => {});
  }

  // L'utilisateur a changé de page pendant la lecture : on refuse plutôt que de mélanger.
  if (new URL(location.href).searchParams.get('list') !== listId) {
    throw new Error('La page a changé pendant la lecture de la playlist. Réessayez sans quitter la page.');
  }

  // Extraction : identifiant, titre et chaîne, sans doublons ni vidéos indisponibles.
  const textOf = (el, sels) => {
    for (const sel of sels) {
      const t = el.querySelector(sel);
      const v = t && (t.getAttribute('title') || t.textContent || '').trim();
      if (v) return v;
    }
    return '';
  };
  const seen = new Set();
  const out = [];
  let unavailable = 0;
  let duplicates = 0;
  for (const el of items()) {
    const info = linkInfo(el);
    const id = info && info.id;
    if (!NTX.util.isVideoId(id)) { unavailable++; continue; }
    const title = textOf(el, Y.title);
    if (Y.unavailableTitles.some((r) => r.test(NTX.util.normalize(title)))) { unavailable++; continue; }
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id);
    out.push({ id, title: title || id, channel: textOf(el, Y.channel) });
  }

  return {
    items: out,
    unavailable,
    duplicates,
    listId,
    playlistTitle: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/i, '').trim(),
  };
};
