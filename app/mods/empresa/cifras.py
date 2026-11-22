# -*- coding: utf-8 -*-
"""
[mod] Nivel 2 · La empresa en cifras (Yahoo: ratios del día y cuentas anuales).

Morningstar rechaza estas consultas (responde 401), así que las cifras salen de Yahoo,
solo con el ticker. De las cuentas se calculan ROE, márgenes, deuda, crecimiento y
payout. Comprobado con acciones de EE. UU., España y Alemania (también .F y .DE).
Solo acciones: los ETF no tienen cuentas. Lo pinta web/mods/empresa/cifras.js.
"""

import datetime as dt

from .. import cache
from . import yahoo
from .comun import por_producto

PREFIJO = "EMPRESA_FUND_"
CADUCA = dt.timedelta(days=3)
CADUCA_VACIO = dt.timedelta(hours=6)   # si Yahoo no dio nada, se reintenta antes: puede ser un fallo pasajero
SECTORES = {"technology": "Tecnología", "healthcare": "Salud", "financial services": "Financiero",
            "consumer cyclical": "Consumo discrecional", "consumer defensive": "Consumo básico",
            "energy": "Energía", "industrials": "Industrial", "basic materials": "Materiales",
            "real estate": "Inmobiliario", "utilities": "Utilities", "communication services": "Comunicaciones"}


def _caducidad(guardado):
    return CADUCA if (guardado.get("datos") or {}).get("series") else CADUCA_VACIO


def obten(simbolo, carpeta):
    return cache.obten(carpeta, PREFIJO, simbolo, _caducidad, lambda: yahoo.descarga_fundamentales(simbolo))


def cifras(guardado):
    """Lo que pinta «La empresa en cifras». Los cocientes salen de la misma cuenta anual
    (misma moneda), así que valen aunque la empresa presente en coronas o en dólares."""
    d = (guardado or {}).get("datos") or {}
    se = d.get("series") or {}
    if not se:
        return None
    u = {k: serie[-1] for k, serie in se.items() if serie}   # último dato de cada serie: (fecha, valor, moneda)
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
    def por_ano(k):
        return {f[:4]: v for f, v, _ in se.get(k) or []}
    v_, n_, c_ = por_ano("annualTotalRevenue"), por_ano("annualNetIncome"), por_ano("annualFreeCashFlow")
    out["historia"] = [[a, v_.get(a), n_.get(a), c_.get(a)] for a in sorted(set(v_) | set(n_) | set(c_))]

    sector = (d.get("sector") or "").strip()
    out["sector"] = SECTORES.get(sector.lower(), sector) or None
    out["industria"] = (d.get("industria") or "").replace("—", " - ") or None
    out = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in out.items() if v is not None}
    if len(out) <= 2:
        return None
    out["consulta"] = guardado.get("consulta")
    out["sinConexion"] = bool(guardado.get("sinConexion"))
    return out


def calcula(cfg, carpeta):
    """{id del producto: cifras de la empresa} para las acciones."""
    return por_producto(cfg, ("accion",), lambda p: obten(p["codigo"], carpeta), lambda p, g: cifras(g))
