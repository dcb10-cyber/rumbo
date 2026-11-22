# -*- coding: utf-8 -*-
"""
[mod] Cache de lo que se descarga de internet.

Cada consulta se guarda en mis_datos/cache/<PREFIJO><símbolo>.json como
{"consulta": fecha y hora, "datos": ...}. Mientras no caduque se usa lo guardado;
cuando caduca se vuelve a pedir y, si internet falla, se sigue usando lo guardado
marcado con "sinConexion" (el panel avisa de que son datos viejos).
"""

import datetime as dt
import json
import os
import re


def ruta(carpeta, prefijo, simbolo):
    """Archivo de la cache para un símbolo (solo letras, números y _ en el nombre)."""
    return os.path.join(carpeta, prefijo + re.sub(r"[^A-Za-z0-9]", "_", simbolo) + ".json")


def _lee(archivo):
    try:
        with open(archivo, encoding="utf-8") as f:
            guardado = json.load(f)
    except (OSError, ValueError):
        return None
    return guardado if isinstance(guardado, dict) and guardado else None


def _edad(guardado):
    try:
        return dt.datetime.now() - dt.datetime.fromisoformat(guardado["consulta"])
    except (KeyError, TypeError, ValueError):
        return None


def obten(carpeta, prefijo, simbolo, caducidad, descarga):
    """Lo guardado si es reciente; si no, lo descarga con descarga() y lo guarda.

    caducidad(guardado) dice cuánto dura lo guardado (un timedelta): así cada uso
    puede dar más o menos tiempo según lo que haya llegado."""
    os.makedirs(carpeta, exist_ok=True)
    archivo = ruta(carpeta, prefijo, simbolo)
    guardado = _lee(archivo)
    if guardado:
        edad = _edad(guardado)
        if edad is not None and edad < caducidad(guardado):
            return guardado
    try:
        datos = descarga()
    except Exception:
        if guardado:
            guardado["sinConexion"] = True
        return guardado
    nuevo = {"consulta": dt.datetime.now().replace(microsecond=0).isoformat(), "datos": datos}
    try:
        with open(archivo, "w", encoding="utf-8") as f:
            json.dump(nuevo, f, ensure_ascii=False)
    except OSError:
        pass
    return nuevo
