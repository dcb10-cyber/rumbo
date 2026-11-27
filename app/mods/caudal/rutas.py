# -*- coding: utf-8 -*-
"""
[mod] Rutas del mod de Caudal y el portero
==========================================
    POST /api/caudal-mod/sincronizar   pregunta a Caudal (con ETag). Si nada ha cambiado, responde
                                       rápido. Si ha cambiado: descarga, traduce, valida (todo o
                                       nada), guarda la foto y recalcula el panel si hace falta.
    GET  /api/caudal-mod/estado        cómo está la sincronización (para la pastilla y la pestaña)
    POST /api/caudal-mod/enlazar       {clase: "activo"|"cuenta", caudal_id, producto} ("" = quitar)

Respuesta de sincronizar: {ok, cambiado, version, sincronizado, comprobado, avisos, errores,
pendientes, conciliacion}. Si Caudal no responde: ok=false y el panel sigue con la última foto.

El portero (before_request, detrás de la seguridad del autor) solo actúa con la sincronización
activa y responde 409 con una explicación al:
  - editar (POST /api/movimientos con id c…) o borrar (DELETE /api/movimientos/c…) algo de Caudal
    (igual con las valoraciones cv…);
  - anotar a mano una compra, venta, dividendo o comisión de un producto enlazado con fecha >= desde;
  - importar (/api/importar/confirmar) o crear aportaciones periódicas (/api/periodicas/crear)
    sobre productos enlazados con fecha >= desde.
Nada de hilos en segundo plano: todo pasa dentro de la petición.
"""
import copy
import datetime as dt
import hashlib
import json
import logging
import os
import re
import threading

from . import capa, cliente, traductor

_SYNC = threading.Lock()   # una sola sincronización a la vez
_ULTIMO = {}               # perfil -> resultado de la última vez que se preguntó a Caudal (en memoria)
_PENDIENTE = {}            # perfil -> lo último descargado que no se pudo guardar (para reintentar al enlazar)
BLOQUEADOS = ("compra", "venta", "dividendo", "comision")
MSG_DE_CAUDAL = "Este movimiento viene de Caudal: edítalo allí."
MSG_VALOR_DE_CAUDAL = "Este saldo viene de Caudal: cámbialo allí."
_ID_OK = re.compile(r"[A-Za-z0-9_.\-]{1,40}")


def _servidor():
    from ... import servidor
    return servidor


def _fmt(fecha):
    return f"{fecha[8:10]}/{fecha[5:7]}/{fecha[:4]}" if fecha and len(fecha) >= 10 else (fecha or "")


def _fmt_hora(iso):
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]} {iso[11:16]}" if iso and len(iso) >= 16 else ""


def _ahora():
    return dt.datetime.now().replace(microsecond=0).isoformat()


def _ruta_cartera(perfil):
    return os.path.join(_servidor().carpeta(perfil), "cartera.json")


def _lee_cartera(perfil):
    """cartera.json del perfil configurado, tal cual (sin capa). None si no tiene."""
    try:
        with open(_ruta_cartera(perfil), "rb") as f:
            bruto = f.read()
        return json.loads(bruto.decode("utf-8")), hashlib.sha256(bruto).hexdigest()
    except (OSError, ValueError):
        return None, None


def _plano(crudo):
    return {"operaciones": (crudo.get("operaciones") or {}).get("operaciones") or [],
            "cuentas": (crudo.get("saldos") or {}).get("cuentas") or [],
            "saldos": (crudo.get("saldos") or {}).get("saldos") or [],
            "posiciones": (crudo.get("posiciones") or {}).get("posiciones") or []}


def _version(crudo):
    partes = [str((crudo.get(n) or {}).get("version") or "") for n in cliente.RUTAS]
    return hashlib.sha256("|".join(partes).encode()).hexdigest()[:16] if any(partes) else None


def _resultado(foto, **extra):
    foto = foto or {}
    r = {"ok": True, "cambiado": False, "version": foto.get("version"), "sincronizado": foto.get("sincronizado"),
         "comprobado": _ahora(), "avisos": list(foto.get("avisos") or []), "errores": [],
         "pendientes": foto.get("pendientes") or [], "conciliacion": foto.get("conciliacion") or []}
    r.update(extra)
    return r


def _foto_vacia(cfgc, enlaces):
    return {"schema": capa.ESQUEMA_FOTO, "perfil": cfgc["perfil"], "desde": cfgc["desde"], "sincronizado": None,
            "version": None, "versiones": {}, "crudo": {}, "huellaCartera": None, "enlaces": enlaces,
            "enlazados": [], "pendientes": [], "avisos": [], "conciliacion": [], "movimientos": [], "valoraciones": []}


def _recalcula_si_toca(perfil):
    s = _servidor()
    activo = s.perfiles()["activo"]
    if activo == perfil and s.modo() == "propio" or activo == s.TODOS:
        s.recalcula(descargar="faltan")


# ---------------------------------------------------------------- traducir, validar y guardar

def _procesa(cfgc, crudo, foto, manuales=None):
    """Traduce y valida lo descargado sobre cartera.json. Si todo vale, guarda la foto nueva.
    Si falla una sola operación, NO guarda nada (se queda la foto anterior) y devuelve los errores.
    Hay que llamarla con servidor.cerrojo cogido."""
    perfil = cfgc["perfil"]
    base, huella = _lee_cartera(perfil)
    if base is None:
        return _resultado(foto, ok=False, errores=[{"fecha": None, "activo": "—", "motivo":
                          f"El perfil «{perfil}» todavía no tiene cartera propia en Rumbo."}])
    if manuales is None:
        manuales = copy.deepcopy((foto or {}).get("enlaces") or {})
    manuales = {"activo": dict(manuales.get("activo") or {}), "cuenta": dict(manuales.get("cuenta") or {})}
    plano = _plano(crudo)
    t = traductor.traduce(plano, base, manuales, cfgc["desde"])
    if t["errores"]:
        _PENDIENTE[perfil] = {"crudo": crudo}
        avisos = ["No se ha guardado nada nuevo de Caudal: hay operaciones que Rumbo no acepta (abajo). "
                  "El panel sigue con los datos anteriores."] + t["avisos"]
        r = _resultado(foto, ok=False, errores=t["errores"], avisos=avisos, pendientes=t["pendientes"])
        _ULTIMO[perfil] = r
        return r
    nueva = {
        "schema": capa.ESQUEMA_FOTO, "perfil": perfil, "desde": cfgc["desde"], "sincronizado": _ahora(),
        "version": _version(crudo), "versiones": {n: (crudo.get(n) or {}).get("version") for n in cliente.RUTAS},
        "crudo": crudo, "huellaCartera": huella, "enlaces": manuales, "enlazados": t["enlazados"],
        "pendientes": t["pendientes"], "avisos": t["avisos"],
        "conciliacion": traductor.concilia(t["cartera"], plano["posiciones"], t["enlazados"]),
        "antesDeDesde": t["antesDeDesde"], "movimientos": t["movimientos"], "valoraciones": t["valoraciones"],
    }
    viejo = foto or {}
    cambiado = (viejo.get("movimientos"), viejo.get("valoraciones")) != (nueva["movimientos"], nueva["valoraciones"])
    capa.guarda_foto(perfil, nueva)
    _PENDIENTE.pop(perfil, None)
    avisos = list(nueva["avisos"]) + [f"Las unidades de «{c['nombre']}» no cuadran: Rumbo {c['rumbo']:g}, Caudal "
                                      f"{c['caudal']:g}." for c in nueva["conciliacion"]]
    r = _resultado(nueva, cambiado=cambiado, avisos=avisos)
    _ULTIMO[perfil] = r
    return r


def sincroniza():
    s = _servidor()
    cfgc = capa.lee_config()
    if not cfgc:
        return {"ok": False, "activo": False, "cambiado": False, "avisos": [], "pendientes": [], "conciliacion": [],
                "errores": [{"fecha": None, "activo": "—", "motivo": "La sincronización con Caudal está desactivada "
                             "(mis_datos/caudal.json no existe o tiene «activo»: false)."}]}
    perfil = cfgc["perfil"]
    if not _SYNC.acquire(blocking=False):
        return _resultado(capa.lee_foto(perfil), ocupado=True)
    try:
        foto = capa.lee_foto(perfil)
        crudo_viejo = (foto or {}).get("crudo") or {}
        versiones = {n: (crudo_viejo.get(n) or {}).get("version") for n in cliente.RUTAS if crudo_viejo.get(n)}
        try:
            respuestas = cliente.descarga(cfgc["url"], cfgc["token"], versiones)
        except cliente.ErrorCaudal as e:
            cuando = _fmt_hora((foto or {}).get("sincronizado"))
            aviso = f"Caudal sin conexión: datos del {cuando}." if cuando else \
                "Caudal sin conexión: todavía no hay datos de Caudal en Rumbo."
            r = _resultado(foto, ok=False, conexion=False, avisos=[aviso],
                           errores=[{"fecha": None, "activo": "—", "motivo": str(e)}])
            _ULTIMO[perfil] = r
            return r
        crudo, problemas = {}, []
        for nombre, (estado, _version_, cuerpo) in respuestas.items():
            if estado == 304:
                if not crudo_viejo.get(nombre):
                    problemas.append(f"Caudal dice que «{nombre}» no ha cambiado, pero no lo tengo guardado.")
                crudo[nombre] = crudo_viejo.get(nombre)
            else:
                problemas += traductor.comprueba_formato(nombre, cuerpo)
                crudo[nombre] = cuerpo
        if problemas:
            r = _resultado(foto, ok=False, errores=[{"fecha": None, "activo": "—", "motivo": p} for p in problemas])
            _ULTIMO[perfil] = r
            return r
        sin_cambios = all(estado == 304 for estado, _, _ in respuestas.values())
        with s.cerrojo:
            _, huella = _lee_cartera(perfil)
            if sin_cambios and foto and foto.get("desde") == cfgc["desde"] and foto.get("huellaCartera") == huella:
                r = _resultado(foto)   # nada nuevo en Caudal ni en tu cartera: respuesta rápida
                _ULTIMO[perfil] = r
                return r
            r = _procesa(cfgc, crudo, foto)
        if r.get("cambiado"):
            _recalcula_si_toca(perfil)
        return r
    finally:
        _SYNC.release()


def enlaza(datos):
    s = _servidor()
    cfgc = capa.lee_config()
    if not cfgc:
        return {"ok": False, "errores": ["La sincronización con Caudal está desactivada."]}, 400
    clase, cid = datos.get("clase"), str(datos.get("caudal_id") or "")
    producto = str(datos.get("producto") or "")
    if clase not in ("activo", "cuenta") or not _ID_OK.fullmatch(cid) or (producto and not _ID_OK.fullmatch(producto)):
        return {"ok": False, "errores": ["Petición no válida."]}, 400
    perfil = cfgc["perfil"]
    with s.cerrojo:
        base, _ = _lee_cartera(perfil)
        if base is None:
            return {"ok": False, "errores": [f"El perfil «{perfil}» todavía no tiene cartera propia."]}, 400
        if producto:
            p = next((x for x in base.get("productos", []) if x.get("id") == producto), None)
            if not p:
                return {"ok": False, "errores": ["Ese producto ya no existe."]}, 400
            solo_saldo = p.get("tipo") in ("efectivo", "deuda")
            if clase == "cuenta" and not solo_saldo:
                return {"ok": False, "errores": ["Una cuenta de Caudal solo se enlaza con un producto de tipo "
                                                 "«Cuenta / efectivo» o «Deuda / préstamo»."]}, 400
            if clase == "activo" and solo_saldo:
                return {"ok": False, "errores": ["Un activo de Caudal no se puede enlazar con una cuenta o una deuda."]}, 400
        foto = capa.lee_foto(perfil)
        manuales = copy.deepcopy((foto or {}).get("enlaces") or {})
        manuales = {"activo": dict(manuales.get("activo") or {}), "cuenta": dict(manuales.get("cuenta") or {})}
        if producto:
            manuales[clase][cid] = producto
        else:
            manuales[clase].pop(cid, None)
        crudo = (_PENDIENTE.get(perfil) or {}).get("crudo") or (foto or {}).get("crudo")
        if not crudo:
            nueva = dict(foto) if foto else _foto_vacia(cfgc, manuales)
            nueva["enlaces"] = manuales
            capa.guarda_foto(perfil, nueva)
            return _resultado(nueva, avisos=["Enlace guardado: se aplicará al sincronizar con Caudal."]), 200
        r = _procesa(cfgc, crudo, foto, manuales=manuales)
        if not r["ok"]:
            # Lo descargado sigue sin valer: se recuerda el enlace, pero el panel sigue con lo anterior.
            nueva = dict(foto) if foto else _foto_vacia(cfgc, manuales)
            nueva["enlaces"] = manuales
            capa.guarda_foto(perfil, nueva)
    if r.get("cambiado"):
        _recalcula_si_toca(perfil)
    return r, 200


def estado():
    s = _servidor()
    cruda = capa.lee_config_cruda()
    cfgc = capa.lee_config()
    if not cfgc:
        return {"ok": True, "activo": False, "configurado": bool(cruda)}
    perfil = cfgc["perfil"]
    foto = capa.lee_foto(perfil) or {}
    ultimo = _ULTIMO.get(perfil)
    base, _ = _lee_cartera(perfil)
    productos = [{"id": p.get("id"), "nombre": traductor.nombre_producto(p), "tipo": p.get("tipo")}
                 for p in (base or {}).get("productos", []) if p.get("id")]
    return {
        "ok": True, "activo": True, "perfil": perfil, "perfilActivo": s.perfiles()["activo"], "desde": cfgc["desde"],
        "url": cliente.comprueba_url(cfgc["url"]) if _url_ok(cfgc["url"]) else cfgc["url"],
        "sincronizado": foto.get("sincronizado"), "version": foto.get("version"),
        "comprobado": (ultimo or {}).get("comprobado"), "conexion": (ultimo or {}).get("conexion", True),
        "ultimoOk": (ultimo or {}).get("ok", True), "errores": (ultimo or {}).get("errores") or [],
        "avisos": (ultimo or foto).get("avisos") or [], "pendientes": foto.get("pendientes") or [],
        "enlazados": foto.get("enlazados") or [], "conciliacion": foto.get("conciliacion") or [],
        "movimientos": len(foto.get("movimientos") or []), "valoraciones": len(foto.get("valoraciones") or []),
        "antesDeDesde": foto.get("antesDeDesde") or 0, "productos": productos,
    }


def _url_ok(url):
    try:
        cliente.comprueba_url(url)
        return True
    except cliente.ErrorCaudal:
        return False


# ---------------------------------------------------------------- portero

def _bloquea(texto):
    from flask import jsonify
    return jsonify(ok=False, caudal=True, errores=[texto]), 409


def _enlazados(cfgc):
    """{producto: nombre} enlazados con Caudal en el perfil activo (vacío si es otro perfil)."""
    s = _servidor()
    if s.perfiles()["activo"] != cfgc["perfil"]:
        return {}
    foto = capa.lee_foto(cfgc["perfil"]) or {}
    return {e["producto"]: e.get("productoNombre") or e["producto"] for e in foto.get("enlazados") or []
            if isinstance(e, dict) and e.get("producto")}


def _explica(nombre, cfgc, que):
    desde = f"desde el {_fmt(cfgc['desde'])}" if cfgc["desde"] else "siempre"
    return (f"«{nombre}» está enlazado con Caudal y se sincroniza {desde}: {que} en Caudal y aparecerá aquí al "
            "sincronizar. Si es de antes de esa fecha, cambia la fecha; para dejar de sincronizar, pon "
            "«activo»: false en mis_datos/caudal.json.")


def portero():
    from flask import request
    try:
        cfgc = capa.lee_config()
    except Exception:
        return None
    if not cfgc:
        return None
    metodo, ruta = request.method, request.path
    if metodo == "DELETE":
        if ruta.startswith("/api/movimientos/") and capa.es_de_caudal(ruta.rsplit("/", 1)[-1]):
            return _bloquea(MSG_DE_CAUDAL)
        if ruta.startswith("/api/valoraciones/") and capa.es_valoracion_de_caudal(ruta.rsplit("/", 1)[-1]):
            return _bloquea(MSG_VALOR_DE_CAUDAL)
        return None
    if metodo != "POST":
        return None
    datos = request.get_json(silent=True) if request.is_json else None
    datos = datos if isinstance(datos, dict) else {}
    if ruta == "/api/movimientos":
        if capa.es_de_caudal(datos.get("id")):
            return _bloquea(MSG_DE_CAUDAL)
        enlazados = _enlazados(cfgc)
        pid, fecha = str(datos.get("producto") or ""), str(datos.get("fecha") or "")[:10]
        if datos.get("tipo") in BLOQUEADOS and pid in enlazados and fecha >= cfgc["desde"]:
            return _bloquea(_explica(enlazados[pid], cfgc, f"anota esta {datos['tipo'].replace('comision', 'comisión')}"))
    elif ruta == "/api/valoraciones":
        if capa.es_valoracion_de_caudal(datos.get("id")):
            return _bloquea(MSG_VALOR_DE_CAUDAL)
    elif ruta == "/api/importar/confirmar":
        enlazados = _enlazados(cfgc)
        plan = _servidor().PLANES.get(datos.get("token"))
        if plan is not None and enlazados:
            tocados = sorted({enlazados[m.get("producto")] for m in list(getattr(plan, "movimientos", []))
                              + list(getattr(plan, "valoraciones", []))
                              if m.get("producto") in enlazados and str(m.get("fecha") or "") >= cfgc["desde"]})
            if tocados:
                return _bloquea(_explica(", ".join(tocados), cfgc, "lo que intentas importar ya se anota"))
    elif ruta == "/api/periodicas/crear":
        enlazados = _enlazados(cfgc)
        pid = str(datos.get("producto") or "")
        hasta = str(datos.get("hasta") or dt.date.today().isoformat())
        if pid in enlazados and hasta >= cfgc["desde"]:
            return _bloquea(_explica(enlazados[pid], cfgc, "anota las aportaciones"))
    return None


def pone_capa_en_respuesta(resp):
    """cambia() devuelve al navegador cartera.json tal cual: se le pone la capa para que «Mis datos»
    no pierda lo de Caudal tras guardar algo."""
    from flask import request
    if request.method not in ("POST", "DELETE") or not request.path.startswith("/api/") \
            or resp.status_code != 200 or not resp.is_json:
        return resp
    try:
        j = resp.get_json(silent=True)
        if not isinstance(j, dict) or not isinstance(j.get("cartera"), dict):
            return resp
        s = _servidor()
        if s.modo() != "propio":
            return resp
        foto = capa.foto_para(s.perfiles()["activo"])
        if foto:
            j["cartera"] = capa.superpone(j["cartera"], foto)
            resp.set_data(json.dumps(j, ensure_ascii=False))
    except Exception:
        logging.exception("[mod caudal] No he podido poner la capa en la respuesta")
    return resp


# ---------------------------------------------------------------- registro

def registra(app):
    from flask import jsonify, request

    def r_sincronizar():
        try:
            return jsonify(sincroniza())
        except Exception as e:   # que el panel no se caiga nunca por esto
            logging.exception("[mod caudal] Fallo al sincronizar")
            return jsonify(ok=False, cambiado=False, avisos=[], pendientes=[], conciliacion=[],
                           errores=[{"fecha": None, "activo": "—", "motivo": f"Fallo inesperado: {e}"}])

    def r_estado():
        try:
            return jsonify(estado())
        except Exception as e:
            logging.exception("[mod caudal] Fallo al leer el estado")
            return jsonify(ok=False, activo=False, error=str(e))

    def r_enlazar():
        cuerpo, codigo = enlaza(request.get_json(silent=True) or {})
        return jsonify(cuerpo), codigo

    app.add_url_rule("/api/caudal-mod/sincronizar", endpoint="api_caudal_mod_sincronizar",
                     view_func=r_sincronizar, methods=["POST"])
    app.add_url_rule("/api/caudal-mod/estado", endpoint="api_caudal_mod_estado", view_func=r_estado, methods=["GET"])
    app.add_url_rule("/api/caudal-mod/enlazar", endpoint="api_caudal_mod_enlazar", view_func=r_enlazar,
                     methods=["POST"])
    # Va detrás de la seguridad del autor (registrada antes): lo de otra web sigue dando 403.
    app.before_request(portero)
    app.after_request(pone_capa_en_respuesta)
