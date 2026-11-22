# -*- coding: utf-8 -*-
"""
empresa_mod.py  ·  [mod] Datos extra de acciones y ETF
======================================================
Archivo propio (no es del autor original). Para cada acción o ETF con precio de
Yahoo Finance, pide a Yahoo:

  - el historial de dividendos que paga (fecha de corte e importe por acción),
  - los splits (cuando una acción se divide, por ejemplo 2 por 1),
  - el precio del último año, para saber el máximo y el mínimo de 52 semanas.

Con eso calcula la rentabilidad por dividendo, cómo ha crecido el dividendo, cuándo
toca el próximo, cuánto te correspondía en cada pago según los títulos que tenías y
si lo tienes anotado en tus movimientos.

Igual que el resto de Rumbo: solo sale a internet por red.py, a Yahoo, y en la
petición solo va el ticker. Se guarda en la cache (mis_datos/cache/EMPRESA_*.json) y se
vuelve a pedir como mucho cada CADUCA_HORAS. Si Yahoo no responde, se usa lo guardado;
si no hay nada guardado, el panel simplemente no enseña esta parte.

Lo engancha servidor.py con empresa_mod.registra(...) y lo pinta web/empresa_mod.js.
"""

import datetime as dt
import json
import os
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from . import red
from .motor import UA

CADUCA_HORAS = 12
TIPOS = ("accion", "etf")
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
FRECUENCIAS = {12: "Mensual", 4: "Trimestral", 2: "Semestral", 1: "Anual"}


def aplica(p):
    """¿Tiene sentido buscar estos datos para este producto?"""
    return p.get("fuente") == "yahoo" and p.get("tipo") in TIPOS and bool(p.get("codigo"))


# ---------------------------------------------------------------- descarga

def _get(url):
    with red.abrir(url, UA, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _fecha(ts, desfase=0):
    return dt.datetime.fromtimestamp(int(ts) + int(desfase or 0), dt.timezone.utc).date().isoformat()


def lee_largo(bruto):
    """Del histórico mensual con eventos: dividendos, splits y datos de la cotización."""
    res = bruto["chart"]["result"][0]
    meta = res.get("meta") or {}
    desfase = meta.get("gmtoffset") or 0
    ev = res.get("events") or {}
    divs = sorted((_fecha(x.get("date", k), desfase), float(x["amount"]))
                  for k, x in (ev.get("dividends") or {}).items() if x.get("amount"))
    splits = []
    for k, x in (ev.get("splits") or {}).items():
        num, den = x.get("numerator"), x.get("denominator")
        if num and den and num != den:
            splits.append((_fecha(x.get("date", k), desfase), float(num), float(den)))
    splits.sort()
    return {"moneda": meta.get("currency"), "nombre": meta.get("longName") or meta.get("shortName"),
            "max52": meta.get("fiftyTwoWeekHigh"), "min52": meta.get("fiftyTwoWeekLow"),
            "dividendos": divs, "splits": splits}


def lee_anual(bruto):
    """Del último año diario: último cierre y máximo y mínimo de 52 semanas (con su fecha)."""
    res = bruto["chart"]["result"][0]
    desfase = (res.get("meta") or {}).get("gmtoffset") or 0
    q = (res.get("indicators") or {}).get("quote", [{}])[0]
    ts = res.get("timestamp") or []
    cierres = [(t, c) for t, c in zip(ts, q.get("close") or []) if c is not None]
    if not cierres:
        return {}
    altos = [(h, t) for t, h in zip(ts, q.get("high") or []) if h is not None] or [(c, t) for t, c in cierres]
    bajos = [(b, t) for t, b in zip(ts, q.get("low") or []) if b is not None] or [(c, t) for t, c in cierres]
    alto, bajo = max(altos), min(bajos)
    return {"precio": cierres[-1][1], "fechaPrecio": _fecha(cierres[-1][0], desfase),
            "max52": alto[0], "fechaMax52": _fecha(alto[1], desfase),
            "min52": bajo[0], "fechaMin52": _fecha(bajo[1], desfase)}


def descarga(simbolo):
    """Lo que hace falta de Yahoo para un ticker (dos peticiones pequeñas)."""
    sym = urllib.parse.quote(simbolo)
    ahora = int(time.time())
    largo = lee_largo(_get(f"{CHART}{sym}?period1=0&period2={ahora}&interval=1mo&events=div%2Csplits"))
    anual = lee_anual(_get(f"{CHART}{sym}?range=1y&interval=1d"))
    datos = dict(largo)
    for k, v in anual.items():
        if v is not None:
            datos[k] = v
    return datos


def obten(simbolo, cache, red_ok=True):
    """Datos del ticker: de la cache si son recientes; si no, de Yahoo (y si falla, lo guardado)."""
    os.makedirs(cache, exist_ok=True)
    ruta = os.path.join(cache, "EMPRESA_" + re.sub(r"[^A-Za-z0-9]", "_", simbolo) + ".json")
    guardado = None
    try:
        with open(ruta, encoding="utf-8") as f:
            guardado = json.load(f)
    except (OSError, ValueError):
        pass
    if guardado:
        try:
            edad = dt.datetime.now() - dt.datetime.fromisoformat(guardado["consulta"])
            if edad < dt.timedelta(hours=CADUCA_HORAS) or not red_ok:
                return guardado
        except (KeyError, ValueError):
            pass
    if not red_ok:
        return None
    try:
        datos = descarga(simbolo)
    except Exception:
        if guardado:
            guardado["sinConexion"] = True
        return guardado
    nuevo = {"consulta": dt.datetime.now().replace(microsecond=0).isoformat(), "datos": datos}
    try:
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(nuevo, f, ensure_ascii=False)
    except OSError:
        pass
    return nuevo


# ---------------------------------------------------------------- cuentas

ORDEN_MOV = {"compra": 0, "comision": 1, "dividendo": 2, "venta": 3, "traspaso": 4, "ajuste": 6}


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


# ---------------------------------------------------------------- la ruta del servidor

def calcula(cfg, cache, red_ok=True, hoy=None):
    """{id del producto: métricas} para las acciones y ETF de la cartera."""
    prods = [p for p in cfg.get("productos", []) if aplica(p)]
    simbolos = sorted({p["codigo"] for p in prods})
    with ThreadPoolExecutor(max_workers=6) as ex:
        brutos = dict(zip(simbolos, ex.map(lambda s: obten(s, cache, red_ok), simbolos)))
    salida = {}
    for p in prods:
        b = brutos.get(p["codigo"])
        if not b or not b.get("datos"):
            continue
        movs = [m for m in cfg.get("movimientos", []) if m.get("producto") == p["id"]]
        try:
            salida[p["id"]] = metricas({**b, "simbolo": p["codigo"]}, movs, hoy)
        except Exception:   # que un dato raro de Yahoo no rompa el panel
            continue
    return salida


def registra(app, cartera, carpeta_cache):
    """Añade la ruta /api/empresa-mod al servidor. cartera() y carpeta_cache() son del servidor."""
    from flask import jsonify

    @app.get("/api/empresa-mod")
    def api_empresa_mod():
        try:
            return jsonify(ok=True, productos=calcula(cartera(), carpeta_cache()))
        except Exception as e:
            return jsonify(ok=False, productos={}, error=str(e)), 200
