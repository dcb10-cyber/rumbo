# -*- coding: utf-8 -*-
"""
[mod] Datos de empresas para acciones y ETF con precio de Yahoo Finance
=======================================================================
    yahoo.py        qué se pide a Yahoo y cómo se lee (solo el ticker o el ISIN)
    comun.py        a qué productos se aplica y cómo se recorre la cartera
    dividendos.py   nivel 1: dividendos, splits y 52 semanas      → /api/empresa-mod
    cifras.py       nivel 2: ratios y cuentas de la empresa       → /api/empresa-mod/cifras
    analistas.py    nivel 3: valoración, técnico y opiniones      → /api/empresa-mod/analistas

Cada nivel tiene su propia ruta para que ninguno espere a los otros. Lo descargado se
guarda en mis_datos/cache/EMPRESA_*.json (ver mods/cache.py). Si Yahoo no responde se
usa lo guardado; si no hay nada guardado, el panel simplemente no enseña esa parte.
"""

from . import analistas, cifras, dividendos

RUTAS = [
    ("/api/empresa-mod", "api_empresa_mod", dividendos.calcula),
    ("/api/empresa-mod/cifras", "api_empresa_mod_cifras", cifras.calcula),
    ("/api/empresa-mod/analistas", "api_empresa_mod_analistas", analistas.calcula),
]


def registra(app, cartera, carpeta_cache):
    """Añade las rutas al servidor. cartera() y carpeta_cache() son del servidor."""
    from flask import jsonify

    def vista(calcula):
        def responde():
            try:
                return jsonify(ok=True, productos=calcula(cartera(), carpeta_cache()))
            except Exception as e:
                return jsonify(ok=False, productos={}, error=str(e)), 200
        return responde

    for url, nombre, calcula in RUTAS:
        app.add_url_rule(url, endpoint=nombre, view_func=vista(calcula), methods=["GET"])
