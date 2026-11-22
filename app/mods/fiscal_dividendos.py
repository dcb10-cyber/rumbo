# -*- coding: utf-8 -*-
"""
[mod] Datos fiscales de cada dividendo (retención en origen y en España)
========================================================================
El formulario de «Dividendo» (editor.js) lleva unos campos extra que pone mi mod
web/mods/fiscal_dividendos.js, con nombres fis_*. Al guardar, almacen.guarda_movimiento
llama a fiscal_de() (una línea marcada con [mod]) y el movimiento queda así:

    {"tipo": "dividendo", "importe": 72.25, ...,          ← lo que te ingresaron (en euros), como siempre
     "fiscal": {"pais": "US", "bruto": 100.0,             ← dividendo bruto, en euros
                "origen": 15.0,                           ← retenido en el país de origen, en euros
                "espana": 12.75,                          ← retenido en España (19 %), en euros
                "convenio": 0.15,                         ← máximo del convenio (null = sin convenio)
                "moneda": "USD", "fx": 0.85}}             ← si lo escribiste en otra moneda

Todo se guarda en euros, como el importe: si escribes en dólares, se pasa con el mismo
cambio que usa el autor para el importe (importe en euros / importe escrito).
Las cuentas (deducible, reclamable, lo que falta por pagar) se hacen en el navegador.
"""
import re


def _num(v):
    """Número escrito a la española («1.234,56») o con punto; None si está vacío."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = re.sub(r"[€\s]", "", str(v))
    if not t:
        return None
    if "," in t or re.fullmatch(r"-?\d{1,3}(\.\d{3})+", t):
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return float("nan")


def fiscal_de(datos, mov):
    """Lo que hay que añadir al movimiento: {"fiscal": {...}} o {} si no hay datos fiscales.
    Lanza ErrorValidacion si los números no tienen sentido."""
    from ..almacen import ErrorValidacion

    if mov.get("tipo") != "dividendo":
        return {}
    bruto = _num(datos.get("fis_bruto"))
    if not bruto:
        return {}
    origen = _num(datos.get("fis_origen")) or 0.0
    espana = _num(datos.get("fis_espana")) or 0.0
    conv = _num(datos.get("fis_convenio"))
    errores = []
    for v, nombre in ((bruto, "el dividendo bruto"), (origen, "lo retenido en origen"), (espana, "lo retenido en España")):
        if v != v or v < 0:   # nan o negativo
            errores.append(f"Revisa {nombre}: tiene que ser un número positivo.")
    if conv is not None and (conv != conv or conv < 0 or conv > 100):
        errores.append("Revisa el máximo del convenio: es un porcentaje entre 0 y 100.")
    if not errores and origen + espana > bruto + 0.005:
        errores.append("Lo retenido (en origen más en España) no puede ser mayor que el dividendo bruto.")
    if errores:
        raise ErrorValidacion(errores)

    # Misma moneda que el importe: el autor ya ha pasado el importe a euros; uso su mismo cambio.
    moneda = str(datos.get("moneda") or "EUR").strip().upper() or "EUR"
    fx = 1.0
    if moneda != "EUR":
        escrito = _num(datos.get("fis_neto"))
        if escrito and escrito == escrito and escrito > 0:
            fx = mov["importe"] / escrito
    pais = str(datos.get("fis_pais") or "").strip().upper()[:2]
    fiscal = {"pais": pais if re.fullmatch(r"[A-Z]{2}", pais) else "",
              "bruto": round(bruto * fx, 2), "origen": round(origen * fx, 2), "espana": round(espana * fx, 2),
              "convenio": round(conv / 100, 4) if conv is not None else None}
    if moneda != "EUR":
        fiscal.update(moneda=moneda, fx=round(fx, 6))
    return {"fiscal": fiscal}
