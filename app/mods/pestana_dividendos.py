# -*- coding: utf-8 -*-
"""
[mod] Pestaña «Dividendos»: todos los cobros, para analizarlos en el navegador
==============================================================================
El panel del autor (DATOS) solo trae los dividendos ya resumidos (por año, por
producto y los 12 últimos). Para la pestaña hacen falta todos, uno a uno, así
que esta ruta los saca tal cual de la cartera activa:

    GET /api/dividendos-mod  →  {"ok": true,
                                 "cobros": [{fecha, producto, importe, comision, unidades, nota}, ...],
                                 "productos": {id: {nombre, corto, tipo, entidad, moneda}}}

Son los movimientos de tipo «dividendo» (dividendos, cupones, intereses de cuentas y
alquileres: Rumbo los anota todos con ese tipo). No baja nada de internet ni escribe nada.
Las cuentas (totales, años, YOC…) las hace web/mods/pestana_dividendos.js.
"""


def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def cobros(cfg):
    """Los cobros de la cartera, ordenados por fecha, y los datos básicos de quien los paga."""
    prods = {p.get("id"): p for p in (cfg or {}).get("productos", []) if p.get("id")}
    lista = []
    for m in (cfg or {}).get("movimientos", []):
        if m.get("tipo") != "dividendo" or m.get("producto") not in prods or not m.get("fecha"):
            continue
        u = _num(m.get("unidades"))
        lista.append({"fecha": str(m["fecha"])[:10], "producto": m["producto"],
                      "importe": round(_num(m.get("importe")), 2),
                      "comision": round(_num(m.get("comision")), 2),
                      "unidades": u if u > 0 else None,
                      "nota": str(m.get("nota") or "")})
    lista.sort(key=lambda c: (c["fecha"], c["producto"]))
    usados = {c["producto"] for c in lista}
    info = {pid: {"nombre": p.get("nombre") or pid, "corto": p.get("corto") or p.get("nombre") or pid,
                  "tipo": p.get("tipo") or "otro", "entidad": p.get("entidad") or "",
                  "moneda": (p.get("moneda") or "EUR").upper()}
            for pid, p in prods.items() if pid in usados}
    return lista, info


def registra(app, cartera, carpeta_cache):
    """Añade la ruta al servidor. cartera() es la del perfil activo (o «Todos juntos»)."""
    from flask import jsonify

    def responde():
        try:
            lista, info = cobros(cartera())
            return jsonify(ok=True, cobros=lista, productos=info)
        except Exception as e:
            return jsonify(ok=False, cobros=[], productos={}, error=str(e)), 200

    app.add_url_rule("/api/dividendos-mod", endpoint="api_dividendos_mod", view_func=responde, methods=["GET"])
