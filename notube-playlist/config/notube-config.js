/*
 * ============================================================================
 *  CONFIGURATION DES SITES : le SEUL fichier à modifier si noTube ou YouTube
 *  changent leur interface.
 * ============================================================================
 *
 *  - Chaque liste de sélecteurs est essayée dans l'ordre : le premier qui
 *    trouve un élément gagne. Mettez le plus fiable en premier.
 *  - Les textes (boutons, messages) sont comparés sans tenir compte des
 *    majuscules ni des accents : écrivez-les en minuscules sans accents.
 *  - Ce fichier est chargé à la fois par le service worker et par les scripts
 *    de contenu : n'y mettez que des données (pas d'appel à chrome.*).
 *
 *  Relevé effectué le 12/11/2026 sur https://notube.lol/fr/youtube-app-457
 *  et sur une page de playlist YouTube (nouvelle interface « lockup »).
 */
self.NTX_CONFIG = {
  notube: {
    // Page du convertisseur chargée pour chaque titre.
    // Si noTube change de domaine, modifiez AUSSI "matches" dans manifest.json.
    converterUrl: 'https://notube.lol/fr/youtube-app-457',

    // Reconnaissance des pages par leur adresse (testé sur pathname + search).
    pages: {
      converter: /\/youtube-app/i,
      download: /\/download\?token=/i,             // page « Votre fichier est prêt »
      errorPage: /\/downloads\?token=.*error=(\d+)/i, // échec signalé par noTube
      // Quota atteint, ex. /fr/plus-457?feature=limitation (« veuillez patienter 2 heures »)
      limit: /\/plus(?:-\d+)?\?(?:.*&)?feature=(limitation|unlimited)/i,
      tooLong: /\/plus(?:-\d+)?\?(?:.*&)?feature=duration/i, // vidéo trop longue (version gratuite)
      plusOther: /\/plus(?:-\d+)?(\?|$)/i,          // autre page « Plus » (fonction payante)
    },

    // Durée d'attente annoncée sur la page de limite. Groupes : nombre, unité.
    limitWaitPattern: /(?:patienter|wait)\s+(\d+)\s*(heure|hour|minute|min)/i,

    selectors: {
      form: ['#form1', 'form.page-title-search'],
      urlInput: ['#keyword', 'form.page-title-search input[type="search"]', 'input[name="keyword"]'],
      formatSelect: ['#myDropdown', 'select[aria-label="Format"]'],
      // Bouton « OK » : désactivé tant que noTube n'a pas choisi son serveur.
      submitButton: ['#submit-button', 'form.page-title-search [type="submit"]'],
      statusText: ['.page-title-desc'],   // messages (« Error code 2 », « Veuillez patienter… »)
      // Zone affichée par noTube dès que la conversion démarre (preuve que le clic a marché).
      conversionStarted: ['#download', '#progressBarDownload'],
      progressText: ['.page-title h1'],   // pourcentage
      downloadButton: ['#downloadButton', 'a[href*="download.php?token="]'],
    },

    // Textes de secours si les sélecteurs ci-dessus ne trouvent rien.
    texts: {
      submit: ['ok', 'convertir', 'convert'],
      download: ['telecharger', 'download'],
    },

    // Message d'erreur affiché dans statusText. Le groupe capture le code.
    errorPattern: /error code\s*(\d+)/i,

    // File d'attente noTube (« Veuillez patienter 13 secondes ») : le watchdog
    // est prolongé d'autant. Le groupe capture le nombre de secondes.
    waitPattern: /(?:patienter|wait)\s+(\d+)\s+sec/i,

    // Lien direct du fichier (bouton Télécharger) : https://sNN.notube.lol/download.php?token=…&key=…
    downloadUrlPattern: /^https:\/\/s\d+\.notube\.[a-z]+\/download\.php\?/i,

    // Fenêtres gênantes de la page elle-même : masquées, ou fermées par leur bouton.
    overlays: {
      hide: ['.cookiealert', '#modal-plus', '#downloadModal'],
      closeButtons: ['.close-plus', '#closeModalPlus', '.close-playlist'],
    },

    // Formats proposés par noTube -> extension du fichier enregistré.
    formatExtensions: { mp3: 'mp3', mp3hd: 'mp3', m4a: 'm4a', wav: 'wav' },
  },

  // Détection de captcha / vérification humaine (sur toute page noTube).
  captcha: {
    selectors: [
      'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
      'iframe[src*="challenges.cloudflare.com"]',
      // Case « Cochez la case » de noTube = Cloudflare Turnstile (vue le 13/11/2026, pendant la conversion).
      // La case est dessinée dans une zone fermée : l'élément compte dès qu'il est dans la page affichée.
      '.cf-turnstile', '[name="cf-turnstile-response"]',
      '.g-recaptcha', '.h-captcha', '#challenge-form', '[data-sitekey]',
      '[data-ntx-fake-captcha]', // captcha simulé (test depuis les options)
    ],
    // Recherchés dans le texte visible de la page.
    texts: [
      'cochez la case', 'check the box',
      'captcha', 'verifiez que vous etes humain', 'verify you are human',
      'je ne suis pas un robot', "i'm not a robot", 'verification de securite',
      'security check',
    ],
    // Champ rempli par Turnstile quand la case a été cochée : la vérification est alors faite.
    solvedWhenFilled: '[name="cf-turnstile-response"]',
    // Recherchés dans le titre de l'onglet (pages de défi Cloudflare).
    titles: ['just a moment', 'attention required'],
  },

  youtube: {
    // Page acceptée pour la récupération : https://www.youtube.com/playlist?list=…
    playlistUrl: /^https:\/\/(www\.|m\.)?youtube\.com\/playlist\?(.*&)?list=/i,
    // Zone de la playlist. ATTENTION : YouTube garde les pages déjà visitées
    // (accueil, recherche…) cachées dans le document. Seule la zone VISIBLE est
    // retenue, et seules les vidéos dont le lien contient « list=<id de la
    // playlist ouverte> » sont gardées.
    container: ['ytd-browse[page-subtype="playlist"]', 'ytd-browse', '#primary'],
    // Un élément par vidéo : nouvelle interface (lockup) puis ancienne.
    items: ['yt-lockup-view-model', 'ytd-playlist-video-renderer'],
    link: 'a[href*="/watch?v="]',
    title: ['h3[title]', '.ytLockupMetadataViewModelTitle', 'a#video-title', '#video-title'],
    // Nom de la chaîne (sert d'artiste quand le titre ne le contient pas).
    channel: [
      'yt-content-metadata-view-model a[href^="/@"]',
      'yt-content-metadata-view-model a[href^="/channel/"]',
      'ytd-channel-name a',
      '#channel-name a',
    ],
    // Présent tant qu'il reste des vidéos à charger en bas de liste.
    continuation: ['yt-continuation-item-view-model', 'ytd-continuation-item-renderer'],
    // Titres des vidéos indisponibles (si YouTube les affiche).
    unavailableTitles: [
      /^\[(private video|deleted video|video privee|video supprimee|video privada|video eliminado|privates video|geloschtes video)\]$/i,
    ],
    loadWaitMs: 6000,     // attente maximale d'un nouveau lot après défilement
    maxScrapeMs: 600000,  // garde-fou : 10 min pour les très longues playlists
  },

  // Nom des fichiers et étiquettes (titre / artiste).
  naming: {
    // Mentions retirées du titre YouTube pour obtenir le nom de la musique.
    // « SDM - BOLIDE ALLEMAND (Clip Officiel) »  ->  « SDM - BOLIDE ALLEMAND »
    titleCleanup: [
      // Parenthèses / crochets contenant une mention vidéo : (Clip officiel), [Official Music Video], (Lyrics)…
      /\s*[([【]\s*[^)\]】]*?\b(clip|official|officiel(?:le)?|video|vid[eé]o|audio|lyrics?|paroles|visuali[sz]er|hd|hq|4k|mv)\b[^)\]】]*[)\]】]/gi,
      // Mention en fin de titre après un tiret ou une barre : « - Clip officiel », « | Official Video »
      /\s*[-–—|]\s*(clip officiel|official (music )?video|vid[eé]o officielle|audio officiel|official audio|lyrics?( video)?|paroles)\s*$/gi,
    ],
    // Nettoyage du nom de chaîne utilisé comme artiste : « SDM - Topic », « SDMVEVO », « SDM Officiel ».
    channelCleanup: [/\s*-\s*topic$/i, /vevo$/i, /\s+(officiel(le)?|official)$/i],
    // Séparateur artiste / titre dans un titre YouTube (« Artiste - Titre »).
    artistSeparator: /^(.+?)\s+[-–—]\s+(.+)$/,
  },

  // Délais maximaux des attentes dans les pages (jamais de pause fixe).
  timing: {
    elementMs: 20000,      // apparition d'un élément
    serverReadyMs: 20000,  // bouton OK activé (choix du serveur noTube)
    submitConfirmMs: 8000, // délai pour voir noTube réagir à un clic sur OK
    maxSubmits: 3,         // clics sur OK avant de passer par le lien de secours ?v=
    clickWaitMs: 10000,    // mode clic : délai avant de considérer le clic comme raté
    maxClicks: 3,          // mode clic : nombre de clics maximal sur « Télécharger »
  },
};
