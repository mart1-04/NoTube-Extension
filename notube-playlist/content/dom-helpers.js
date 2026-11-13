/*
 * Outils DOM pour les scripts de contenu (noTube et YouTube) :
 * recherche d'éléments par sélecteurs ou par texte visible, attente par
 * détection (jamais de pause fixe), saisie et clics « réalistes ».
 */
self.NTX_DOM = (function () {
  const norm = (s) => NTX.util.normalize(s);

  /** Premier élément trouvé par la liste de sélecteurs (essayés dans l'ordre). */
  function query(selectors, root = document) {
    for (const sel of [].concat(selectors)) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (e) {
        /* sélecteur invalide : on passe au suivant */
      }
    }
    return null;
  }

  /** Tous les éléments du premier sélecteur qui trouve quelque chose. */
  function queryAll(selectors, root = document) {
    for (const sel of [].concat(selectors)) {
      try {
        const list = root.querySelectorAll(sel);
        if (list.length) return [...list];
      } catch (e) {
        /* ignoré */
      }
    }
    return [];
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function textOf(el) {
    return norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '');
  }

  /**
   * Élément visible dont le texte correspond (insensible à la casse et aux accents).
   * Les correspondances exactes passent avant les correspondances partielles ;
   * les mots courts (« ok ») ne sont acceptés qu'en correspondance exacte.
   */
  function findByText(texts, { root = document, roles = 'button, a, [role="button"], input[type="submit"], input[type="button"]' } = {}) {
    const wanted = [].concat(texts).map(norm);
    const cands = [...root.querySelectorAll(roles)].filter(isVisible);
    for (const w of wanted) {
      const exact = cands.find((el) => textOf(el) === w);
      if (exact) return exact;
    }
    for (const w of wanted) {
      if (w.length <= 3) continue;
      const partial = cands.find((el) => textOf(el).startsWith(w));
      if (partial) return partial;
    }
    return null;
  }

  /**
   * Attend que fn() renvoie une valeur « vraie » (détection par
   * MutationObserver, avec une vérification de secours toutes les 500 ms).
   * Rejette avec un message clair après timeoutMs.
   */
  function waitFor(fn, timeoutMs, label = 'élément') {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, val) => {
        if (done) return;
        done = true;
        obs.disconnect();
        clearInterval(iv);
        clearTimeout(to);
        ok ? resolve(val) : reject(new Error(`Délai dépassé (${Math.round(timeoutMs / 1000)} s) : ${label}`));
      };
      const check = () => {
        try {
          const v = fn();
          if (v) finish(true, v);
        } catch (e) {
          /* page en cours de modification */
        }
      };
      const obs = new MutationObserver(check);
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      const iv = setInterval(check, 500);
      const to = setTimeout(() => finish(false), timeoutMs);
      check();
    });
  }

  /** Saisie visible par le framework de la page (setter natif + événements). */
  function setInputValue(input, value) {
    input.focus();
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Clic complet : pointeur + souris, puis activation native de l'élément. */
  function realClick(el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  /** Renvoie la raison si un captcha / une vérification est visible, sinon null. */
  function detectCaptcha(cfg) {
    for (const sel of cfg.selectors) {
      // Pas de test de taille : un widget Turnstile peut mesurer 0 px de haut tant qu'il se dessine.
      // On exige seulement qu'il soit dans une partie affichée de la page (pas display:none).
      const el = [...document.querySelectorAll(sel)].find((e) => (e.type === 'hidden' ? e.parentElement : e)?.getClientRects().length);
      if (el) return `élément ${sel}`;
    }
    const title = norm(document.title);
    const t = cfg.titles.find((x) => title.includes(x));
    if (t) return `titre « ${t} »`;
    const body = norm(((document.body && document.body.innerText) || '').slice(0, 20000));
    const hit = cfg.texts.find((x) => body.includes(x));
    if (hit) return `texte « ${hit} »`;
    return null;
  }

  /** Masque les fenêtres gênantes et ferme celles qui ont un bouton de fermeture. */
  function cleanOverlays(cfg) {
    for (const sel of cfg.hide) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.style.getPropertyValue('display') !== 'none') el.style.setProperty('display', 'none', 'important');
      });
    }
    for (const sel of cfg.closeButtons) {
      document.querySelectorAll(sel).forEach((b) => {
        if (isVisible(b)) b.click();
      });
    }
  }

  return { query, queryAll, isVisible, findByText, waitFor, setInputValue, realClick, detectCaptcha, cleanOverlays };
})();
