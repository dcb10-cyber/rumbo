# -*- coding: utf-8 -*-
"""
empresa_mod.py  ·  [mod] Datos extra de acciones y ETF
======================================================
Archivo propio (no es del autor original). Para cada acción o ETF con precio de
Yahoo Finance, pide a Yahoo:

  - el historial de dividendos que paga (fecha de corte e importe por acción),
  - los splits (cuando una acción se divide, por ejemplo 2 por 1),
  - el precio del último año, para saber el máximo y el mínimo de 52 semanas.

Nivel 2 («la empresa en cifras»), también de Yahoo y solo con el ticker: ratios de
valoración (PER, P/VC...), sector e industria y las cuentas de los últimos años, de las
que salen ROE, márgenes, deuda, crecimiento y payout. Va en otra ruta
(/api/empresa-mod/cifras) para que los dividendos no tengan que esperarla.

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


# ---------------------------------------------------------------- nivel 2: la empresa en cifras (Yahoo)
# Morningstar rechaza estas consultas (responde 401), así que las cifras salen de Yahoo:
# ratios de valoración del día y las cuentas anuales de los últimos años. Comprobado con
# acciones de EE. UU., España y Alemania (también las líneas .F y .DE).

FUND = "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"
BUSCA_YAHOO = "https://query2.finance.yahoo.com/v1/finance/search?"
CADUCA_FUND_DIAS = 3
RATIOS = ["trailingPeRatio", "trailingForwardPeRatio", "trailingPbRatio", "trailingPsRatio", "trailingPegRatio",
          "trailingMarketCap", "trailingEnterprisesValueEBITDARatio"]
ANUALES = ["TotalRevenue", "GrossProfit", "OperatingIncome", "NetIncome", "DilutedEPS", "EBITDA", "FreeCashFlow",
           "StockholdersEquity", "TotalAssets", "TotalDebt", "NetDebt", "CurrentAssets", "CurrentLiabilities",
           "CashDividendsPaid", "OrdinarySharesNumber"]
SECTORES_YAHOO = {"technology": "Tecnología", "healthcare": "Salud", "financial services": "Financiero",
                  "consumer cyclical": "Consumo discrecional", "consumer defensive": "Consumo básico",
                  "energy": "Energía", "industrials": "Industrial", "basic materials": "Materiales",
                  "real estate": "Inmobiliario", "utilities": "Utilities", "communication services": "Comunicaciones"}


def _ultimo(serie):
    """Último valor de una serie de Yahoo: (fecha, valor, moneda) o None."""
    vals = [x for x in serie or [] if x and (x.get("reportedValue") or {}).get("raw") is not None]
    if not vals:
        return None
    x = vals[-1]
    return x.get("asOfDate"), float(x["reportedValue"]["raw"]), x.get("currencyCode")


def lee_fundamentales(bruto):
    """{tipo: [(fecha, valor, moneda), ...]} de la respuesta de Yahoo."""
    out = {}
    for r in (bruto.get("timeseries") or {}).get("result") or []:
        tipo = ((r.get("meta") or {}).get("type") or [None])[0]
        if not tipo:
            continue
        out[tipo] = [(x.get("asOfDate"), float(x["reportedValue"]["raw"]), x.get("currencyCode"))
                     for x in r.get(tipo) or [] if x and (x.get("reportedValue") or {}).get("raw") is not None]
    return out


def descarga_fund(simbolo):
    """Ratios y cuentas anuales de Yahoo, y el sector e industria de su buscador."""
    ahora = int(time.time())
    tipos = RATIOS + ["annual" + t for t in ANUALES]
    url = (FUND + urllib.parse.quote(simbolo) + "?" + urllib.parse.urlencode(
        {"type": ",".join(tipos), "period1": ahora - 7 * 365 * 86400, "period2": ahora}))
    datos = {"series": lee_fundamentales(_get(url))}
    try:
        b = _get(BUSCA_YAHOO + urllib.parse.urlencode({"q": simbolo, "quotesCount": 3, "newsCount": 0}))
        q = next((x for x in b.get("quotes") or [] if x.get("symbol") == simbolo), None)
        if q:
            datos["sector"] = q.get("sectorDisp") or q.get("sector")
            datos["industria"] = q.get("industryDisp") or q.get("industry")
    except Exception:
        pass
    return datos


def obten_fund(simbolo, cache, red_ok=True):
    os.makedirs(cache, exist_ok=True)
    ruta = os.path.join(cache, "EMPRESA_FUND_" + re.sub(r"[^A-Za-z0-9]", "_", simbolo) + ".json")
    guardado = None
    try:
        with open(ruta, encoding="utf-8") as f:
            guardado = json.load(f)
        edad = dt.datetime.now() - dt.datetime.fromisoformat(guardado["consulta"])
        lleno = bool((guardado.get("datos") or {}).get("series"))
        # Si Yahoo no dio nada, se reintenta antes: puede haber sido un fallo pasajero.
        if edad < (dt.timedelta(days=CADUCA_FUND_DIAS) if lleno else dt.timedelta(hours=6)) or not red_ok:
            return guardado
    except (OSError, ValueError, KeyError, TypeError):
        pass
    if not red_ok:
        return guardado
    try:
        datos = descarga_fund(simbolo)
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


def cifras(guardado):
    """Lo que pinta «La empresa en cifras». Los cocientes salen de la misma cuenta anual
    (misma moneda), así que valen aunque la empresa presente en coronas o en dólares."""
    d = (guardado or {}).get("datos") or {}
    se = d.get("series") or {}
    if not se:
        return None
    u = {k: _ultimo([{"asOfDate": f, "reportedValue": {"raw": v}, "currencyCode": m} for f, v, m in se.get(k) or []])
         for k in se}
    val = lambda k: u[k][1] if u.get(k) else None   # noqa: E731
    div = lambda a, b: a / b if a is not None and b not in (None, 0) else None   # noqa: E731

    ventas, neto, fondos = val("annualTotalRevenue"), val("annualNetIncome"), val("annualStockholdersEquity")
    out = {
        "per": val("trailingPeRatio"), "perFuturo": val("trailingForwardPeRatio"), "peg": val("trailingPegRatio"),
        "pvc": val("trailingPbRatio"), "pventas": val("trailingPsRatio"), "evEbitda": val("trailingEnterprisesValueEBITDARatio"),
        "capitalizacion": val("trailingMarketCap"),
        "monedaCap": u["trailingMarketCap"][2] if u.get("trailingMarketCap") else None,
        "roe": div(neto, fondos) if fondos and fondos > 0 else None,
        "roa": div(neto, val("annualTotalAssets")),
        "margenBruto": div(val("annualGrossProfit"), ventas),
        "margenOperativo": div(val("annualOperatingIncome"), ventas),
        "margenNeto": div(neto, ventas),
        "deudaPatrimonio": div(val("annualTotalDebt"), fondos) if fondos and fondos > 0 else None,
        "deudaNetaEbitda": div(val("annualNetDebt"), val("annualEBITDA")) if (val("annualEBITDA") or 0) > 0 else None,
        "liquidez": div(val("annualCurrentAssets"), val("annualCurrentLiabilities")),
        "payout": div(-(val("annualCashDividendsPaid") or 0), neto) if neto and neto > 0 and val("annualCashDividendsPaid") else None,
        "payoutCaja": (div(-(val("annualCashDividendsPaid") or 0), val("annualFreeCashFlow"))
                       if (val("annualFreeCashFlow") or 0) > 0 and val("annualCashDividendsPaid") else None),
        "ejercicio": (u.get("annualTotalRevenue") or u.get("annualNetIncome") or (None,))[0],
        "monedaCuentas": (u.get("annualTotalRevenue") or (None, None, None))[2],
    }
    if out["per"] is not None and out["per"] <= 0:
        out["per"] = None   # con pérdidas el PER no tiene sentido

    # Crecimiento al año entre el primer y el último ejercicio que da Yahoo (hasta 4 años).
    def crece(k):
        xs = [(f, v) for f, v, _ in se.get(k) or [] if v is not None]
        if len(xs) < 2 or xs[0][1] <= 0 or xs[-1][1] <= 0:
            return None, None
        anos = int(xs[-1][0][:4]) - int(xs[0][0][:4])
        return ((xs[-1][1] / xs[0][1]) ** (1 / anos) - 1, anos) if anos > 0 else (None, None)

    out["creceVentas"], out["anosCrece"] = crece("annualTotalRevenue")
    out["creceBpa"], _ = crece("annualDilutedEPS")
    acc = [(f, v) for f, v, _ in se.get("annualOrdinarySharesNumber") or []]
    if len(acc) >= 2 and acc[0][1] > 0:
        out["cambioAcciones"] = acc[-1][1] / acc[0][1] - 1   # negativo: ha recomprado acciones

    # Historia anual para el gráfico (en la moneda en que presenta las cuentas).
    def por_ano(k, signo=1):
        return {f[:4]: signo * v for f, v, _ in se.get(k) or []}
    v_, n_, c_ = por_ano("annualTotalRevenue"), por_ano("annualNetIncome"), por_ano("annualFreeCashFlow")
    out["historia"] = [[a, v_.get(a), n_.get(a), c_.get(a)] for a in sorted(set(v_) | set(n_) | set(c_))]

    sector = (d.get("sector") or "").strip()
    out["sector"] = SECTORES_YAHOO.get(sector.lower(), sector) or None
    out["industria"] = (d.get("industria") or "").replace("\u2014", " - ") or None
    out = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in out.items() if v is not None}
    if len(out) <= 2:
        return None
    out["consulta"] = guardado.get("consulta")
    out["sinConexion"] = bool(guardado.get("sinConexion"))
    return out


# ---------------------------------------------------------------- la ruta del servidor

def calcula(cfg, cache, red_ok=True, hoy=None):
    """{id del producto: métricas de dividendos y precio} para las acciones y ETF de la cartera."""
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


def calcula_cifras(cfg, cache, red_ok=True):
    """{id del producto: cifras de la empresa} para las acciones (los ETF no tienen cuentas)."""
    prods = [p for p in cfg.get("productos", []) if aplica(p) and p.get("tipo") == "accion"]
    simbolos = sorted({p["codigo"] for p in prods})
    with ThreadPoolExecutor(max_workers=6) as ex:
        brutos = dict(zip(simbolos, ex.map(lambda s: obten_fund(s, cache, red_ok), simbolos)))
    salida = {}
    for p in prods:
        try:
            c = cifras(brutos.get(p["codigo"]))
        except Exception:
            c = None
        if c:
            salida[p["id"]] = c
    return salida


def registra(app, cartera, carpeta_cache):
    """Añade las rutas al servidor. cartera() y carpeta_cache() son del servidor.
    Van por separado para que lo de los dividendos nunca espere a las cifras."""
    from flask import jsonify

    @app.get("/api/empresa-mod")
    def api_empresa_mod():
        try:
            return jsonify(ok=True, productos=calcula(cartera(), carpeta_cache()))
        except Exception as e:
            return jsonify(ok=False, productos={}, error=str(e)), 200

    @app.get("/api/empresa-mod/cifras")
    def api_empresa_mod_cifras():
        try:
            return jsonify(ok=True, productos=calcula_cifras(cartera(), carpeta_cache()))
        except Exception as e:
            return jsonify(ok=False, productos={}, error=str(e)), 200
