#!/usr/bin/env python3
"""
Serveur HTTP pour analyse_resultats_gatling.

Sert les fichiers statiques (index.html, app.js, …) ET expose quatre routes :

  GET /api/tree?root=<chemin>
      Arborescence locale des sous-répertoires de <chemin>.

  GET /api/stats?path=<chemin_absolu_stats.json>
      Contenu d'un stats.json local (chemin absolu).

  GET /api/ftp/tree?path=<chemin_distant>
      Arborescence distante via SFTP/FTPS (paramètres dans .env).

  GET /api/ftp/stats?path=<chemin_distant_stats.json>
      Contenu d'un stats.json distant via SFTP/FTPS.

Usage :
    python server.py [port] [root]

    port  : port d'écoute (défaut 8080)
    root  : répertoire racine local des simulations Gatling
"""

import http.server
import io
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path, PurePosixPath
from typing import List, Dict, Any, Optional

# ── Chargement du .env (python-dotenv) ───────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env", override=False)
except ImportError:
    pass  # python-dotenv absent : les variables d'environnement restent telles quelles

# ── Config FTP lue depuis l'environnement ────────────────────────────────────
FTP_PROTOCOL   = os.environ.get("FTP_PROTOCOL",   "sftp").lower()   # "sftp" ou "ftps"
FTP_HOST       = os.environ.get("FTP_HOST",       "")
FTP_PORT       = int(os.environ.get("FTP_PORT",   "22"))
FTP_USER       = os.environ.get("FTP_USER",       "")
FTP_PASSWORD   = os.environ.get("FTP_PASSWORD",   "")
FTP_REMOTE_DIR = os.environ.get("FTP_REMOTE_DIR", "/")


def _ftp_config_ok() -> bool:
    return bool(FTP_HOST and FTP_USER)

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


# ── Helpers FTP distants ──────────────────────────────────────────────────────

# Cache mémoire : remote_path → contenu bytes du stats.json
# Alimenté lors de _ftp_tree() pour éviter une 2ᵉ connexion FTP au clic "Analyser".
_ftp_stats_cache: Dict[str, bytes] = {}

# ── Connexion SFTP persistante ────────────────────────────────────────────────
# On garde un (transport, sftp) ou un ftp actif pour toute la durée du processus.
# _ftp_lock protège l'accès concurrent (HTTPServer multi-thread).
import threading as _threading
_ftp_lock = _threading.Lock()
_sftp_client: Optional[Any] = None      # paramiko.SFTPClient
_sftp_transport: Optional[Any] = None   # paramiko.Transport
_ftps_client: Optional[Any] = None      # ftplib.FTP_TLS


def _get_sftp(force_reconnect: bool = False):
    """Retourne le SFTPClient persistant, en (re)créant la connexion si nécessaire."""
    global _sftp_client, _sftp_transport
    import paramiko
    if not force_reconnect and _sftp_transport is not None and _sftp_transport.is_active():
        return _sftp_client
    # Fermeture propre de l'ancienne connexion
    try:
        if _sftp_client:
            _sftp_client.close()
        if _sftp_transport:
            _sftp_transport.close()
    except Exception:
        pass
    t = paramiko.Transport((FTP_HOST, FTP_PORT))
    t.connect(username=FTP_USER, password=FTP_PASSWORD)
    _sftp_transport = t
    _sftp_client = paramiko.SFTPClient.from_transport(t)
    return _sftp_client


def _get_ftps(force_reconnect: bool = False):
    """Retourne le FTP_TLS persistant, en (re)créant la connexion si nécessaire."""
    global _ftps_client
    import ftplib
    if not force_reconnect and _ftps_client is not None:
        try:
            _ftps_client.voidcmd("NOOP")
            return _ftps_client
        except Exception:
            pass
    try:
        if _ftps_client:
            _ftps_client.close()
    except Exception:
        pass
    ftp = ftplib.FTP_TLS()
    ftp.connect(FTP_HOST, FTP_PORT)
    ftp.login(FTP_USER, FTP_PASSWORD)
    ftp.prot_p()
    _ftps_client = ftp
    return ftp


def _ftp_breadcrumb(remote_path: str) -> List[Dict[str, str]]:
    """Fil d'Ariane pour un chemin distant POSIX."""
    p = PurePosixPath(remote_path)
    crumbs: List[Dict[str, str]] = []
    parts = p.parts  # ('/', 'var', 'www', …)
    if not parts:
        return [{"name": "/", "path": "/"}]
    cumulative = PurePosixPath(parts[0])
    crumbs.append({"name": parts[0], "path": str(cumulative)})
    for part in parts[1:]:
        cumulative = cumulative / part
        crumbs.append({"name": part, "path": str(cumulative)})
    return crumbs


def _ftp_tree(remote_path: str) -> Dict[str, Any]:
    """
    Liste les sous-répertoires d'un chemin distant via SFTP ou FTPS.
    Réessaie une fois avec reconnexion forcée en cas d'erreur réseau.
    """
    _DATE_RE = re.compile(r"-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$")
    norm = remote_path.rstrip("/") or "/"
    parent_path = str(PurePosixPath(norm).parent) if norm != "/" else None

    def _do_tree(force_reconnect: bool = False) -> List[Dict[str, Any]]:
        if FTP_PROTOCOL == "sftp":
            import stat as stat_mod
            sftp = _get_sftp(force_reconnect)
            entries_raw = sftp.listdir_attr(norm)
            result: List[Dict[str, Any]] = []
            for attr in sorted(entries_raw, key=lambda a: a.filename):
                if not stat_mod.S_ISDIR(attr.st_mode or 0):
                    continue
                name = attr.filename
                full = norm.rstrip("/") + "/" + name
                has_stats = False
                stats_path_remote: Optional[str] = None
                try:
                    sp = full + "/js/stats.json"
                    sftp.stat(sp)          # vérifie l'existence seulement
                    has_stats = True
                    stats_path_remote = sp
                except FileNotFoundError:
                    pass
                m = _DATE_RE.search(name)
                gatling_date: Optional[str] = None
                if m:
                    yr, mo, dy, hh, mm, ss, ms = (int(x) for x in m.groups())
                    gatling_date = (
                        f"{yr:04d}-{mo:02d}-{dy:02d}"
                        f"T{hh:02d}:{mm:02d}:{ss:02d}.{ms:03d}Z"
                    )
                result.append({
                    "name":        name,
                    "path":        full,
                    "hasStats":    has_stats,
                    "statsPath":   stats_path_remote,
                    "gatlingDate": gatling_date,
                })
            return result

        elif FTP_PROTOCOL == "ftps":
            ftp = _get_ftps(force_reconnect)
            ftp.cwd(norm)
            lines: List[str] = []
            ftp.retrlines("LIST", lines.append)
            result = []
            for line in sorted(lines):
                parts = line.split(None, 8)
                if not parts or not parts[0].startswith("d"):
                    continue
                name = parts[-1]
                full = norm.rstrip("/") + "/" + name
                has_stats = False
                stats_path_remote = None
                try:
                    sp = full + "/js/stats.json"
                    listing = ftp.nlst(full + "/js")
                    if any(e.endswith("stats.json") for e in listing):
                        has_stats = True
                        stats_path_remote = sp
                except Exception:
                    pass
                m = _DATE_RE.search(name)
                gatling_date = None
                if m:
                    yr, mo, dy, hh, mm, ss, ms_v = (int(x) for x in m.groups())
                    gatling_date = (
                        f"{yr:04d}-{mo:02d}-{dy:02d}"
                        f"T{hh:02d}:{mm:02d}:{ss:02d}.{ms_v:03d}Z"
                    )
                result.append({
                    "name":        name,
                    "path":        full,
                    "hasStats":    has_stats,
                    "statsPath":   stats_path_remote,
                    "gatlingDate": gatling_date,
                })
            return result
        else:
            raise ValueError(f"Protocole FTP inconnu : {FTP_PROTOCOL!r}")

    if not _ftp_lock.acquire(timeout=60):
        raise TimeoutError("Le serveur FTP est occupé, réessayez dans quelques secondes.")
    try:
        try:
            nodes = _do_tree(force_reconnect=False)
        except Exception:
            # 1ᵉʳ échec → reconnexion forcée et nouvel essai
            nodes = _do_tree(force_reconnect=True)
    finally:
        _ftp_lock.release()

    return {
        "root":       norm,
        "parent":     parent_path if parent_path != norm else None,
        "breadcrumb": _ftp_breadcrumb(norm),
        "nodes":      nodes,
    }


def _ftp_read_stats(remote_path: str) -> bytes:
    """
    Retourne le contenu d'un stats.json distant.
    Sert depuis _ftp_stats_cache si disponible (peuplé par _ftp_tree),
    sinon lit via la connexion persistante avec retry sur reconnexion.
    """
    if remote_path in _ftp_stats_cache:
        return _ftp_stats_cache[remote_path]

    def _do_read(force_reconnect: bool = False) -> bytes:
        if FTP_PROTOCOL == "sftp":
            sftp = _get_sftp(force_reconnect)
            with sftp.open(remote_path, "rb") as f:
                return f.read()
        elif FTP_PROTOCOL == "ftps":
            ftp = _get_ftps(force_reconnect)
            buf = io.BytesIO()
            ftp.retrbinary(f"RETR {remote_path}", buf.write)
            return buf.getvalue()
        else:
            raise ValueError(f"Protocole FTP inconnu : {FTP_PROTOCOL!r}")

    if not _ftp_lock.acquire(timeout=60):
        raise TimeoutError("Le serveur FTP est occupé, réessayez dans quelques secondes.")
    try:
        try:
            data = _do_read(force_reconnect=False)
        except Exception:
            data = _do_read(force_reconnect=True)
        _ftp_stats_cache[remote_path] = data
        return data
    finally:
        _ftp_lock.release()



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

        # /api/ftp/tree  — arborescence distante via SFTP/FTPS
        if parsed.path == "/api/ftp/tree":
            if not _ftp_config_ok():
                self._send_error_json(503, "FTP non configuré. Renseignez FTP_HOST et FTP_USER dans .env")
                return
            path_param = qs.get("path", [None])[0] or FTP_REMOTE_DIR
            try:
                data = _ftp_tree(path_param)
                self._send_json(data)
            except Exception as exc:
                self._send_error_json(502, f"Erreur FTP : {exc}")
            return

        # /api/ftp/stats  — lecture d'un stats.json distant
        if parsed.path == "/api/ftp/stats":
            if not _ftp_config_ok():
                self._send_error_json(503, "FTP non configuré.")
                return
            path_param = qs.get("path", [None])[0]
            if not path_param:
                self._send_error_json(400, "Paramètre 'path' requis.")
                return
            if not path_param.endswith("stats.json"):
                self._send_error_json(403, "Seuls les fichiers stats.json sont autorisés.")
                return
            try:
                content = _ftp_read_stats(path_param)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
            except Exception as exc:
                self._send_error_json(502, f"Erreur FTP : {exc}")
            return

        # /api/config/ftp  — expose la config FTP (sans mot de passe) au frontend
        if parsed.path == "/api/config/ftp":
            self._send_json({
                "configured": _ftp_config_ok(),
                "protocol":   FTP_PROTOCOL,
                "host":       FTP_HOST,
                "port":       FTP_PORT,
                "user":       FTP_USER,
                "remoteDir":  FTP_REMOTE_DIR,
            })
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
    httpd = http.server.ThreadingHTTPServer(addr, Handler)

    print(f"✅  Serveur démarré sur http://localhost:{port}/")
    print(f"📁  Fichiers statiques : {STATIC_DIR}")
    print(f"🎯  Racine Gatling     : {Handler.gatling_root}")
    print(f"    (modifiable via ?root=<chemin> ou en passant un 2ᵉ argument)")
    if _ftp_config_ok():
        print(f"🌐  FTP ({FTP_PROTOCOL.upper()})        : {FTP_USER}@{FTP_HOST}:{FTP_PORT}{FTP_REMOTE_DIR}")
    else:
        print("⚠️   FTP non configuré  (renseignez .env pour activer l'onglet FTP)")
    print("    Ctrl+C pour arrêter.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrêté.")


if __name__ == "__main__":
    main()
