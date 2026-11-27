# -*- coding: utf-8 -*-
"""
[mod] Caudal → Rumbo: tú solo anotas en Caudal y Rumbo lo enseña todo
=====================================================================
Caudal es la ÚNICA fuente de verdad. Rumbo TIRA de Caudal (nunca al revés) y se trae la foto
completa de lo que es de Caudal: operaciones de inversión, saldos de cuentas y posiciones.

    caudal/
      __init__.py   este archivo: registra(app, ...) y envuelve(...)
      cliente.py    habla con Caudal (urllib, solo lectura, token, ETag)
      traductor.py  operaciones de Caudal → movimientos de Rumbo, enlaces y validación todo o nada
      capa.py       configuración (mis_datos/caudal.json), la foto (mis_datos/caudal/<perfil>.json)
                    y cómo se superpone al leer la cartera
      rutas.py      /api/caudal-mod/sincronizar, /estado, /enlazar y el portero
      opciones.py   las opciones de Caudal (solo se enseñan): resultados para IRPF, abiertas,
                    campañas y el pasivo de las cortas (valores de un producto deuda);
                    /api/caudal-mod/opciones para la pestaña «Opciones» (web/mods/opciones.js)

La parte del navegador está en app/web/mods/caudal.js. Sin mis_datos/caudal.json, o con
"activo": false, el mod no hace nada.
"""
from .capa import envuelve  # noqa: F401  (lo usan las dos líneas [mod] de servidor.py)


def registra(app, cartera, carpeta_cache):
    """Añade las rutas, el portero y la capa en las respuestas de «Mis datos». Tiene que llamarse
    al arrancar (Flask no deja añadir before_request después de la primera petición)."""
    from . import rutas
    rutas.registra(app)
