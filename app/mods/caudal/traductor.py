# -*- coding: utf-8 -*-
"""
[mod] Traductor Caudal → Rumbo
==============================
Caudal publica un modelo de lectura genérico (no sabe nada de Rumbo). Aquí se convierte en
movimientos y valoraciones de Rumbo, que guarda todo en euros:

    Caudal       Rumbo
    compra       compra: importe = bruto + comisión, unidades, comisión
    venta        venta: importe = bruto − comisión, unidades, comisión
    dividendo    dividendo: importe = neto (+ datos fiscales si Caudal trae retenciones)
    interes      dividendo del producto enlazado (al activo o, si no hay activo, a la cuenta),
                 con datos fiscales (país ES)
    comision     comision: importe = neto
    traspaso     traspaso: producto, destino, unidades, unidadesDestino, importe
    ajuste       ajuste: unidades = las que tienes DESPUÉS (Caudal da cuántas cambian)
    saldos       valoraciones {fecha, producto, valor} de los productos enlazados a cada cuenta

Ids estables: "c" + id de Caudal (no chocan con los m<n> de Rumbo); valoraciones "cv<cuenta>_<fecha>".
Todo lleva origen "caudal". Solo entra lo que tenga fecha >= «desde».

Enlaces activo → producto: a mano (desde la pestaña «Caudal») o, si no, automático por ISIN
(campo «identificador» del producto o «expoComo») y después por código o ticker. Cuenta →
producto: solo a mano y solo con productos de tipo efectivo o deuda. Lo que no enlaza queda
«pendiente de enlazar» y sus operaciones no entran (con aviso).

Validación de TODO O NADA: en una copia en memoria de cartera.json se pasa cada operación por
almacen.guarda_movimiento (las mismas comprobaciones que el formulario), por fecha y, dentro del
día, compra, comision, dividendo, venta, traspaso, ajuste. Lo que devuelve es el movimiento
definitivo (con su id cambiado a c<id>). Si falla una sola, no vale nada: hay que mantener la
foto anterior.
"""
import copy
import datetime as dt

from ... import almacen

TIPOS = ("compra", "venta", "dividendo", "interes", "comision", "traspaso", "ajuste")
ORDEN_DIA = {"compra": 0, "comision": 1, "dividendo": 2, "interes": 2, "venta": 3, "traspaso": 4, "ajuste": 6}
TOLERANCIA = 1e-6


def _txt(v):
    return " ".join(str(v or "").split())


def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def nombre_producto(p):
    return (p or {}).get("corto") or (p or {}).get("nombre") or (p or {}).get("id") or "?"


# ---------------------------------------------------------------- formato de lo que llega

def comprueba_formato(nombre, cuerpo):
    """Lista de problemas (vacía si la respuesta de Caudal tiene la forma del contrato v1)."""
    claves = {"operaciones": ("operaciones",), "saldos": ("cuentas", "saldos"), "posiciones": ("posiciones",)}[nombre]
    if not isinstance(cuerpo, dict) or cuerpo.get("schema") != 1:
        return [f"Caudal ha mandado «{nombre}» con un formato que no conozco (schema distinto de 1)."]
    malos = [k for k in claves if not isinstance(cuerpo.get(k), list)]
    if malos:
        return [f"A «{nombre}» de Caudal le falta: {', '.join(malos)}."]
    problemas = []
    if nombre == "operaciones":
        for op in cuerpo["operaciones"]:
            if not isinstance(op, dict) or op.get("tipo") not in TIPOS or not op.get("id") \
                    or not isinstance(op.get("fecha"), str) or len(op["fecha"]) != 10:
                problemas.append(f"Operación de Caudal mal formada: {str(op)[:120]}")
            elif op.get("activo") is not None and not isinstance(op["activo"], dict):
                problemas.append(f"Operación {op.get('id')} de Caudal: el activo está mal formado.")
    return problemas[:20]


# ---------------------------------------------------------------- enlaces

def activos_conocidos(crudo):
    """{id de activo de Caudal (texto): datos del activo} sacados de las operaciones."""
    salida = {}
    for op in crudo.get("operaciones", []):
        a = op.get("activo")
        if isinstance(a, dict) and a.get("id") is not None:
            salida[str(a["id"])] = a
        if op.get("tipo") == "traspaso" and op.get("destino_activo_id") is not None:
            salida.setdefault(str(op["destino_activo_id"]), {"id": op["destino_activo_id"]})
    return salida


def enlaza(crudo, cfg, manuales):
    """Resuelve los enlaces. Devuelve (activo→producto, cuenta→producto, cómo se enlazó cada uno, avisos).
    manuales: {"activo": {caudal_id: producto}, "cuenta": {caudal_id: producto}}."""
    productos = {p.get("id"): p for p in cfg.get("productos", []) if p.get("id")}
    con_movs = [p for p in productos.values() if p.get("tipo") not in almacen.SOLO_SALDO]
    activos = activos_conocidos(crudo)
    e_activo, e_cuenta, como, avisos = {}, {}, {}, []
    manuales = manuales or {}

    for aid, pid in (manuales.get("activo") or {}).items():
        p = productos.get(pid)
        if p and p.get("tipo") not in almacen.SOLO_SALDO:
            e_activo[str(aid)], como["activo:" + str(aid)] = pid, "a mano"
        else:
            avisos.append(f"El enlace a mano del activo {aid} de Caudal apunta a un producto que ya no vale ({pid}).")
    for aid, a in activos.items():
        if aid in e_activo:
            continue
        isin = _txt(a.get("isin")).upper()
        ticker = _txt(a.get("ticker")).upper()
        por_isin = [p for p in con_movs if isin and isin in (_txt(p.get("identificador")).upper(),
                                                              _txt(p.get("expoComo")).upper())]
        por_ticker = [p for p in con_movs if ticker and _txt(p.get("codigo")).upper() == ticker]
        for lista, nombre in ((por_isin, "ISIN"), (por_ticker, "ticker")):
            if len(lista) == 1:
                e_activo[aid], como["activo:" + aid] = lista[0]["id"], nombre
                break
            if len(lista) > 1:
                avisos.append(f"«{a.get('nombre') or aid}» de Caudal encaja con varios productos por {nombre} "
                              f"({', '.join(nombre_producto(p) for p in lista)}): enlázalo a mano.")
                break

    for cid, pid in (manuales.get("cuenta") or {}).items():
        p = productos.get(pid)
        if p and p.get("tipo") in almacen.SOLO_SALDO:
            e_cuenta[str(cid)], como["cuenta:" + str(cid)] = pid, "a mano"
        else:
            avisos.append(f"El enlace a mano de la cuenta {cid} de Caudal apunta a un producto que ya no vale ({pid}).")
    return e_activo, e_cuenta, como, avisos


# ---------------------------------------------------------------- traducción

def _datos_rumbo(op, pid, pid_destino, copia):
    """Lo que se pasa a almacen.guarda_movimiento (con las claves del formulario de Rumbo)."""
    tipo, fecha = op["tipo"], op["fecha"]
    bruto, com, neto = _num(op.get("bruto_eur")), _num(op.get("comision_eur")), _num(op.get("neto_eur"))
    nota = _txt(op.get("nota"))[:200] or None
    base = {"fecha": fecha, "producto": pid, "nota": nota}
    if tipo == "compra":
        return {**base, "tipo": "compra", "unidades": _num(op.get("unidades")), "importe": round(bruto + com, 2),
                "comision": round(com, 2) or None}
    if tipo == "venta":
        return {**base, "tipo": "venta", "unidades": _num(op.get("unidades")), "importe": round(bruto - com, 2),
                "comision": round(com, 2) or None}
    if tipo in ("dividendo", "interes"):
        datos = {**base, "tipo": "dividendo", "unidades": 0, "importe": round(neto, 2),
                 "comision": round(com, 2) or None, "moneda": "EUR"}
        if op.get("ret_origen_eur") is not None or op.get("ret_es_eur") is not None:
            # Las claves del formulario del mod de retenciones: fiscal_de() las valida y construye.
            pais = _txt(op.get("pais")).upper() or ("ES" if tipo == "interes" else "")
            datos.update(fis_bruto=round(bruto, 2), fis_origen=round(_num(op.get("ret_origen_eur")), 2),
                         fis_espana=round(_num(op.get("ret_es_eur")), 2), fis_pais=pais,
                         fis_convenio=op.get("convenio_pct"))
        return datos
    if tipo == "comision":
        return {**base, "tipo": "comision", "unidades": 0, "importe": round(neto, 2)}
    if tipo == "traspaso":
        return {**base, "tipo": "traspaso", "destino": pid_destino, "unidades": _num(op.get("unidades")),
                "unidadesDestino": _num(op.get("unidades_destino")), "importe": round(neto or bruto, 2)}
    # ajuste: Caudal dice cuántas cambian; Rumbo guarda cuántas tienes después.
    antes = almacen.unidades_a(copia, pid, fecha)
    return {**base, "tipo": "ajuste", "unidades": round(antes + _num(op.get("unidades")), 8)}


def traduce(crudo, cfg, manuales, desde):
    """Traduce y valida. No guarda nada. Devuelve un diccionario con:
      movimientos, valoraciones   lo que irá en la foto (solo si errores está vacío)
      errores                     [{fecha, activo, motivo, id}] → no se puede guardar la foto
      pendientes                  [{clase, caudal_id, nombre, detalle, operaciones, obligatorio}]
      avisos, enlazados           [{clase, caudal_id, nombre, producto, como}]
      cartera                     la copia de cartera.json con todo ya aplicado (para conciliar)."""
    desde = desde or ""
    hoy = dt.date.today().isoformat()
    productos = {p.get("id"): p for p in cfg.get("productos", []) if p.get("id")}
    e_activo, e_cuenta, como, avisos = enlaza(crudo, cfg, manuales)
    activos = activos_conocidos(crudo)
    cuentas = {str(c.get("id")): c for c in crudo.get("cuentas", []) if isinstance(c, dict)}
    copia = copy.deepcopy(cfg)
    copia.setdefault("movimientos", [])
    copia.setdefault("valoraciones", [])
    movimientos, valoraciones, errores = [], [], []
    faltan = {}   # (clase, caudal_id) -> nº de operaciones que no entran
    antes_de_desde = 0

    ops = [op for op in crudo.get("operaciones", []) if isinstance(op, dict)]
    ops.sort(key=lambda op: (str(op.get("fecha")), ORDEN_DIA.get(op.get("tipo"), 9)))
    for op in ops:
        if str(op.get("fecha")) < desde:
            antes_de_desde += 1
            continue
        a = op.get("activo") if isinstance(op.get("activo"), dict) else None
        aid = str(a["id"]) if a and a.get("id") is not None else None
        if aid is not None:
            pid = e_activo.get(aid)
            if not pid:
                faltan[("activo", aid)] = faltan.get(("activo", aid), 0) + 1
                continue
        else:
            cid = str(op.get("cuenta_id")) if op.get("cuenta_id") is not None else None
            if op.get("tipo") not in ("dividendo", "interes") or cid is None:
                errores.append({"id": op.get("id"), "fecha": op.get("fecha"), "activo": "—",
                                "motivo": f"Una operación «{op.get('tipo')}» de Caudal sin activo: no sé a qué producto va."})
                continue
            pid = e_cuenta.get(cid)
            if not pid:
                faltan[("cuenta", cid)] = faltan.get(("cuenta", cid), 0) + 1
                continue
        pid_destino = None
        if op.get("tipo") == "traspaso":
            did = str(op.get("destino_activo_id"))
            pid_destino = e_activo.get(did)
            if not pid_destino:
                faltan[("activo", did)] = faltan.get(("activo", did), 0) + 1
                continue
        try:
            datos = _datos_rumbo(op, pid, pid_destino, copia)
            guardado = almacen.guarda_movimiento(copia, datos)
        except almacen.ErrorValidacion as e:
            errores.append({"id": op.get("id"), "fecha": op.get("fecha"),
                            "activo": (a or {}).get("nombre") or nombre_producto(productos.get(pid)),
                            "motivo": " ".join(e.errores)})
            continue
        guardado["id"] = "c" + str(op["id"])
        guardado["origen"] = "caudal"
        movimientos.append(guardado)

    # Saldos → valoraciones (varias cuentas en un mismo producto se suman ese día).
    por_dia, cuentas_de = {}, {}
    for s in crudo.get("saldos", []):
        if not isinstance(s, dict):
            continue
        cid, fecha = str(s.get("cuenta_id")), str(s.get("fecha") or "")
        pid = e_cuenta.get(cid)
        if not pid or fecha < desde or fecha > hoy:
            continue
        por_dia[(pid, fecha)] = round(por_dia.get((pid, fecha), 0.0) + _num(s.get("saldo_eur")), 2)
        cuentas_de.setdefault((pid, fecha), []).append(cid)
    for (pid, fecha), valor in sorted(por_dia.items()):
        cids = cuentas_de[(pid, fecha)]
        try:
            guardada = almacen.guarda_valoracion(copia, {"producto": pid, "fecha": fecha, "valor": valor})
        except almacen.ErrorValidacion as e:
            errores.append({"id": None, "fecha": fecha, "activo": nombre_producto(productos.get(pid)),
                            "motivo": "Saldo de " + ", ".join(_txt(cuentas.get(c, {}).get("nombre")) or c for c in cids)
                                      + ": " + " ".join(e.errores)})
            continue
        valoraciones.append({"id": f"cv{'_'.join(cids)}_{fecha}", "fecha": guardada["fecha"],
                             "producto": guardada["producto"], "valor": guardada["valor"], "origen": "caudal"})

    pendientes = []
    for (clase, cid), n in sorted(faltan.items()):
        if clase == "activo":
            a = activos.get(cid, {})
            nombre = a.get("nombre") or f"Activo {cid} de Caudal"
            detalle = " · ".join(x for x in (_txt(a.get("isin")), _txt(a.get("ticker"))) if x) or "sin ISIN ni ticker"
        else:
            nombre = _txt(cuentas.get(cid, {}).get("nombre")) or f"Cuenta {cid} de Caudal"
            detalle = "intereses de la cuenta"
        pendientes.append({"clase": clase, "caudal_id": cid, "nombre": nombre, "detalle": detalle,
                           "operaciones": n, "obligatorio": True,
                           "tipo": cuentas.get(cid, {}).get("tipo") if clase == "cuenta" else activos.get(cid, {}).get("tipo")})
        avisos.append(f"{n} operación(es) de «{nombre}» no entran: falta enlazarlo con un producto de Rumbo.")
    # Las cuentas sin enlazar y sin operaciones no impiden nada: enlazarlas trae sus saldos (opcional).
    for cid, c in cuentas.items():
        if cid not in e_cuenta and ("cuenta", cid) not in faltan:
            pendientes.append({"clase": "cuenta", "caudal_id": cid, "nombre": _txt(c.get("nombre")) or cid,
                               "detalle": "saldos", "operaciones": 0, "obligatorio": False, "tipo": c.get("tipo")})

    enlazados = []
    for aid, pid in sorted(e_activo.items()):
        enlazados.append({"clase": "activo", "caudal_id": aid, "nombre": activos.get(aid, {}).get("nombre") or aid,
                          "producto": pid, "productoNombre": nombre_producto(productos.get(pid)),
                          "como": como.get("activo:" + aid)})
    for cid, pid in sorted(e_cuenta.items()):
        enlazados.append({"clase": "cuenta", "caudal_id": cid, "nombre": _txt(cuentas.get(cid, {}).get("nombre")) or cid,
                          "producto": pid, "productoNombre": nombre_producto(productos.get(pid)),
                          "como": como.get("cuenta:" + cid)})
    return {"movimientos": movimientos, "valoraciones": valoraciones, "errores": errores,
            "pendientes": pendientes, "avisos": avisos, "enlazados": enlazados,
            "antesDeDesde": antes_de_desde, "cartera": copia}


# ---------------------------------------------------------------- conciliación

def concilia(cartera_con_todo, posiciones, enlazados, hoy=None):
    """Compara las unidades de cada producto enlazado en Rumbo (cartera.json + Caudal) con las que
    dice Caudal (/inversion/posiciones). Devuelve los que no cuadran (tolerancia 1e-6)."""
    hoy = hoy or dt.date.today().isoformat()
    caudal = {str(p.get("activo_id")): _num(p.get("unidades")) for p in posiciones or [] if isinstance(p, dict)}
    por_producto = {}
    for e in enlazados:
        if e["clase"] == "activo":
            x = por_producto.setdefault(e["producto"], {"nombre": e["productoNombre"], "caudal": 0.0, "activos": []})
            x["caudal"] += caudal.get(e["caudal_id"], 0.0)
            x["activos"].append(e["nombre"])
    salida = []
    for pid, x in sorted(por_producto.items()):
        rumbo = almacen.unidades_a(cartera_con_todo, pid, hoy)
        if abs(rumbo - x["caudal"]) > TOLERANCIA:
            salida.append({"producto": pid, "nombre": x["nombre"], "rumbo": round(rumbo, 8),
                           "caudal": round(x["caudal"], 8), "diferencia": round(rumbo - x["caudal"], 8)})
    return salida
