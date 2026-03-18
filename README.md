# Analyse des résultats Gatling

Outil d'analyse et de visualisation des résultats de tests de performance [Gatling](https://gatling.io/).

## Fonctionnement

L'application est une page HTML statique avec du JavaScript vanilla. Elle :

1. Charge un fichier `stats.json` généré par Gatling (via une URL saisie par l'utilisateur)
2. Affiche la liste des **groupes de requêtes** triée par nom de groupe
3. Présente toutes les données de la balise **`stats`** pour chaque requête (sans afficher le contenu de `contents`)

## Structure du projet

```
analyse_resultats_gatling/
├── index.html          # Application principale (HTML + JS)
├── README.md
└── pyproject.toml
```

## Lancer l'application

### Option 1 — Serveur Python intégré (recommandé)

```bash
python -m http.server 8080
```

Puis ouvrir [http://localhost:8080](http://localhost:8080) dans le navigateur.

### Option 2 — Ouvrir directement dans le navigateur

Ouvrir `index.html` directement dans le navigateur (fonctionne si le fichier `stats.json` est servi depuis le même domaine ou si CORS est autorisé).

## Format du fichier `stats.json` Gatling

Le fichier est généré dans le répertoire de résultats Gatling, typiquement :

```
results/<simulation-name>-<timestamp>/js/stats.json
```

### Structure attendue

```json
{
  "type": "GROUP",
  "name": "All Requests",
  "path": "",
  "pathFormatted": "req_all-requests",
  "stats": {
    "name": "All Requests",
    "numberOfRequests": { "total": 100, "ok": 95, "ko": 5 },
    "minResponseTime":  { "total": 12,  "ok": 12, "ko": 100 },
    "maxResponseTime":  { "total": 2500,"ok": 800,"ko": 2500 },
    "meanResponseTime": { "total": 210, "ok": 180,"ko": 1200 },
    "standardDeviation":{ "total": 340, "ok": 120,"ko": 450 },
    "percentiles1":     { "total": 150, "ok": 140,"ko": 1100 },
    "percentiles2":     { "total": 310, "ok": 250,"ko": 1800 },
    "percentiles3":     { "total": 600, "ok": 500,"ko": 2000 },
    "percentiles4":     { "total": 1200,"ok": 700,"ko": 2400 },
    "meanNumberOfRequestsPerSecond": { "total": 5.0, "ok": 4.75, "ko": 0.25 },
    "group1": { "name": "t < 800 ms",  "htmlName": "t < 800 ms",  "count": 80, "percentage": 80 },
    "group2": { "name": "800 ms <= t < 1200 ms", "htmlName": "800 ms ≤ t < 1200 ms", "count": 10, "percentage": 10 },
    "group3": { "name": "t >= 1200 ms","htmlName": "t ≥ 1200 ms", "count": 5,  "percentage": 5  },
    "group4": { "name": "failed",      "htmlName": "failed",       "count": 5,  "percentage": 5  }
  },
  "contents": {
    "req_login": { ... },
    "req_search": { ... }
  }
}
```

## Notes

- `stats` contient toutes les métriques de performance d'un nœud (groupe ou requête individuelle).
- `contents` contient les nœuds enfants (sous-groupes ou requêtes individuelles) — **non affiché** dans cette vue.
