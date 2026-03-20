#!/usr/bin/env python3
"""
Serveur HTTP pour analyse_resultats_gatling.

Sert les fichiers statiques (index.html, app.js, …) ET expose deux routes :

  GET /api/tree?root=<chemin>
      Retourne l'arborescence des sous-répertoires de <chemin> (ou du répertoire
      par défaut si root est absent).  Pour chaque entrée, indique si le fichier
      js/stats.json existe (=> simulation Gatling disponible).

  GET /api/stats?path=<chemin_absolu_stats.json>
      Retourne le contenu du stats.json demandé (chemin absolu ou relatif au root).
      Restreint aux chemins sous DEFAULT_ROOT pour la sécurité.

Usage :
    python server.py [port] [root]

    port  : port d'écoute (défaut 8080)
    root  : répertoire racine des simulations Gatling
            (défaut : D:/Users/gauthiereti/Documents/Portable/Archi/Java/git/tests-de-charge/target/gatling)
"""

import http.server
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any, Optional

# ── Paramètres par défaut ──────────────────────────────────────────────────────
DEFAULT_ROOT = Path(
    r"D:\Users\gauthiereti\Documents\Portable\Archi\Java\git\tests-de-charge\target\gatling"
)
DEFAULT_PORT = 8080

# Répertoire contenant index.html / app.js (dossier du script)
STATIC_DIR = Path(__file__).parent.resolve()


def _breadcrumb(path: Path) -> List[Dict[str, str]]:
    """
    Décompose un chemin absolu en liste de segments cliquables.
    Ex: C:/foo/bar  →  [ {name:"C:\\", path:"C:\\"}, {name:"foo", path:"C:\\foo"}, {name:"bar", path:"C:\\foo\\bar"} ]
    """
    parts = path.parts  # ('C:\\', 'foo', 'bar') sur Windows
    crumbs = []
    cumulative = Path(parts[0])
    crumbs.append({"name": parts[0], "path": str(cumulative)})
    for part in parts[1:]:
        cumulative = cumulative / part
        crumbs.append({"name": part, "path": str(cumulative)})
    return crumbs


def _tree(root: Path) -> List[Dict[str, Any]]:
    """
    Parcourt récursivement root et retourne la liste des nœuds.

    Chaque nœud :
        {
          "name": str,              # nom du répertoire
          "path": str,              # chemin absolu
          "hasStats": bool,         # js/stats.json existe ?
          "statsPath": str|None,    # chemin absolu du stats.json si hasStats
          "gatlingDate": str|None   # date/heure ISO 8601 si le nom se termine par -yyyyMMddHHmmssSSS
        }

    Les entrées sont triées par nom alphabétique croissant.
    """
    # Regex : 17 chiffres en fin de nom  aaaaMM jj HH mm ss SSS
    _DATE_RE = re.compile(r"-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$")

    if not root.is_dir():
        return []

    nodes = []
    try:
        entries = sorted(root.iterdir(), key=lambda p: p.name)
    except PermissionError:
        return []

    for entry in entries:
        if not entry.is_dir():
            continue
        stats_json = entry / "js" / "stats.json"
        has_stats = stats_json.is_file()

        # Tentative de parsing de la date Gatling dans le nom
        m = _DATE_RE.search(entry.name)
        gatling_date: Optional[str] = None
        if m:
            year, month, day, hour, minute, second, ms = (int(x) for x in m.groups())
            # Construire une chaîne ISO 8601 UTC que le JS pourra parser
            gatling_date = (
                f"{year:04d}-{month:02d}-{day:02d}"
                f"T{hour:02d}:{minute:02d}:{second:02d}.{ms:03d}Z"
            )

        nodes.append({
            "name":        entry.name,
            "path":        str(entry),
            "hasStats":    has_stats,
            "statsPath":   str(stats_json) if has_stats else None,
            "gatlingDate": gatling_date,
        })

    return nodes


class Handler(http.server.BaseHTTPRequestHandler):

    # root Gatling — sera injecté avant démarrage
    gatling_root: Path = DEFAULT_ROOT

    def log_message(self, fmt, *args):  # noqa: A002
        # Silencer les logs de requêtes non-API
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def _send_json(self, data, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str):
        self._send_json({"error": message}, status)

    def _serve_static(self, fs_path: Path):
        if not fs_path.is_file():
            self._send_error_json(404, f"Fichier non trouvé : {fs_path.name}")
            return
        suffix = fs_path.suffix.lower()
        mime = {
            ".html": "text/html; charset=utf-8",
            ".js":   "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".css":  "text/css; charset=utf-8",
            ".txt":  "text/plain; charset=utf-8",
        }.get(suffix, "application/octet-stream")
        body = fs_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── Routage ───────────────────────────────────────────────────────────────
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs     = urllib.parse.parse_qs(parsed.query)

        # /api/tree
        if parsed.path == "/api/tree":
            root_param = qs.get("root", [None])[0]
            root = Path(root_param).resolve() if root_param else self.gatling_root
            if not root.is_dir():
                self._send_error_json(404, f"Répertoire introuvable : {root}")
                return
            parent = root.parent
            nodes = _tree(root)
            self._send_json({
                "root":         str(root),
                "default_root": str(self.gatling_root),
                "parent":       str(parent) if parent != root else None,
                "breadcrumb":   _breadcrumb(root),
                "nodes":        nodes,
            })
            return

        # /api/stats  — retourne le contenu d'un stats.json (sécurisé)
        if parsed.path == "/api/stats":
            path_param = qs.get("path", [None])[0]
            if not path_param:
                self._send_error_json(400, "Paramètre 'path' requis.")
                return
            target = Path(path_param).resolve()
            # Sécurité : autoriser uniquement les chemins sous gatling_root
            # ou dont le nom se termine par stats.json (double vérification)
            if not target.name == "stats.json":
                self._send_error_json(403, "Seuls les fichiers stats.json sont autorisés.")
                return
            if not target.is_file():
                self._send_error_json(404, f"Fichier non trouvé : {target}")
                return
            self._serve_static(target)
            return

        # Fichiers statiques : index.html, app.js, etc.
        url_path = parsed.path.lstrip("/") or "index.html"
        # Interdire la traversée de répertoire
        fs_path = (STATIC_DIR / url_path).resolve()
        if not str(fs_path).startswith(str(STATIC_DIR)):
            self._send_error_json(403, "Accès refusé.")
            return
        self._serve_static(fs_path)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    root = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_ROOT

    Handler.gatling_root = root.resolve() if root.exists() else root

    addr = ("", port)
    httpd = http.server.HTTPServer(addr, Handler)

    print(f"✅  Serveur démarré sur http://localhost:{port}/")
    print(f"📁  Fichiers statiques : {STATIC_DIR}")
    print(f"🎯  Racine Gatling     : {Handler.gatling_root}")
    print(f"    (modifiable via ?root=<chemin> ou en passant un 2ᵉ argument)")
    print("    Ctrl+C pour arrêter.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrêté.")


if __name__ == "__main__":
    main()
