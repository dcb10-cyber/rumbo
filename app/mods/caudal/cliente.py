# -*- coding: utf-8 -*-
"""
[mod] Cliente HTTP para leer de Caudal (solo lectura)
=====================================================
Pide a Caudal sus tres rutas de lectura con el token de solo lectura:

    operaciones  GET /api/v1/inversion/operaciones
    saldos       GET /api/v1/cuentas/saldos?corte=fin_mes
    posiciones   GET /api/v1/inversion/posiciones

No usa red.py del autor porque esa puerta solo deja hacer GET https a su lista de sitios de
precios. Este cliente tiene sus propias reglas:
  - http SOLO para 127.0.0.1 / localhost (Caudal en tu ordenador); para cualquier otra
    dirección, https obligatorio (el token no viaja nunca sin cifrar por la red);
  - solo GET, timeout de 10 s, respuestas de como mucho 20 MB;
  - NO sigue redirecciones (si no, el token podría acabar en otro sitio);
  - manda If-None-Match con la última versión: si nada ha cambiado, Caudal responde 304.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 10
LIMITE = 20 * 1024 * 1024
HOSTS_HTTP = {"127.0.0.1", "localhost", "::1"}
RUTAS = {
    "operaciones": "/api/v1/inversion/operaciones",
    "saldos": "/api/v1/cuentas/saldos?corte=fin_mes",
    "posiciones": "/api/v1/inversion/posiciones",
}


class ErrorCaudal(Exception):
    """No se ha podido leer de Caudal (apagado, sin red, token malo...). No se ha tocado nada."""


class _SinRedirecciones(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None   # una redirección se trata como un error: no se sigue


_ABRIDOR = urllib.request.build_opener(_SinRedirecciones)


def _abrir(peticion, timeout):
    """La única llamada a la red de este mod (las pruebas la sustituyen: nunca salen a internet)."""
    return _ABRIDOR.open(peticion, timeout=timeout)


def comprueba_url(url):
    """La dirección base de Caudal, limpia. Lanza ErrorCaudal si no se permite."""
    partes = urllib.parse.urlsplit(str(url or "").strip())
    host = (partes.hostname or "").lower()
    if partes.username or partes.password:
        raise ErrorCaudal("La dirección de Caudal no puede llevar usuario ni contraseña.")
    if partes.scheme == "http" and host in HOSTS_HTTP:
        pass
    elif partes.scheme == "https" and host:
        pass
    elif partes.scheme == "http":
        raise ErrorCaudal(f"Para conectar con Caudal en «{host}» hace falta https (http solo vale en este ordenador).")
    else:
        raise ErrorCaudal("La dirección de Caudal tiene que empezar por http://127.0.0.1 o por https://.")
    return urllib.parse.urlunsplit((partes.scheme, partes.netloc, partes.path.rstrip("/"), "", ""))


def pide(base, ruta, token, version=None):
    """Una petición. Devuelve (304, version, None) si no ha cambiado o (200, version, cuerpo)."""
    url = comprueba_url(base) + ruta
    cabeceras = {"Authorization": f"Bearer {token}", "Accept": "application/json",
                 "User-Agent": "Rumbo-mod-caudal"}
    if version:
        cabeceras["If-None-Match"] = f'"{version}"'
    peticion = urllib.request.Request(url, headers=cabeceras, method="GET")
    try:
        with _abrir(peticion, TIMEOUT) as r:
            bruto = r.read(LIMITE + 1)
            etag = (r.headers.get("ETag") or "").strip()
    except urllib.error.HTTPError as e:
        e.close()
        if e.code == 304:
            return 304, version, None
        if e.code == 401:
            raise ErrorCaudal("Caudal no acepta el token: revisa «token» en mis_datos/caudal.json "
                              "(tiene que ser igual que CAUDAL_TOKEN_LECTURA en el .env de Caudal).") from None
        if e.code == 503:
            raise ErrorCaudal("Caudal no tiene token de lectura: pon CAUDAL_TOKEN_LECTURA en su .env "
                              "y reinícialo.") from None
        if 300 <= e.code < 400:
            raise ErrorCaudal("Caudal ha respondido con una redirección: no la sigo (revisa la dirección).") from None
        raise ErrorCaudal(f"Caudal ha respondido con un error {e.code}.") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        raise ErrorCaudal("Caudal no responde. ¿Está abierto?") from None
    if len(bruto) > LIMITE:
        raise ErrorCaudal("La respuesta de Caudal es demasiado grande.")
    try:
        cuerpo = json.loads(bruto.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ErrorCaudal("Caudal ha devuelto algo que no entiendo (no es JSON).") from None
    if not isinstance(cuerpo, dict):
        raise ErrorCaudal("Caudal ha devuelto algo que no entiendo.")
    return 200, str(cuerpo.get("version") or etag.removeprefix("W/").strip('"')), cuerpo


def descarga(base, token, versiones):
    """Las tres rutas. versiones: {nombre: última versión que tenemos} (o vacío para pedirlo todo).
    Devuelve {nombre: (estado, version, cuerpo)}; cuerpo es None si no ha cambiado (304)."""
    if not token:
        raise ErrorCaudal("Falta «token» en mis_datos/caudal.json.")
    return {nombre: pide(base, ruta, token, (versiones or {}).get(nombre)) for nombre, ruta in RUTAS.items()}
