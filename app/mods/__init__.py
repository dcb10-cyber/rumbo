# -*- coding: utf-8 -*-
"""
app/mods  ·  [mod] Todo lo que he añadido yo a Rumbo (la parte del servidor)
===========================================================================
Nada de esta carpeta es del autor original. El código del autor solo tiene una
línea que llama a registra() (en servidor.py, marcada con [mod]); así, al traer
sus actualizaciones, como mucho choca esa línea.

    mods/
      __init__.py        este archivo: engancha todos los mods al servidor
      cache.py           guardar en mis_datos/cache lo que se baja de internet
      empresa/           datos de empresas (Yahoo): dividendos, cifras, analistas

La parte del navegador está en app/web/mods/ (misma idea, mismo orden).

Para añadir un mod nuevo: crea su módulo o carpeta aquí, con una función
registra(app, cartera, carpeta_cache), y añádelo a MODS.
"""

from . import empresa

MODS = [empresa]


def registra(app, cartera, carpeta_cache):
    """Añade al servidor las rutas de todos los mods.
    cartera() devuelve la cartera activa y carpeta_cache() la carpeta de la cache."""
    for mod in MODS:
        mod.registra(app, cartera, carpeta_cache)
