# -*- coding: utf-8 -*-
"""
[mod] Nivel 1 · Dividendos, splits y 52 semanas de acciones y ETF.

Con el historial de dividendos y splits de Yahoo y tus movimientos calcula la
rentabilidad por dividendo, cómo ha crecido, cuándo toca el próximo, cuánto te
correspondía en cada pago según los títulos que tenías y si lo tienes anotado.
Lo pinta web/mods/empresa/dividendos.js.
"""

import datetime as dt

from .. import cache
from . import yahoo
from .comun import TIPOS, por_producto

PREFIJO = "EMPRESA_"
CADUCA = dt.timedelta(hours=12)
FRECUENCIAS = {12: "Mensual", 4: "Trimestral", 2: "Semestral", 1: "Anual"}
ORDEN_MOV = {"compra": 0, "comision": 1, "dividendo": 2, "venta": 3, "traspaso": 4, "ajuste": 6}


def obten(simbolo, carpeta):
    return cache.obten(carpeta, PREFIJO, simbolo, lambda g: CADUCA, lambda: yahoo.descarga_cotizacion(simbolo))


def titulos_en(movs, fecha):
    """Títulos que tenías justo antes de la fecha (lo comprado ese mismo día ya no cobra el dividendo)."""
    n = 0.0
    for m in sorted(movs, key=lambda m: (m.get("fecha") or "", ORDEN_MOV.get(m.get("tipo"), 5))):
        if (m.get("fecha") or "") >= fecha:
            break
        u = float(m.get("unidades") or 0)
        if m.get("tipo") == "compra":
            n += u
        elif m.get("tipo") == "venta":
            n -= u
        elif m.get("tipo") == "ajuste":
            n = u   # el ajuste dice cuántas tienes, no cuántas cambian
    return max(0.0, n)


def _frecuencia(divs, hoy):
    """Pagos al año (12, 4, 2 o 1) mirando los dos últimos años, o None si es irregular."""
    hace2 = (hoy - dt.timedelta(days=730)).isoformat()
    por_ano = sum(1 for f, _ in divs if f > hace2) / 2
    if not por_ano:
        return None
    cerca = min(FRECUENCIAS, key=lambda k: abs(k - por_ano))
    return cerca if abs(cerca - por_ano) <= max(0.5, cerca * 0.3) else None


def _mas(fecha_iso, dias):
    return (dt.date.fromisoformat(fecha_iso) + dt.timedelta(days=dias)).isoformat()


def metricas(guardado, movs, hoy=None):
    """Todo lo que pinta el panel para un producto. Importes en la moneda de cotización
    (el navegador los pasa a euros con el precio de hoy del propio producto)."""
    hoy = hoy or dt.date.today()
    d = guardado.get("datos") or {}
    divs = [tuple(x) for x in d.get("dividendos") or []]
    splits = [tuple(x) for x in d.get("splits") or []]
    precio = d.get("precio")

    # Cotizaciones en peniques (Londres, «GBp»): a veces Yahoo da el dividendo en libras.
    if (d.get("moneda") == "GBp" and precio and divs
            and sum(a for f, a in divs if f > (hoy - dt.timedelta(days=365)).isoformat()) / precio < 0.003):
        divs = [(f, a * 100) for f, a in divs]

    hace1 = (hoy - dt.timedelta(days=365)).isoformat()
    dps12 = sum(a for f, a in divs if f > hace1)
    por_ano = {}
    for f, a in divs:
        por_ano[int(f[:4])] = por_ano.get(int(f[:4]), 0.0) + a
    ultimo_completo = hoy.year - 1

    def racha(cond):
        n, y = 0, ultimo_completo
        while cond(y):
            n, y = n + 1, y - 1
        return n

    racha_pagando = racha(lambda y: por_ano.get(y, 0) > 0)
    racha_subiendo = racha(lambda y: por_ano.get(y - 1, 0) > 0 and por_ano.get(y, 0) > por_ano[y - 1] * 1.001)
    racha_sin_recorte = racha(lambda y: por_ano.get(y - 1, 0) > 0 and por_ano.get(y, 0) >= por_ano[y - 1] * 0.99)

    def crece(anos):
        a, b = por_ano.get(ultimo_completo - anos, 0), por_ano.get(ultimo_completo, 0)
        return (b / a) ** (1 / anos) - 1 if a > 0 and b > 0 else None

    freq = _frecuencia(divs, hoy)

    # Próximo pago, estimado: el último más el hueco habitual entre pagos.
    proximo = None
    if freq and divs:
        huecos = sorted((dt.date.fromisoformat(b[0]) - dt.date.fromisoformat(a[0])).days
                        for a, b in zip(divs[-6:], divs[-5:]))
        hueco = huecos[len(huecos) // 2] if huecos else round(365 / freq)
        fecha = _mas(divs[-1][0], hueco)
        # Trimestrales y mensuales: como el último. Semestrales y anuales: como el de hace un año
        # (el dividendo a cuenta y el complementario no suelen ser iguales).
        importe = divs[-1][1] if freq >= 4 or len(divs) < freq else divs[-freq][1]
        proximo = {"fecha": fecha, "importe": importe, "atrasado": fecha < hoy.isoformat()}

    # Cada dividendo: cuántos títulos tenías, cuánto te tocaba y si lo tienes anotado.
    def factor_split(fecha):
        f = 1.0
        for fs, num, den in splits:
            if fs > fecha:
                f *= num / den
        return f

    mios = sorted(((m.get("fecha"), float(m.get("importe") or 0), m.get("id"))
                   for m in movs if m.get("tipo") == "dividendo" and m.get("fecha")), key=lambda x: x[0])
    usados = set()
    filas = []
    primera = min((m["fecha"] for m in movs if m.get("tipo") == "compra" and m.get("fecha")), default=None)
    for f, a in divs:
        real = a * factor_split(f)   # lo que pagó de verdad por acción ese día (sin ajustar por splits posteriores)
        tit = titulos_en(movs, f) if primera and f > primera else 0.0
        fila = {"fecha": f, "importe": round(real, 6), "titulos": round(tit, 6) if tit else 0,
                "teToca": round(tit * real, 4) if tit else 0, "anotado": None, "estado": None}
        if tit:
            desde, hasta = _mas(f, -5), _mas(f, 75)
            hallado = next((x for x in mios if desde <= x[0] <= hasta and x[2] not in usados), None)
            if hallado:
                usados.add(hallado[2])
                fila["anotado"] = {"fecha": hallado[0], "importe": round(hallado[1], 2)}
                fila["estado"] = "anotado"
            else:
                fila["estado"] = "porCobrar" if f > _mas(hoy.isoformat(), -45) else "sinAnotar"
        filas.append(fila)
    filas.reverse()

    # Splits: si hubo uno después de tu primera compra, tiene que estar anotado como «Ajuste de participaciones».
    ajustes = [m["fecha"] for m in movs if m.get("tipo") == "ajuste" and m.get("fecha")]
    lista_splits = []
    for fs, num, den in reversed(splits):
        tras = bool(primera and fs > primera and fs <= hoy.isoformat())
        lista_splits.append({
            "fecha": fs, "num": num, "den": den,
            "texto": f"{num:g} por {den:g}" if num > den else f"contrasplit {den:g} a {num:g}",
            "despuesDeComprar": tras,
            "anotado": any(_mas(fs, -10) <= a <= _mas(fs, 60) for a in ajustes) if tras else None,
        })

    cobrado12 = sum(x[1] for x in mios if x[0] > hace1)
    toca12 = sum(x["teToca"] for x in filas if x["fecha"] > hace1)
    r = lambda v, n=6: round(v, n) if v is not None else None   # noqa: E731
    return {
        "simbolo": guardado.get("simbolo"), "moneda": d.get("moneda"), "nombre": d.get("nombre"),
        "consulta": guardado.get("consulta"), "sinConexion": bool(guardado.get("sinConexion")),
        "precio": r(precio), "fechaPrecio": d.get("fechaPrecio"),
        "max52": r(d.get("max52")), "fechaMax52": d.get("fechaMax52"),
        "min52": r(d.get("min52")), "fechaMin52": d.get("fechaMin52"),
        "dps12": r(dps12), "rentabilidad": r(dps12 / precio) if precio and dps12 else (0 if precio else None),
        "frecuencia": freq, "frecuenciaTexto": FRECUENCIAS.get(freq) if freq else ("Irregular" if divs else None),
        "porAno": [[y, r(v)] for y, v in sorted(por_ano.items())], "anoActual": hoy.year,
        "crece1": r(crece(1)), "crece5": r(crece(5)), "crece10": r(crece(10)),
        "rachaPagando": racha_pagando, "rachaSubiendo": racha_subiendo, "rachaSinRecorte": racha_sin_recorte,
        "proximo": proximo, "dividendos": filas, "splits": lista_splits,
        "toca12": r(toca12, 4), "cobrado12Eur": round(cobrado12, 2),
        "primeraCompra": primera,
    }


def calcula(cfg, carpeta, hoy=None):
    """{id del producto: métricas de dividendos y precio} para las acciones y ETF de la cartera."""
    def uno(p, guardado):
        if not guardado or not guardado.get("datos"):
            return None
        movs = [m for m in cfg.get("movimientos", []) if m.get("producto") == p["id"]]
        return metricas({**guardado, "simbolo": p["codigo"]}, movs, hoy)

    return por_producto(cfg, TIPOS, lambda p: obten(p["codigo"], carpeta), uno)
