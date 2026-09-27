# Phoenix Stealth v20

Phoenix Stealth est un assistant WhatsApp Baileys orienté **présence, récupération et organisation**, avec une présentation discrète et lisible. Il fonctionne avec Node.js 18 ou supérieur et conserve ses données locales dans `Phoenix_Media/` afin de rester portable d’une plateforme à l’autre.

La page web racine (`/`) fournit un accueil visuel sobre pour une présentation client, tandis que `/healthz` expose un état technique minimal destiné à la supervision.

## Installation et démarrage

```bash
npm install
node index.js
```

Le numéro utilisé pour l’association doit être configuré dans la variable d’environnement `PHONE_NUMBER` avec l’indicatif international, sans espaces ni signe `+`. Aucun numéro n’est stocké dans le dépôt. La session Baileys est conservée dans `auth_info/` : après le premier jumelage, un redémarrage réutilise automatiquement cette session et ne redemande pas de code. Si `auth_info/` est supprimé ou n’est pas conservé par l’hébergeur, le code devra naturellement être demandé de nouveau.

Phoenix utilise exclusivement le **code d’association**. Le QR code est désactivé et n’est plus affiché dans le terminal. Pour le premier démarrage :

```bash
PHONE_NUMBER=TON_NUMERO_INTERNATIONAL node index.js
```

Puis saisir le code affiché dans WhatsApp : **Appareils connectés → Associer un appareil → Avec un numéro de téléphone**. Pour éviter un nouveau jumelage après redémarrage, conserver `auth_info/` sur un volume persistant ou définir `AUTH_DIR` vers un dossier persistant.

## Règle des noms

Le bot utilise uniquement le champ de nom réellement enregistré dans le carnet pour alimenter `!contacts` et les affichages visibles. Les noms de profil WhatsApp (`notify`, `verifiedName`) ne sont jamais ajoutés au carnet ni utilisés comme faux noms enregistrés. Les groupes, chaînes et autres JID non personnels sont exclus du carnet de contacts.

Cette règle s’applique aux statuts, messages supprimés, vues uniques, alertes online, mentions et messages privés envoyés par le bot. Il n’est donc pas nécessaire d’utiliser `setnom` ou `save` pour renommer manuellement les contacts.

Si un numéro n’existe réellement pas dans le carnet WhatsApp, Phoenix affiche `Contact WhatsApp` ou le numéro résolu, sans inventer un nom. La recherche vérifie à la fois la mémoire de session et le carnet local afin de gérer les statuts reçus avant la synchronisation complète des contacts.

## Commandes principales

| Commande | Fonction |
|---|---|
| `!menu` | Affiche le menu général. |
| `!statut` | Liste les personnes dont des statuts non lus sont disponibles. |
| `!statut <nom>` | Présente les statuts non lus du contact. |
| `!statut download` | Liste tous les statuts disponibles avec un numéro. |
| `!statut download <nom>` | Liste les statuts disponibles d’un contact. |
| `!statut download <nom> <index>` | Télécharge un statut précis ; `-1` désigne le dernier, comme en Python. |
| `!online <nom>` | Affiche `🟢 Joignable` ou `⚫ Hors ligne`, avec le RTT de la sonde ponctuelle. |
| `!alertonline <nom> \| message` | Active une alerte personnalisée. Le marqueur `{name}` est remplacé par le nom du carnet. |
| `!alertonline list` | Liste les alertes actives. |
| `!alertonline off <nom>` | Désactive l’alerte du contact. |
| `!viewonce` / `!vv` | Récupère une vue unique reçue et l’envoie dans le chat privé du propriétaire. |
| `!tagall <texte>` | Mentionne les membres du groupe. Si la commande répond à un message, la réponse est attachée à ce message cité. |
| `!contacts <page>` | Parcourt le carnet par pages, sans groupes ni chaînes. |
| `!contact <nom>` | Affiche une fiche contact. |
| `!ping`, `!runtime`, `!stats` | Outils de diagnostic et statistiques. |
| `!clean` | Nettoie les caches mémoire non nécessaires. |
| `!health` | Affiche en privé l’état du noyau, l’uptime, les caches et les alertes. |

## Alertes online

Exemple :

```text
!alertonline Blue Bird | 🔔 {name} est disponible.
```

La commande `!online` affiche volontairement seulement deux états : `🟢 Joignable` lorsqu’une présence ou une réponse d’appareil est reçue, et `⚫ Hors ligne` lorsqu’aucun signal n’arrive dans le délai prévu. Elle affiche aussi le RTT de cette sonde ponctuelle, sans conserver ni comparer les RTT précédents. Cela ne prétend pas mesurer l’activité de la personne ni le premier plan ; c’est uniquement un résultat de joignabilité instantané. Une temporisation anti-doublon évite les sondes répétées.

Phoenix ne conserve pas d’historique RTT et ne cherche pas à suivre les habitudes d’un contact. Une sonde ponctuelle peut seulement indiquer qu’un appareil est joignable ; elle ne permet pas d’affirmer que la personne est en ligne ou que WhatsApp est au premier plan.

## Statuts déjà consultés

Lorsqu’un statut est reçu, son contenu est mis en cache avec son identifiant, son type, son auteur résolu et, pour les médias, un fichier local. La commande `!statut <nom>` marque les éléments comme vus mais **ne les supprime plus immédiatement**. `!statut download` ou `!statut download <nom>` affiche les statuts disponibles avec des numéros. `!statut download <nom> -1` télécharge le dernier ; un index positif commence à `1`, tandis que `-2` désigne l’avant-dernier. Le nettoyage automatique intervient après 24 heures. Si le fichier média n’est plus présent, le bot affiche une réponse explicite au lieu d’échouer silencieusement.

Les statuts texte, images, vidéos, audios et stickers sont pris en charge selon leur disponibilité dans le cache Baileys. Les médias sont renvoyés dans la conversation privée du propriétaire.

## Messages supprimés et vues uniques

Le cache des messages conserve les éléments nécessaires à la récupération. Lorsqu’un message est supprimé, Phoenix tente d’afficher dans le privé du propriétaire : le groupe ou la conversation, le nom du véritable expéditeur, le nom de la personne ayant supprimé le message lorsqu’il est fourni par WhatsApp, puis le contenu ou le média récupéré. Les fichiers sont traités selon leur type sans afficher de chemin local dans le message WhatsApp.

## Vérifications effectuées sur cette version

La version a été contrôlée par chargement syntaxique de `index.js`, de tous les modules `core/` et de toutes les commandes, validation du chargeur de commandes, recherche des imports inexistants et tests fonctionnels ciblés pour les alertes online, `tagall` avec message cité et téléchargement de statut déjà vu.

## Limites importantes

La présence WhatsApp n’est pas une télémétrie parfaite. Un état `available` est une confirmation d’événement reçue par le compte connecté ; une réponse RTT indique surtout qu’une cible est joignable. Le bot ne peut pas contourner les réglages de confidentialité, les délais de synchronisation ou les restrictions imposées par WhatsApp.

Les fichiers d’authentification et le dossier `Phoenix_Media/` sont sensibles : ne pas les publier dans un dépôt public et conserver une sauvegarde privée avant une migration.

## Améliorations furtives livrées

- **Pairing-only** : aucun QR code, aucun choix interactif inutile et aucun numéro propriétaire dans le dépôt.
- **Session persistante** : `auth_info/` est réutilisé automatiquement ; le code n’est demandé qu’après une première association, une déconnexion réelle ou la perte du volume de session.
- **Terminal discret** : les logs de chargement, de suppression fantôme, de présence et de synchronisation sont masqués par défaut. `PHOENIX_VERBOSE=true` réactive le diagnostic développeur.
- **`!health`** : état privé du noyau, uptime, caches, contacts, présences et alertes, sans chemin local ni secret.
- **Accueil client** : page web responsive et lisible, avec état opérationnel et version, sans donnée sensible.
- **Carnet fiable** : l’historique WhatsApp et le carnet disponible à la connexion sont synchronisés automatiquement ; seuls les noms enregistrés sont conservés, sans gonfler la liste avec les profils.
- **Alertes online robustes** : recherche par nom ou numéro, prise en charge des LID et notification sur présence disponible, écriture ou enregistrement, avec remise à zéro hors ligne.
- **Nettoyage complet** : les fichiers média associés aux statuts expirés sont supprimés avec leur entrée de cache après 24 heures.
- **Rappels robustes** : les formats incomplets ou invalides comme `10mfoo` sont refusés au lieu d’être partiellement interprétés.
- **Terminal portable** : bannière de démarrage et événements de connexion, pairing, synchronisation et reconnexion affichés de façon compacte, quel que soit l’hébergement (Termux, VPS, Docker ou serveur Node.js).
- **`!online` minimal** : deux états visuels uniquement — `🟢 Joignable` et `⚫ Hors ligne` — sans historique comportemental.

## Propositions d’évolution

Les prochaines évolutions naturelles sont un mode **digest** regroupant les alertes online sur une période choisie, un historique local limité des présences avec expiration automatique, et une commande d’export sélectif des médias de statut. Elles doivent rester désactivables, limitées au propriétaire et sans exposition de données dans le terminal.
