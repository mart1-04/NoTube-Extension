# NoTube Playlist MP3 : extension Chrome personnelle

Extension Chrome (Manifest V3) **à usage strictement personnel**, chargée en mode développeur et jamais publiée.
Elle lit une playlist YouTube ouverte dans l'onglet actif, puis envoie ses vidéos **une par une** à noTube
(`https://notube.lol`) pour en télécharger l'audio en MP3. Les fichiers sont rangés dans `Téléchargements/Musique`.

> ⚠️ **À lire avant tout : limite gratuite de noTube.** Pendant les tests du 12/11/2026, noTube a bloqué la
> conversion après environ 25 titres en 40 minutes, avec le message : *« Vous avez atteint la limite de
> téléchargement de fichiers, veuillez patienter 2 heures ou souscrire à noTube Plus »*. L'extension détecte
> cette page, met la file en pause pendant la durée annoncée puis reprend seule, mais **le débit réel en
> version gratuite est donc bien inférieur à « plusieurs dizaines par heure »**. Voir « Limites connues ».

---

## 1. Installation

1. Ouvrez `chrome://extensions`.
2. Activez le **Mode développeur** (interrupteur en haut à droite).
3. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `notube-playlist`
   (celui qui contient `manifest.json`).
4. Épinglez l'icône (pièce de puzzle, puis punaise) pour accéder facilement à la popup.
5. **Important** : dans `chrome://settings/downloads`, désactivez
   « Toujours demander où enregistrer les fichiers ». Sinon Chrome ouvrira une fenêtre pour chaque titre.

## 2. Utilisation

1. Ouvrez la page de votre playlist : `https://www.youtube.com/playlist?list=…`
   (cela marche aussi avec « À regarder plus tard » `list=WL` et les playlists privées, puisque vous êtes connecté).
   Une page `watch?v=…&list=…` ne suffit pas : ouvrez la page de la playlist elle-même.
2. Cliquez sur l'icône de l'extension, puis sur **Récupérer la playlist de l'onglet**. La page défile seule
   jusqu'en bas. Les vidéos supprimées, privées ou indisponibles sont ignorées, de même que les vidéos déjà
   présentes dans la file (y compris celles déjà téléchargées).
3. Cliquez sur **Démarrer**. Un onglet noTube s'ouvre en arrière-plan et sert pour tous les titres. Vous pouvez
   continuer à utiliser Chrome normalement (évitez simplement de naviguer dans cet onglet-là).
4. La popup affiche le titre en cours, les compteurs, la progression, une estimation du temps restant et la
   liste des erreurs (exportable en `.txt`).

Boutons :

| Bouton | Effet |
|---|---|
| Récupérer la playlist | Ajoute les vidéos de la playlist ouverte à la file (sans doublons) |
| Démarrer | Lance la file |
| Pause / Reprendre | Le titre en cours est interrompu et remis en attente (sans compter d'essai) |
| Relancer les erreurs | Remet en attente les titres abandonnés, avec un compteur d'essais à zéro |
| Vider la file | Supprime toute la file (les fichiers déjà téléchargés ne sont pas touchés) |
| Exporter (.txt) | Enregistre la liste des erreurs avec leur raison |

### Nom des fichiers et étiquettes

Le **nom de la musique** est lu dans la playlist **avant** l'envoi à noTube, puis sert à nommer le fichier
et à remplir ses étiquettes internes, que les lecteurs de musique affichent :

| Titre YouTube | Fichier | Étiquette titre | Étiquette artiste |
|---|---|---|---|
| SDM - BOLIDE ALLEMAND 1/2 (Clip Officiel) | `SDM - BOLIDE ALLEMAND 1-2.mp3` | BOLIDE ALLEMAND 1/2 | SDM |
| Ninho - Jefe [Clip Officiel] | `Ninho - Jefe.mp3` | Jefe | Ninho |
| Ruinart (chaîne « SDM - Topic ») | `Ruinart.mp3` | Ruinart | SDM |
| PNL - Au DD (Remix) | `PNL - Au DD (Remix).mp3` | Au DD (Remix) | PNL |

- Les mentions vidéo sont retirées : « (Clip Officiel) », « [Official Music Video] », « (Lyrics) », « | Clip officiel »…
  Les mentions utiles (« Remix », « Live », « feat. ») sont gardées.
- L'artiste est la partie avant « - » ; à défaut, le nom de la chaîne, nettoyé (« - Topic », « VEVO », « Officiel » retirés).
- Les règles se modifient dans `config/notube-config.js`, rubrique `naming`. Les deux comportements se désactivent
  dans les options (« Nettoyer les titres », « Écrire titre et artiste dans le MP3 »).

### Reprise

- La file est stockée dans `chrome.storage.local` : elle survit à la fermeture de Chrome.
- Au redémarrage de Chrome (ou au rechargement de l'extension), le titre interrompu repasse en attente, la file se met
  **en pause** et une notification vous prévient. Cliquez sur **Reprendre** : les titres déjà terminés sont ignorés.

### Captcha (« Cochez la case »)

Depuis le 13/11/2026, noTube affiche **de temps en temps** pendant la conversion le message *« Cochez la case (si elle
n'est pas visible, veuillez désactiver votre bloqueur de pub et actualisez) »* avec une case Cloudflare Turnstile.

Dans ce cas, l'extension :
- **s'arrête sur place** : le titre en cours est gardé et aucun délai ne court ;
- affiche une notification **« noTube : cochez la case »** et met l'onglet noTube au premier plan ;
- la popup affiche en rouge « Cochez la case dans l'onglet noTube » ;
- **ne coche jamais la case à votre place.** Cochez-la vous-même : la même conversion reprend aussitôt.
  Souvent, la case se valide d'elle-même quelques secondes après que l'onglet est passé au premier plan.

**Si la case n'apparaît pas**, c'est votre bloqueur de publicité qui bloque `challenges.cloudflare.com` :
désactivez-le sur `notube.lol`, puis actualisez l'onglet noTube.

Avant cette correction, la case n'était pas reconnue : l'extension attendait 90 s, puis notait
« Délai dépassé (étape : conversion) ». Désormais, chaque délai dépassé indique aussi le dernier message affiché par noTube.

## 3. Réglages (page d'options)

Accès : lien **Réglages** en bas de la popup, ou clic droit sur l'icône puis « Options ».

| Réglage | Défaut | Rôle |
|---|---|---|
| Sous-dossier de sortie | `Musique` | Dans votre dossier Téléchargements (Chrome ne peut pas écrire ailleurs) |
| Format | MP3 | Également MP3 HD, M4A ou WAV |
| Taille minimale | 50 Ko | En dessous, le fichier est jugé raté, supprimé, puis le titre est réessayé |
| Mode de téléchargement | Lien direct | Voir plus bas |
| Pause min / max entre deux titres | 6 s / 15 s | Durée tirée au hasard entre ces deux valeurs |
| Titres par heure au maximum | 10 | Plafond de débit, choisi pour rester sous la limite gratuite de noTube (voir plus bas) |
| Pause après une limite noTube | 120 min | Utilisée seulement si noTube n'affiche pas lui-même la durée |
| Essais par titre | 3 | Au-delà, le titre passe en erreur et la file continue |
| Délai max de conversion | 90 s | Watchdog ; le compte repart après la file d'attente annoncée par noTube |
| Délai max du téléchargement | 300 s | Tant que des octets arrivent, le délai est prolongé jusqu'à cette limite |
| Alerte après N échecs consécutifs | 3 | Notification ; la pause entre titres double à chaque échec (×16 au maximum) |
| Journal détaillé | activé | Messages `[NoTube-Playlist]` dans la console |
| Simuler un captcha | (bouton) | Test : fait apparaître un faux captcha au prochain titre |

**Mode « Lien direct » (recommandé)** : l'extension lit l'adresse du bouton « Télécharger » de noTube
(`https://sNN.notube.lol/download.php?token=…`) et lance elle-même le téléchargement, avec le bon nom et le
bon dossier. La publicité liée à ce bouton n'est jamais ouverte.
**Mode « Clic »** : l'extension clique sur le bouton, ferme la publicité ouverte, et reclique au besoin
(3 fois au maximum). En mode direct, l'extension bascule d'elle-même en mode clic pour un titre dont le lien direct a été refusé.

## 4. Permissions demandées (et pourquoi)

| Permission | Justification |
|---|---|
| `storage` | Mémoriser la file, l'état et les réglages (le service worker est endormi régulièrement) |
| `alarms` | Titre suivant, watchdog (90 s) et vérification du retour du réseau, même si le service worker dort |
| `downloads` | Lancer le téléchargement, le suivre jusqu'au bout, le nommer `Musique/Titre.mp3`, vérifier sa taille |
| `scripting` | Injecter le lecteur de playlist dans la page YouTube au moment du clic |
| `activeTab` | Accès à l'onglet YouTube **uniquement** quand vous cliquez sur « Récupérer » : aucun accès permanent à YouTube |
| `notifications` | Prévenir en cas de captcha, de limite, d'échecs répétés, de redémarrage et de fin de file |
| `offscreen` | Document invisible qui écrit le titre et l'artiste dans le MP3 (un service worker ne peut pas créer le fichier modifié) |
| Accès à `https://*.notube.lol/*` | Récupérer le MP3 sur les serveurs de fichiers de noTube (`sNN.notube.lol`) pour y écrire les étiquettes |
| Script de contenu sur `https://notube.lol/*` | Piloter la page noTube (saisie, conversion, lecture du lien). Il ne fait rien hors de l'onglet de travail |

Pas de permission `tabs` ni d'accès à d'autres sites que noTube. **Aucune donnée n'est envoyée ailleurs que vers YouTube
et noTube**, et l'extension ne fait ni suivi ni télémétrie. Le seul échange en dehors des pages est un `HEAD` vers noTube
pour tester la connexion.

## 5. Quand noTube (ou YouTube) change son interface

Tout ce qui est propre aux sites est regroupé dans **un seul fichier : `config/notube-config.js`**.
La logique n'a pas à être modifiée.

### Étapes

1. Ouvrez noTube dans un onglet normal et lancez une conversion à la main.
2. Faites un clic droit sur l'élément qui pose problème (champ du lien, bouton OK, bouton Télécharger…),
   puis choisissez **Inspecter**.
3. Dans DevTools, repérez de préférence un `id` (`#keyword`), sinon un attribut stable
   (`name="…"`, `type="…"`, `aria-label="…"`). **Évitez les classes générées** du genre `css-1x2y3z`.
4. Vérifiez votre sélecteur dans la console DevTools : `document.querySelector('#monSelecteur')`.
   Il doit renvoyer l'élément.
5. Ajoutez-le **en tête** de la liste correspondante dans `config/notube-config.js`. Gardez l'ancien à la suite :
   il ne gêne pas.
6. **Rechargez l'extension** : `chrome://extensions`, puis bouton ⟳ de l'extension. *Indispensable* : Chrome garde en
   cache les scripts du service worker, et fermer/rouvrir Chrome ne suffit pas toujours.
7. Testez avec un seul titre.

### Où regarder

| Symptôme dans la liste d'erreurs | Clé à corriger dans `config/notube-config.js` |
|---|---|
| « Délai dépassé : champ du lien » | `notube.selectors.urlInput` |
| « Délai dépassé : bouton de conversion actif » | `notube.selectors.submitButton` (+ `texts.submit`) |
| « Format … introuvable » | `notube.selectors.formatSelect` |
| « Délai dépassé : bouton Télécharger » | `notube.selectors.downloadButton` (+ `texts.download`) |
| « Lien de téléchargement inattendu » | `notube.downloadUrlPattern` |
| « Page noTube inattendue : /… » | `notube.pages` (nouvelle adresse de page) |
| La limite n'est plus reconnue | `notube.pages.limit`, `notube.limitWaitPattern` |
| Pauses « captcha » injustifiées, ou case non reconnue | `captcha.selectors` / `captcha.texts` / `captcha.titles` / `captcha.solvedWhenFilled` |
| « Le clic n'a pas été pris en compte » en boucle | `notube.selectors.conversionStarted`, `timing.submitConfirmMs` |
| La playlist renvoie 0 vidéo | `youtube.container`, `youtube.items`, `youtube.link`, `youtube.title` |
| L'artiste est vide ou faux | `youtube.channel`, `naming.channelCleanup` |
| Une mention reste dans le nom (« (Visualizer) »…) | `naming.titleCleanup` |
| La playlist s'arrête à 100 vidéos | `youtube.continuation` |

**Changement de domaine** (ex. notube.lol devient notube.xyz) : modifiez `notube.converterUrl` dans la
configuration **et** `content_scripts.matches` dans `manifest.json`, puis rechargez l'extension.

### Journal

- **Service worker** : `chrome://extensions`, puis dans l'extension, « Inspecter les vues : service worker », onglet Console.
- **Page noTube** : dans l'onglet de travail, F12, onglet Console.
- Tous les messages commencent par `[NoTube-Playlist]`. Activez ou désactivez le journal dans les options.

## 6. Organisation du code

```
notube-playlist/
├── manifest.json
├── config/notube-config.js     ← sélecteurs, textes, adresses (à modifier si le site change)
├── lib/
│   ├── log.js                  journal avec préfixe, activable
│   ├── util.js                 nom de la musique, artiste, noms de fichiers sûrs, durées
│   ├── id3.js                  écriture des étiquettes titre / artiste dans le MP3
│   └── storage.js              réglages par défaut, état persistant, exécution exclusive
├── background/
│   ├── service-worker.js       point d'entrée MV3, écouteurs
│   ├── runner.js               automate : file, essais, watchdog, rythme, pause, reprise
│   ├── messages.js             messages de la popup et des pages noTube
│   ├── downloads.js            téléchargement direct / clic, suivi, contrôle de taille
│   ├── work-tab.js             onglet de travail, fermeture des publicités
│   ├── playlist.js             injection du lecteur de playlist
│   ├── offscreen-client.js     ouverture du document invisible
│   └── notify.js               notifications
├── offscreen/                  document invisible : récupère le MP3, écrit les étiquettes
├── content/
│   ├── dom-helpers.js          recherche par sélecteur / texte, attente par détection, saisie, clics
│   ├── notube-driver.js        pilotage des pages noTube
│   └── youtube-scraper.js      lecture d'une playlist (défilement jusqu'à stabilisation)
├── popup/                      interface principale
├── options/                    page de réglages
└── icons/
```

## 7. Tests effectués (12–13/11/2026, Chromium 151 avec l'extension chargée)

| # | Scénario | Résultat |
|---|---|---|
| 1 | File de 3 titres | ✅ 3 MP3 dans `Téléchargements/Musique`, nommés d'après le titre, en-tête ID3 valide (0,5 à 3,5 Mo) |
| – | Lecture d'une playlist publique de 321 vidéos | ✅ 322 vidéos lues en 9 s (défilement compris), 2 doublons ignorés |
| 2a | Lien invalide | ✅ 3 essais refusés par noTube (« erreur 3 »), titre passé en erreur avec sa raison, titre suivant téléchargé |
| 2b | Onglet de travail fermé à la main pendant la conversion | ✅ Titre remis en attente sans compter d'essai, nouvel onglet créé, file poursuivie |
| 2c | Coupure réseau de 150 s pendant une conversion | ✅ Pause « Connexion perdue » sans compter d'essai, reprise automatique au retour du réseau, titre terminé |
| 3 | Fermeture de Chrome au milieu de la file, puis réouverture | ✅ Pause « redémarrage », titre interrompu remis en attente, titre terminé non refait après Reprendre |
| 4 | Captcha simulé | ✅ Pause, onglet au premier plan, notification ; reprise automatique après résolution |
| – | Vraie page de limite noTube | ✅ Titre remis en attente sans compter d'essai, reprise programmée 2 h + 2 min plus tard, notification |
| – | Playlist ouverte après une recherche (navigation interne de YouTube) | ✅ Seule la playlist visible est lue (l'ancienne version lisait les résultats de recherche cachés) |
| – | Case « Cochez la case » (Cloudflare Turnstile) pendant la conversion | ✅ Détectée, attente sur place (délai suspendu), onglet au premier plan, notification ; reprise de la même conversion après la case |
| – | Clic sur OK vérifié | ✅ Chaque clic est confirmé par la réaction de noTube ; sinon jusqu'à 3 clics, puis lien de secours `?v=` |
| – | Nom nettoyé + étiquettes | ✅ `jawed - Me at the zoo.mp3`, titre « Me at the zoo », artiste « jawed », audio intact (19,1 s, aucune trame abîmée) |

Problèmes trouvés et corrigés pendant les tests : sous-dossier ignoré par Chrome, reprise au redémarrage qui ne
dépendait que de `onStartup`, course au démarrage avec les onglets restaurés, adresse `plus-457` non reconnue,
watchdog déclenché pendant la file d'attente de noTube.

**Non vérifié automatiquement** : le clic réel sur « Récupérer la playlist » dans la popup (il exige un vrai clic
pour la permission `activeTab` ; le lecteur de playlist a été testé en direct sur la page), le mode « Clic » (jamais
nécessaire pendant les tests) et la page d'un vrai captcha noTube (aucun captcha n'est apparu).

## 8. Limites connues et risques

- **Limite gratuite de noTube (le risque principal).** Le blocage a été observé après environ 25 conversions,
  avec une attente de 2 heures. L'extension attend puis reprend seule, mais le débit soutenu est faible.
  Pour réellement atteindre plusieurs dizaines de titres par heure, il faudrait noTube Plus (payant) ou un autre outil.
  La limite est probablement liée à votre adresse IP : elle vaut aussi pour vos conversions manuelles.
  Le plafond par défaut est donc de **10 titres par heure**, soit environ 20 titres sur la fenêtre de 2 heures annoncée
  par noTube. C'est une estimation : la règle exacte de noTube (nombre et durée de la fenêtre) n'est pas publiée.
  Si la limite tombe quand même, baissez encore le plafond (8, puis 6) ; si elle ne tombe jamais, vous pouvez
  le remonter progressivement. Dans tous les cas, l'extension attend la fin du blocage puis reprend seule.
- **Évolution du site.** noTube n'a pas d'API, et son interface et ses adresses (`-457`, sous-domaines `sNN`, domaine
  `.lol`) changent. Une modification peut tout casser du jour au lendemain : voir la section 5.
- **Détection de l'automatisation.** La page de noTube contient un script « ad-guard » qui signale les ouvertures de
  fenêtres jugées anormales. Le mode direct évite la publicité du bouton Télécharger, et cela peut être repéré.
  Les clics simulés n'ont pas « d'activation utilisateur » : Chrome bloque donc la publicité ouverte à la soumission.
- **Captcha.** Aucun n'a été vu. Sa détection repose sur des indices génériques (cadres reCAPTCHA, hCaptcha ou Turnstile,
  textes « captcha », titre « Just a moment »). Une détection manquée se termine par un dépassement de délai ;
  une fausse détection se règle avec « Reprendre » et une correction de `captcha.*`.
- **Titres refusés par noTube.** Certaines vidéos échouent systématiquement chez noTube (« erreur 3 » sur 2 titres de la
  playlist de test, alors que d'autres passaient). Ils finissent en erreur après 3 essais.
- **Vidéos longues.** La version gratuite refuse les vidéos trop longues (page `feature=duration`) : erreur définitive, sans nouvel essai.
- **Onglet en arrière-plan.** Chrome ralentit les minuteries des onglets cachés. La conversion reste pilotée par
  détection d'éléments, mais un onglet de travail caché depuis longtemps peut être un peu plus lent.
- **Nom des fichiers.** Les caractères interdits sont remplacés et les noms longs coupés à 150 caractères. En cas de
  doublon, Chrome ajoute « (1) », « (2) ». Si Chrome refuse quand même le nom, le fichier prend l'identifiant de la vidéo.
- **Conditions d'utilisation.** Télécharger l'audio de YouTube par un service tiers est contraire aux conditions
  de YouTube, même à titre personnel. C'est à vous d'en juger.
