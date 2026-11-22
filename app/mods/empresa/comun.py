# -*- coding: utf-8 -*-
"""[mod] Lo que comparten los tres apartados de «empresa»: a qué productos se aplican
y cómo se recorre la cartera pidiendo cada ticker una sola vez."""

from concurrent.futures import ThreadPoolExecutor

TIPOS = ("accion", "etf")


def aplica(p):
    """¿Tiene sentido buscar estos datos para este producto? Acciones y ETF con precio de Yahoo."""
    return p.get("fuente") == "yahoo" and p.get("tipo") in TIPOS and bool(p.get("codigo"))


def por_producto(cfg, tipos, obten, calcula):
    """{id del producto: resultado} para los productos de la cartera de esos tipos.

    obten(producto) trae lo guardado o descargado de un ticker; se llama una vez por
    ticker (en paralelo), aunque lo tengas en varios productos.
    calcula(producto, guardado) da lo que pinta el panel, o None para no enseñar nada."""
    prods = [p for p in cfg.get("productos", []) if aplica(p) and p.get("tipo") in tipos]
    unicos = {p["codigo"]: p for p in prods}
    with ThreadPoolExecutor(max_workers=6) as ex:
        guardados = dict(zip(unicos, ex.map(obten, unicos.values())))
    salida = {}
    for p in prods:
        try:
            r = calcula(p, guardados.get(p["codigo"]))
        except Exception:   # que un dato raro de Yahoo no rompa el panel
            r = None
        if r:
            salida[p["id"]] = r
    return salida
