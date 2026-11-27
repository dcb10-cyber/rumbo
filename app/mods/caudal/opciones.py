# -*- coding: utf-8 -*-
"""
[mod] Opciones de Caudal en Rumbo (solo se enseñan: se apuntan en Caudal)
=========================================================================
Rumbo NO entiende de opciones: solo enseña lo que le da Caudal. Al sincronizar, después de lo de
siempre (operaciones, saldos y posiciones, schema 1), se piden con el mismo token y ETag:

    resultados   GET /api/v1/opciones/lectura/resultados         → IRPF (ganancias y pérdidas)
    abiertas     GET /api/v1/opciones/lectura/abiertas           → pestaña «Opciones»
    pasivo       GET /api/v1/opciones/lectura/pasivo?corte=fin_mes → patrimonio (producto deuda)
    campanas     GET /api/v1/opciones/lectura/campanas           → pestaña «Opciones»

Se validan (schema 1) y se guardan en la foto, en crudo["opciones"]. NUNCA bloquean lo de siempre:
si fallan, se queda lo anterior y se avisa; si Caudal responde 404 (sin módulo de opciones), Rumbo
sigue como hoy con el aviso «Caudal sin módulo de opciones».

Las acciones de una asignación ya llegan solas por /inversion/operaciones como compra o venta normal
(al valor fiscal del criterio de Caudal): aquí no hay que tocar nada para eso.

Pasivo: si en la pestaña «Caudal» enlazas «Opciones vendidas abiertas» con un producto de tipo deuda,
la prima de las cortas abiertas a cada fin de mes se convierte en valores anotados de ese producto
(ids cvop_<fecha>, origen caudal), con almacen.guarda_valoracion en la copia en memoria. Rumbo resta
las deudas del patrimonio: así no se infla con primas que aún no son tuyas.
"""
import datetime as dt

from ... import almacen
from . import capa, cliente

RUTAS = {
    "resultados": "/api/v1/opciones/lectura/resultados",
    "abiertas": "/api/v1/opciones/lectura/abiertas",
    "pasivo": "/api/v1/opciones/lectura/pasivo?corte=fin_mes",
    "campanas": "/api/v1/opciones/lectura/campanas",
}
CLAVES = {"resultados": "resultados", "abiertas": "abiertas", "pasivo": "pasivo", "campanas": "campanas"}
AVISO_SIN_MODULO = "Caudal sin módulo de opciones: lo demás sigue igual."
PREFIJO_PASIVO = "cvop_"


def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def comprueba_formato(nombre, cuerpo):
    """Problemas de forma (lista vacía si vale)."""
    if not isinstance(cuerpo, dict) or cuerpo.get("schema") != 1 or not isinstance(cuerpo.get("version"), str):
        return [f"Caudal ha mandado las opciones «{nombre}» con un formato que no conozco (schema distinto de 1)."]
    lista = cuerpo.get(CLAVES[nombre])
    if not isinstance(lista, list) or not all(isinstance(x, dict) for x in lista):
        return [f"A las opciones «{nombre}» de Caudal les falta la lista «{CLAVES[nombre]}»."]
    if nombre == "resultados":
        for r in lista:
            if not isinstance(r.get("ejercicio"), int) or not isinstance(r.get("fecha"), str) \
                    or not isinstance(r.get("resultado_eur"), (int, float)) or not isinstance(r.get("contrato"), dict):
                return [f"Un resultado de opciones de Caudal está mal formado: {str(r)[:120]}"]
    if nombre == "pasivo":
        for p in lista:
            if not isinstance(p.get("fecha"), str) or len(p["fecha"]) != 10 or not isinstance(p.get("pasivo_eur"), (int, float)):
                return [f"Un dato del pasivo de opciones de Caudal está mal formado: {str(p)[:120]}"]
    return []


def sincroniza(cfgc, viejo):
    """Pide las 4 rutas (con las versiones que ya se tienen). Devuelve (nuevo, avisos, cambiado).
    nuevo = {"disponible": bool, "rutas": {nombre: cuerpo}, "aviso": texto o None, "comprobado": iso}.
    Nunca lanza: si algo falla, se queda lo anterior."""
    viejo = viejo if isinstance(viejo, dict) else {}
    rutas_viejas = viejo.get("rutas") if isinstance(viejo.get("rutas"), dict) else {}
    ahora = dt.datetime.now().replace(microsecond=0).isoformat()
    nuevas, problemas = {}, []
    try:
        for nombre, ruta in RUTAS.items():
            version = (rutas_viejas.get(nombre) or {}).get("version")
            estado, _version, cuerpo = cliente.pide(cfgc["url"], ruta, cfgc["token"], version)
            if estado == 304:
                if not rutas_viejas.get(nombre):
                    problemas.append(f"Caudal dice que las opciones «{nombre}» no han cambiado, pero no las tengo guardadas.")
                nuevas[nombre] = rutas_viejas.get(nombre)
            else:
                problemas += comprueba_formato(nombre, cuerpo)
                nuevas[nombre] = cuerpo
    except cliente.NoExiste:
        nuevo = {"disponible": False, "rutas": {}, "aviso": AVISO_SIN_MODULO, "comprobado": ahora}
        return nuevo, [AVISO_SIN_MODULO], bool(rutas_viejas)
    except Exception as e:   # sin conexión, token… o cualquier otra cosa: se queda lo de antes
        aviso = f"No he podido leer las opciones de Caudal ({e}): sigo con las de antes."
        return dict(viejo, aviso=aviso, comprobado=ahora), [aviso], False
    if problemas:
        aviso = "Las opciones de Caudal no tienen el formato esperado: sigo con las de antes. " + problemas[0]
        return dict(viejo, aviso=aviso, comprobado=ahora), [aviso], False
    nuevo = {"disponible": True, "rutas": nuevas, "aviso": None, "comprobado": ahora}
    return nuevo, [], nuevas != rutas_viejas


# ---------------------------------------------------------------- pasivo → valores de un producto deuda

def valoraciones_pasivo(opc, producto, copia, desde, hoy=None):
    """Valores anotados del producto deuda con la prima de las cortas abiertas a cada fin de mes.
    Devuelve (valoraciones, avisos). copia: la cartera en memoria (como en el traductor)."""
    if not producto or not isinstance(opc, dict) or not opc.get("disponible"):
        return [], []
    p = next((x for x in copia.get("productos", []) if x.get("id") == producto), None)
    if not p or p.get("tipo") != "deuda":
        return [], ["El enlace de las opciones vendidas apunta a un producto que ya no es una deuda: enlázalo otra vez."]
    hoy = hoy or dt.date.today().isoformat()
    salida, avisos = [], []
    for x in ((opc.get("rutas") or {}).get("pasivo") or {}).get("pasivo") or []:
        fecha = str(x.get("fecha") or "")
        if fecha < (desde or "") or fecha > hoy:
            continue
        try:
            v = almacen.guarda_valoracion(copia, {"producto": producto, "fecha": fecha, "valor": round(_num(x.get("pasivo_eur")), 2)})
        except almacen.ErrorValidacion as e:
            avisos.append(f"Pasivo de opciones del {fecha}: {' '.join(e.errores)}")
            continue
        salida.append({"id": f"{PREFIJO_PASIVO}{fecha}", "fecha": v["fecha"], "producto": v["producto"],
                       "valor": v["valor"], "origen": "caudal"})
    return salida, avisos


# ---------------------------------------------------------------- IRPF

def _foto_activa():
    from ... import servidor
    return capa.foto_para(servidor.perfiles()["activo"])


def opciones_de_foto(foto):
    return ((foto or {}).get("crudo") or {}).get("opciones") or {}


def resumen_irpf(foto=None):
    """{"disponible", "criterio", "aviso", "porAno": {"2026": {resultados, ganancias, perdidas, saldo,
    saldoOtro, csv}}} con los resultados del criterio que manda Caudal. Vacío si no hay."""
    foto = _foto_activa() if foto is None else foto
    opc = opciones_de_foto(foto)
    cuerpo = (opc.get("rutas") or {}).get("resultados") or {}
    criterio = cuerpo.get("criterio") or "dgt"
    por_ano = {}
    for r in cuerpo.get("resultados") or []:
        a = por_ano.setdefault(str(r["ejercicio"]), {"resultados": [], "ganancias": 0.0, "perdidas": 0.0, "saldoOtro": 0.0})
        res = _num(r.get("resultado_eur"))
        a["resultados"].append({"fecha": r.get("fecha"), "contrato": (r.get("contrato") or {}).get("nombre"),
                                "simbolo": (r.get("contrato") or {}).get("simbolo_occ"), "subtipo": r.get("subtipo"),
                                "transmision": _num(r.get("transmision_eur")), "adquisicion": _num(r.get("adquisicion_eur")),
                                "resultado": res, "otro": _num(r.get("resultado_otro_criterio_eur"))})
        if res >= 0:
            a["ganancias"] += res
        else:
            a["perdidas"] += res
        a["saldoOtro"] += _num(r.get("resultado_otro_criterio_eur"))
    for ano, a in por_ano.items():
        a["ganancias"], a["perdidas"] = round(a["ganancias"], 2), round(a["perdidas"], 2)
        a["saldo"] = round(a["ganancias"] + a["perdidas"], 2)
        a["saldoOtro"] = round(a["saldoOtro"], 2)
        a["csv"] = _csv(ano, criterio, a["resultados"])
    return {"disponible": bool(opc.get("disponible")), "criterio": criterio, "aviso": opc.get("aviso"), "porAno": por_ano}


def _csv(ano, criterio, filas):
    e = lambda v: f"{v:.2f}".replace(".", ",")  # noqa: E731
    lineas = [f"Opciones {ano} (de Caudal) · criterio {'DGT' if criterio == 'dgt' else 'bróker'}",
              "Fecha;Contrato;Símbolo OCC;Operación;Transmisión (€);Adquisición (€);Ganancia o pérdida (€)"]
    for r in filas:
        lineas.append(";".join([str(r["fecha"]), str(r["contrato"] or ""), str(r["simbolo"] or ""), str(r["subtipo"] or ""),
                                e(r["transmision"]), e(r["adquisicion"]), e(r["resultado"])]))
    return "\r\n".join(lineas) + "\r\n"


# ---------------------------------------------------------------- pestaña «Opciones» y estado

def datos_pestana(foto=None):
    foto = _foto_activa() if foto is None else foto
    opc = opciones_de_foto(foto)
    rutas = opc.get("rutas") or {}
    return {"ok": True, "configurado": foto is not None, "disponible": bool(opc.get("disponible")),
            "aviso": opc.get("aviso"), "comprobado": opc.get("comprobado"),
            "abiertas": (rutas.get("abiertas") or {}).get("abiertas") or [],
            "fecha": (rutas.get("abiertas") or {}).get("fecha"),
            "campanas": (rutas.get("campanas") or {}).get("campanas") or [],
            "pasivo": (rutas.get("pasivo") or {}).get("pasivo") or [],
            "irpf": resumen_irpf(foto)}


def estado(foto, manuales):
    opc = opciones_de_foto(foto)
    return {"disponible": bool(opc.get("disponible")), "aviso": opc.get("aviso"),
            "pasivo": ((manuales or {}).get("opciones") or {}).get("pasivo") or "",
            "abiertas": len(((opc.get("rutas") or {}).get("abiertas") or {}).get("abiertas") or []),
            "resultados": len(((opc.get("rutas") or {}).get("resultados") or {}).get("resultados") or [])}


def registra(app):
    from flask import jsonify

    def r_opciones():
        try:
            return jsonify(datos_pestana())
        except Exception as e:   # la pestaña nunca puede romper el panel
            return jsonify(ok=False, error=str(e), abiertas=[], campanas=[], pasivo=[], irpf={"porAno": {}})

    app.add_url_rule("/api/caudal-mod/opciones", endpoint="api_caudal_mod_opciones", view_func=r_opciones, methods=["GET"])
