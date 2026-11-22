# -*- coding: utf-8 -*-
"""
[mod] Pestaña «IRPF»: ventas (ganancias y pérdidas) de todos los años
=====================================================================
    GET /api/irpf-mod  →  {"ok": true, "anos": ["2026", "2025"],
                           "porAno": {"2026": {ventas, rescates, comisiones, gastosAlquiler,
                                               totales, avisos, csv}, ...}}

Es el mismo cálculo que «Para la Renta» del autor (app/fiscal.py: FIFO, traspasos entre
fondos, avisos de la regla de los dos meses...), pero de todos los años a la vez: la pestaña
IRPF los necesita para arrastrar las pérdidas de un año a los cuatro siguientes. Las
cuentas del impuesto (compensación, base del ahorro, escala) se hacen en el navegador
(web/mods/pestana_irpf.js), junto con los dividendos y sus retenciones.
"""


def ventas_por_ano(cfg):
    from .. import fiscal

    anos = fiscal.anos_con_datos(cfg)
    por_ano = {}
    for a in anos:
        inf = fiscal.informe(cfg, a)
        por_ano[a] = {k: inf[k] for k in ("ventas", "rescates", "comisiones", "gastosAlquiler", "totales", "avisos")}
        por_ano[a]["csv"] = fiscal.csv_texto(inf)
    return anos, por_ano


def registra(app, cartera, carpeta_cache):
    from flask import jsonify

    def responde():
        from .. import servidor
        if servidor.modo() == "todos":
            return jsonify(ok=False, error="La declaración es de cada persona: elige un perfil arriba.", anos=[], porAno={})
        try:
            with servidor.cerrojo:   # el motor no admite dos cálculos a la vez
                anos, por_ano = ventas_por_ano(cartera())
            return jsonify(ok=True, anos=anos, porAno=por_ano)
        except Exception as e:
            return jsonify(ok=False, error=str(e), anos=[], porAno={}), 200

    app.add_url_rule("/api/irpf-mod", endpoint="api_irpf_mod", view_func=responde, methods=["GET"])
