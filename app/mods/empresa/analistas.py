# -*- coding: utf-8 -*-
"""
[mod] Nivel 3 · Analistas (Yahoo «insights», sin cookie).

Lo que Yahoo da sin cookie (comprobado): valoración y perspectivas técnicas de
Trading Central, opinión de Argus, argumentos a favor y en contra de Morningstar y
hechos relevantes. Muy completo en acciones de EE. UU.; en las europeas trae poco.
(La ficha completa de Yahoo, con precio objetivo y calendario, pide una cookie que en
Europa solo se da aceptando su aviso de cookies: se probó y se descartó.)
Solo acciones. Lo pinta web/mods/empresa/analistas.js.
"""

import datetime as dt

from ...motor import sin_html
from .. import cache
from . import yahoo
from .comun import por_producto

PREFIJO = "EMPRESA_INS_"
CADUCA = dt.timedelta(hours=20)
DIRECCION = {"bullish": "Alcista", "bearish": "Bajista", "neutral": "Neutral"}
VALORACION = {"near fair value": "Cerca de su valor razonable", "overvalued": "Cara (sobrevalorada)",
              "undervalued": "Barata (infravalorada)"}
OPINION = {"buy": "Comprar", "strong buy": "Compra fuerte", "hold": "Mantener", "sell": "Vender",
           "strong sell": "Venta fuerte", "underperform": "Infraponderar", "outperform": "Sobreponderar"}


def obten(p, carpeta):
    isin = (p.get("identificador") or "").strip().upper()
    return cache.obten(carpeta, PREFIJO, p["codigo"], lambda g: CADUCA,
                       lambda: yahoo.descarga_insights(p["codigo"], isin))


def perspectivas(ins):
    """Lo de «insights», traducido. None si no hay nada útil."""
    if not ins:
        return None
    ii = ins.get("instrumentInfo") or {}
    te, kt, va = ii.get("technicalEvents") or {}, ii.get("keyTechnicals") or {}, ii.get("valuation") or {}
    out = {"deSimbolo": ins.get("deSimbolo")}
    plazos = []
    for k, t in (("shortTermOutlook", "Corto plazo"), ("intermediateTermOutlook", "Medio plazo"), ("longTermOutlook", "Largo plazo")):
        o = te.get(k) or {}
        if o.get("direction"):
            plazos.append({"plazo": t, "direccion": DIRECCION.get(o["direction"].lower(), sin_html(o["direction"])),
                           "fuerza": o.get("score")})
    if plazos:
        out["tecnico"] = plazos
    if va.get("description"):
        out["valoracion"] = VALORACION.get(va["description"].strip().lower(), sin_html(va["description"]))
        out["descuento"] = sin_html(str(va.get("discount") or "")) or None
    if kt.get("support") or kt.get("resistance"):
        out["soporte"], out["resistencia"] = kt.get("support"), kt.get("resistance")
    rec = ins.get("recommendation") or ii.get("recommendation") or {}
    if rec.get("rating"):
        out["argus"] = OPINION.get(rec["rating"].strip().lower(), sin_html(rec["rating"]))
        out["argusObjetivo"] = rec.get("targetPrice")
    up = ins.get("upsell") or {}
    out["aFavor"] = [sin_html(x)[:400] for x in up.get("msBullishSummary") or []][:3]
    out["enContra"] = [sin_html(x)[:400] for x in up.get("msBearishSummary") or []][:3]
    out["noticias"] = [{"fecha": (x.get("date") or "")[:10], "titular": sin_html(x.get("headline") or "")[:200]}
                       for x in (ins.get("sigDevs") or [])[:5] if x.get("headline")]
    out = {k: v for k, v in out.items() if v not in (None, [], {}, "")}
    return out if set(out) - {"deSimbolo"} else None


def analistas(guardado):
    """Lo que pinta «Analistas» para una acción, o None si Yahoo no da nada."""
    per = perspectivas((guardado or {}).get("datos"))
    if not per:
        return None
    return {**per, "consulta": guardado.get("consulta"), "sinConexion": bool(guardado.get("sinConexion"))}


def calcula(cfg, carpeta):
    """{id del producto: perspectivas} para las acciones."""
    return por_producto(cfg, ("accion",), lambda p: obten(p, carpeta), lambda p, g: analistas(g))
