/*
 * Pilote des pages noTube (script de contenu).
 *
 * À chaque chargement de page noTube, il demande au service worker s'il
 * s'agit de l'onglet de travail. Si oui, il fait l'étape correspondant à la
 * page : saisie + conversion, ou lecture du lien de téléchargement, ou
 * signalement d'une erreur / d'une limite / d'un captcha.
 * Ailleurs (navigation normale sur noTube), il ne fait rien.
 */
(function () {
  if (window.__ntxDriverLoaded) return;
  window.__ntxDriverLoaded = true;

  const C = self.NTX_CONFIG;
  const N = C.notube;
  const T = C.timing;
  const D = self.NTX_DOM;
  const log = self.NTX_log;

  let finished = false; // un seul résultat par page
  let captchaReported = false;

  const send = (msg) =>
    chrome.runtime.sendMessage(msg).catch((e) => {
      log.warn('Message non remis au service worker :', e.message);
      return null;
    });

  main().catch((e) => log.error('Pilote noTube :', e));

  async function main() {
    const job = await send({ type: 'ntx:hello', url: location.href });
    if (!job) return;
    if (job.watchCaptcha) {
      watchCaptchaCleared();
      return;
    }
    if (!job.active) return;

    log.info('Page noTube prise en charge :', location.pathname, '–', job.title);
    startOverlayCleaner();
    if (job.simulateCaptcha) injectFakeCaptcha();
    // Vérification déjà affichée au chargement : on attend que l'utilisateur la fasse, puis on continue.
    if (checkCaptcha(job)) await captchaGone(job);
    startCaptchaWatch(job);

    const where = location.pathname + location.search;
    const P = N.pages;
    try {
      if (P.limit.test(where)) {
        // Lecture de la durée annoncée (« veuillez patienter 2 heures »).
        const body = (document.body && document.body.innerText) || '';
        const w = body.match(N.limitWaitPattern);
        const waitMs = w ? Number(w[1]) * (/^h/i.test(w[2]) ? 3600e3 : 60e3) : 0;
        return fail(job, 'Limite gratuite noTube atteinte' + (w ? ` (attente annoncée : ${w[1]} ${w[2]})` : ''), 'limit', waitMs);
      }
      if (P.tooLong.test(where)) return fail(job, 'Vidéo trop longue pour la version gratuite de noTube', 'fatal');
      if (P.plusOther.test(where)) return fail(job, 'noTube demande l’abonnement Plus : ' + location.search);
      const m = where.match(P.errorPage);
      if (m) return fail(job, `noTube a renvoyé l’erreur ${m[1]}`);
      if (P.download.test(where)) return await runDownloadPage(job);
      if (P.converter.test(where)) return await runConverter(job);
      return fail(job, 'Page noTube inattendue : ' + location.pathname);
    } catch (e) {
      fail(job, e.message);
    }
  }

  /* ---------------- Page du convertisseur ---------------- */

  async function runConverter(job) {
    progress(job, 'loading', 'Page noTube chargée');
    try {
      localStorage.setItem('defaultformat', job.format); // format mémorisé par noTube
    } catch (e) {
      /* stockage indisponible */
    }

    const input = await D.waitFor(() => D.query(N.selectors.urlInput), T.elementMs, 'champ du lien');

    const select = D.query(N.selectors.formatSelect);
    if (select) {
      if (select.value !== job.format) {
        select.value = job.format;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (select.value !== job.format) throw new Error(`Format « ${job.format} » introuvable sur noTube`);
    }

    // Le bouton OK n'est actif qu'une fois le serveur de conversion choisi.
    const form = D.query(N.selectors.form) || document;
    const readyButton = () => D.waitFor(() => {
      const b = D.query(N.selectors.submitButton) || D.findByText(N.texts.submit, { root: form });
      return b && !b.disabled ? b : null;
    }, T.serverReadyMs, 'bouton de conversion actif');

    // Page ouverte par le lien de secours « ?v=ID » : noTube remplit le champ et lance
    // la conversion lui-même. On lui laisse le temps, et on ne clique que s'il n'a rien fait.
    const isAutoSubmit = new URLSearchParams(location.search).has('v');
    if (isAutoSubmit) {
      log.info('Lien de secours ?v= : attente du lancement automatique par noTube');
      progress(job, 'converting', 'Lancement par le lien de secours noTube…');
      const startedClean = () => conversionStarted() && !N.errorPattern.test(statusText());
      const startedAlone = await D.waitFor(startedClean, T.submitConfirmMs, 'lancement automatique').catch(() => false);
      // Pas lancé, ou « Error code 2 » (noTube a soumis avant d'avoir choisi son serveur) : un clic.
      if (!startedAlone && !finished) {
        D.setInputValue(input, job.url);
        D.realClick(await readyButton());
        await D.waitFor(startedClean, T.submitConfirmMs, 'démarrage de la conversion').catch(() => {});
      }
      watchConversion(job);
      return;
    }

    // Clic vérifié : après chaque clic, on attend la preuve que noTube a démarré
    // (formulaire masqué, zone de progression affichée ou message d'erreur).
    // Sans preuve, on ressaisit le lien et on reclique.
    for (let attempt = 1; attempt <= T.maxSubmits; attempt++) {
      const btn = await readyButton();
      D.setInputValue(input, job.url);
      if (input.value !== job.url) throw new Error('Le champ du lien n’a pas accepté la saisie');
      if (finished) return;
      D.realClick(btn);
      log.info(`Clic sur OK (${attempt}/${T.maxSubmits}) pour`, job.url);
      progress(job, 'converting', attempt === 1 ? 'Conversion lancée…' : `Nouveau clic sur OK (${attempt}/${T.maxSubmits})…`);
      const ok = await D.waitFor(() => conversionStarted(), T.submitConfirmMs, 'démarrage de la conversion').catch(() => false);
      if (ok) {
        watchConversion(job);
        return;
      }
      log.warn('Le clic n’a pas été pris en compte par noTube');
    }

    // Dernier recours : le lien « ?v=ID » de noTube, qui lance la conversion tout seul.
    const id = new URL(job.url).searchParams.get('v');
    log.warn('Clics sans effet : passage par le lien de secours ?v=');
    progress(job, 'converting', 'Clics sans effet : nouvel essai par le lien de secours noTube…');
    const u = new URL(location.href);
    u.searchParams.set('v', id);
    location.href = u.toString();
  }

  function statusText() {
    const st = D.query(N.selectors.statusText);
    return (st && st.innerText) || '';
  }

  /** Vrai dès que noTube a réagi au clic. */
  function conversionStarted() {
    const f = D.query(N.selectors.form);
    const zone = D.query(N.selectors.conversionStarted);
    const status = statusText();
    return (f && !D.isVisible(f)) || (zone && D.isVisible(zone)) || N.errorPattern.test(status) || N.waitPattern.test(status);
  }

  /** Suit l'avancement affiché ; noTube redirige seul vers la page de téléchargement. */
  function watchConversion(job) {
    let lastText = '';
    let lastSent = 0;
    let waitReported = false;
    const check = () => {
      if (finished) return obs.disconnect();
      const st = D.query(N.selectors.statusText);
      const pr = D.query(N.selectors.progressText);
      const status = ((st && st.innerText) || '').trim();
      const pct = ((pr && pr.innerText) || '').trim();
      const m = status.match(N.errorPattern);
      if (m) {
        obs.disconnect();
        fail(job, `noTube : Error code ${m[1]}`);
        return;
      }
      // File d'attente noTube : on la signale une fois pour prolonger le watchdog.
      const w = status.match(N.waitPattern);
      if (w && !waitReported) {
        waitReported = true;
        send({ type: 'ntx:progress', token: job.token, phase: 'converting', text: status.slice(0, 180), waitSec: Number(w[1]) });
      }
      const text = [pct, status].filter(Boolean).join(' – ').slice(0, 180);
      if (text && text !== lastText && Date.now() - lastSent > 1500) {
        lastText = text;
        lastSent = Date.now();
        progress(job, 'converting', text);
      }
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    check();
  }

  /* ---------------- Page « Votre fichier est prêt » ---------------- */

  async function runDownloadPage(job) {
    progress(job, 'converting', 'Conversion terminée, lecture du lien…');
    const btn = await D.waitFor(
      () => D.query(N.selectors.downloadButton) || D.findByText(N.texts.download, { roles: 'a, button' }),
      T.elementMs,
      'bouton Télécharger'
    );
    if (finished) return;

    if (job.mode === 'direct') {
      const href = btn.href || btn.getAttribute('href') || '';
      if (N.downloadUrlPattern.test(href)) {
        finished = true;
        log.info('Lien direct trouvé, téléchargement confié à l’extension');
        await send({ type: 'ntx:download-url', token: job.token, url: href });
        return;
      }
      log.warn('Lien direct inattendu, passage au clic :', href);
    }

    if (job.phase === 'downloading') return;
    finished = true;
    D.realClick(btn);
    log.info('Clic sur « Télécharger »');
    await send({ type: 'ntx:clicked', token: job.token });
  }

  /* ---------------- Captcha ---------------- */

  /** Vérification visible et pas encore faite ? (Turnstile rempli = faite, même si la case reste affichée.) */
  function captchaPending() {
    const solved = C.captcha.solvedWhenFilled && document.querySelector(C.captcha.solvedWhenFilled);
    if (solved && solved.value) return null;
    return D.detectCaptcha(C.captcha);
  }

  /**
   * Captcha / case à cocher détecté : on le signale (l'extension s'arrête sur place,
   * prévient et met l'onglet au premier plan) et on attend que l'utilisateur le fasse.
   * La conversion en cours n'est PAS abandonnée : noTube reprend seul après la case.
   */
  function checkCaptcha(job) {
    if (captchaReported) return true;
    const why = captchaPending();
    if (!why) return false;
    captchaReported = true;
    log.warn('Vérification demandée par noTube :', why);
    send({ type: 'ntx:captcha', token: job.token, reason: why });
    captchaGone(job);
    return true;
  }

  let gonePromise = null;
  /** Se résout quand la vérification a été faite par l'utilisateur. */
  function captchaGone(job) {
    if (!gonePromise) {
      gonePromise = D.waitFor(() => (captchaPending() ? null : true), 24 * 3600e3, 'vérification')
        .then(() => {
          log.info('Vérification faite : la conversion continue');
          captchaReported = false;
          gonePromise = null;
          send({ type: 'ntx:captcha-cleared', token: job.token });
        })
        .catch(() => {});
    }
    return gonePromise;
  }

  /** Surveille l'apparition d'une vérification à tout moment (ex. pendant la conversion). */
  function startCaptchaWatch(job) {
    let pending = false;
    new MutationObserver(() => {
      if (pending || captchaReported) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        checkCaptcha(job);
      }, 500);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /** Attend que l'utilisateur ait résolu la vérification (jusqu'à 24 h). */
  function watchCaptchaCleared() {
    D.waitFor(() => (D.detectCaptcha(C.captcha) ? null : true), 24 * 3600e3, 'résolution du captcha')
      .then(() => {
        log.info('Captcha résolu');
        send({ type: 'ntx:captcha-cleared' });
      })
      .catch(() => {});
  }

  /** Test : faux captcha (bouton « Simuler un captcha » des options). Un clic le « résout ». */
  function injectFakeCaptcha() {
    const div = document.createElement('div');
    div.setAttribute('data-ntx-fake-captcha', '1');
    div.textContent = 'CAPTCHA SIMULÉ (test de l’extension) : cliquez ici pour le « résoudre ».';
    Object.assign(div.style, {
      position: 'fixed', inset: '30% 20% auto 20%', zIndex: 2147483647, padding: '40px',
      background: '#fff3cd', color: '#333', border: '3px solid #d39e00', font: 'bold 18px sans-serif',
      textAlign: 'center', cursor: 'pointer',
    });
    div.addEventListener('click', () => div.remove());
    document.documentElement.appendChild(div);
  }

  /* ---------------- Divers ---------------- */

  function startOverlayCleaner() {
    let pending = false;
    const run = () => {
      pending = false;
      D.cleanOverlays(N.overlays);
    };
    run();
    new MutationObserver(() => {
      if (!pending) {
        pending = true;
        setTimeout(run, 300);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  function progress(job, phase, text) {
    send({ type: 'ntx:progress', token: job.token, phase, text });
  }

  function fail(job, reason, kind, waitMs) {
    if (finished) return;
    finished = true;
    log.warn('Échec signalé :', reason);
    send({ type: 'ntx:fail', token: job.token, reason, kind, waitMs });
  }
})();
