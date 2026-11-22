# -*- coding: utf-8 -*-
"""
[mod] Lo que se le pide a Yahoo Finance y cómo se lee su respuesta.

Igual que el resto de Rumbo: solo sale a internet por red.py (que solo deja ir a los
sitios permitidos) y en la petición solo va el ticker o el ISIN, nunca una cifra tuya.
"""

import datetime as dt
import json
import re
import time
import urllib.parse

from ... import red
from ...motor import UA

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
FUND = "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"
BUSCA = "https://query2.finance.yahoo.com/v1/finance/search?"
INSIGHTS = "https://query2.finance.yahoo.com/ws/insights/v2/finance/insights?"
ES_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")

# Series de «fundamentals-timeseries»: ratios del día y cuentas anuales.
RATIOS = ["trailingPeRatio", "trailingForwardPeRatio", "trailingPbRatio", "trailingPsRatio", "trailingPegRatio",
          "trailingMarketCap", "trailingEnterprisesValueEBITDARatio"]
ANUALES = ["TotalRevenue", "GrossProfit", "OperatingIncome", "NetIncome", "DilutedEPS", "EBITDA", "FreeCashFlow",
           "StockholdersEquity", "TotalAssets", "TotalDebt", "NetDebt", "CurrentAssets", "CurrentLiabilities",
           "CashDividendsPaid", "OrdinarySharesNumber"]


def _get(url):
    with red.abrir(url, UA, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _fecha(ts, desfase=0):
    return dt.datetime.fromtimestamp(int(ts) + int(desfase or 0), dt.timezone.utc).date().isoformat()


# ---------------------------------------------------------------- dividendos, splits y 52 semanas

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


def descarga_cotizacion(simbolo):
    """Dividendos, splits y precio del último año de un ticker (dos peticiones pequeñas)."""
    sym = urllib.parse.quote(simbolo)
    ahora = int(time.time())
    datos = lee_largo(_get(f"{CHART}{sym}?period1=0&period2={ahora}&interval=1mo&events=div%2Csplits"))
    for k, v in lee_anual(_get(f"{CHART}{sym}?range=1y&interval=1d")).items():
        if v is not None:
            datos[k] = v
    return datos


# ---------------------------------------------------------------- ratios y cuentas anuales

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


def descarga_fundamentales(simbolo):
    """Ratios y cuentas anuales de los últimos años, y el sector e industria de su buscador."""
    ahora = int(time.time())
    tipos = RATIOS + ["annual" + t for t in ANUALES]
    url = (FUND + urllib.parse.quote(simbolo) + "?" + urllib.parse.urlencode(
        {"type": ",".join(tipos), "period1": ahora - 7 * 365 * 86400, "period2": ahora}))
    datos = {"series": lee_fundamentales(_get(url))}
    try:
        b = _get(BUSCA + urllib.parse.urlencode({"q": simbolo, "quotesCount": 3, "newsCount": 0}))
        q = next((x for x in b.get("quotes") or [] if x.get("symbol") == simbolo), None)
        if q:
            datos["sector"] = q.get("sectorDisp") or q.get("sector")
            datos["industria"] = q.get("industryDisp") or q.get("industry")
    except Exception:
        pass
    return datos


# ---------------------------------------------------------------- analistas («insights», sin cookie)

def _cotizacion_principal(isin, simbolo):
    """La cotización principal de una empresa (la de su bolsa de origen), buscada por el ISIN."""
    try:
        b = _get(BUSCA + urllib.parse.urlencode({"q": isin, "quotesCount": 8, "newsCount": 0}))
    except Exception:
        return None
    cands = [x["symbol"] for x in b.get("quotes") or [] if x.get("quoteType") == "EQUITY" and x.get("symbol") != simbolo]
    return next((s for s in cands if "." not in s), None) or (cands[0] if cands else None)


def _insights(simbolo):
    return (_get(INSIGHTS + urllib.parse.urlencode({"symbol": simbolo})).get("finance") or {}).get("result") or {}


def descarga_insights(simbolo, isin=None):
    """Los «insights» del ticker. Las líneas secundarias (.F, .DE...) casi nunca traen nada:
    entonces se miran en la cotización principal, buscada por el ISIN."""
    r = _insights(simbolo)
    if not r.get("instrumentInfo") and isin and ES_ISIN.match(isin):
        otra = _cotizacion_principal(isin, simbolo)
        if otra:
            r2 = _insights(otra)
            if r2.get("instrumentInfo"):
                r2["deSimbolo"] = otra
                return r2
    return r
