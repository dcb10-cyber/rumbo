# -*- coding: utf-8 -*-
"""
[mod] La capa de Caudal: configuración, la «foto» guardada y cómo se superpone a la cartera
==========================================================================================
Lo que viene de Caudal NO se escribe en cartera.json. Se guarda aparte, como una foto completa,
en mis_datos/caudal/<perfil>.json, y se SUPERPONE cada vez que Rumbo lee la cartera:

    cartera que ve el panel = cartera.json + movimientos y valoraciones de la foto

Por qué no en cartera.json (comprobado en el código del autor):
  - editar un movimiento con el formulario borra los campos extra (guarda_movimiento hace clear());
  - cambia() escribe siempre en el perfil ACTIVO, no en el que tú configuras;
  - cada guardado crea una copia y solo se guardan 20: una sincronización se las comería.

Engancha con DOS líneas [mod] en servidor.py, justo debajo de mods.registra(...):

    from .mods import caudal as _caudal  # [mod] capa de Caudal al leer la cartera
    cartera, cartera_todos = _caudal.envuelve(cartera, cartera_todos, modo, carpeta, perfiles, con_cartera)  # [mod]

Las funciones de servidor.py buscan cartera()/cartera_todos() por nombre al ejecutarse, así que
recalcula, /api/cartera, fiscal, /api/unidades, exportar y los demás mods ya leen con la capa.
cambia(), importar y las copias leen el archivo directamente y no la ven (es lo que queremos).

Configuración: mis_datos/caudal.json
    {"activo": true, "url": "http://127.0.0.1:8000", "token": "…", "perfil": "principal", "desde": "2026-12-01"}
Sin archivo, o con "activo": false, el mod no hace nada (ni capa, ni portero, ni sincronización).
"""
import json
import logging
import os
import re

ESQUEMA_FOTO = 1
_ID_PERFIL = re.compile(r"[a-z0-9_]{1,40}")
_FECHA = re.compile(r"\d{4}-\d{2}-\d{2}")
_ID_CAUDAL = re.compile(r"c\d+(\.\d+)?")
_CACHE = {}   # ruta -> (marca del archivo, contenido): la foto no se vuelve a leer si no ha cambiado


def _servidor():
    from ... import servidor   # dentro de la función: servidor.py importa este mod al arrancar
    return servidor


def carpeta_datos():
    return _servidor().DATOS


def es_de_caudal(ident):
    """¿Es el id de un movimiento traído de Caudal? (c + número; los de Rumbo son m + número)."""
    return bool(_ID_CAUDAL.fullmatch(str(ident or "")))


def es_valoracion_de_caudal(ident):
    return str(ident or "").startswith("cv")


# ---------------------------------------------------------------- configuración

def ruta_config():
    return os.path.join(carpeta_datos(), "caudal.json")


def lee_config_cruda():
    try:
        with open(ruta_config(), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def lee_config():
    """La configuración si la sincronización está ACTIVA y bien escrita; si no, None."""
    d = lee_config_cruda()
    if not d or d.get("activo") is not True:
        return None
    perfil = str(d.get("perfil") or "principal")
    desde = str(d.get("desde") or "")
    if not _ID_PERFIL.fullmatch(perfil) or (desde and not _FECHA.fullmatch(desde)):
        return None
    return {"activo": True, "url": str(d.get("url") or "http://127.0.0.1:8000"),
            "token": str(d.get("token") or ""), "perfil": perfil, "desde": desde}


# ---------------------------------------------------------------- la foto

def ruta_foto(perfil):
    return os.path.join(carpeta_datos(), "caudal", f"{perfil}.json")


def _valida_foto(foto, perfil):
    if not isinstance(foto, dict) or foto.get("schema") != ESQUEMA_FOTO or foto.get("perfil") != perfil:
        return None
    movs, vals = foto.get("movimientos"), foto.get("valoraciones")
    if not isinstance(movs, list) or not isinstance(vals, list):
        return None
    for m in movs:
        if not isinstance(m, dict) or not es_de_caudal(m.get("id")) or not _FECHA.fullmatch(str(m.get("fecha") or "")) \
                or not isinstance(m.get("producto"), str):
            return None
    for v in vals:
        if not isinstance(v, dict) or not es_valoracion_de_caudal(v.get("id")) \
                or not _FECHA.fullmatch(str(v.get("fecha") or "")) or not isinstance(v.get("producto"), str) \
                or not isinstance(v.get("valor"), (int, float)):
            return None
    return foto


def lee_foto(perfil):
    """La última foto guardada de ese perfil, o None si no hay o está mal (nunca falla)."""
    ruta = ruta_foto(perfil)
    try:
        st = os.stat(ruta)
        marca = (st.st_mtime_ns, st.st_size)
        guardado = _CACHE.get(ruta)
        if guardado and guardado[0] == marca:
            return _valida_foto(json.loads(guardado[1]), perfil)
        with open(ruta, encoding="utf-8") as f:
            texto = f.read()
        _CACHE[ruta] = (marca, texto)
        return _valida_foto(json.loads(texto), perfil)
    except (OSError, ValueError):
        return None


def guarda_foto(perfil, foto):
    """Escritura atómica: archivo temporal + os.replace (si se corta, la foto anterior sigue entera)."""
    ruta = ruta_foto(perfil)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(foto, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ruta)
    _CACHE.pop(ruta, None)


# ---------------------------------------------------------------- superponer

def superpone(cfg, foto, prefijo=""):
    """Una cartera NUEVA = cfg + lo de la foto. No toca cfg. Lo que apunta a productos que ya no
    existen se salta. Si hay una valoración propia del mismo producto y día, gana la de Caudal.
    Con prefijo (vista «Todos juntos»), ids, productos y destinos llevan delante «<perfil>__»."""
    if not foto:
        return cfg
    ids = {p.get("id") for p in cfg.get("productos", [])}
    movs = []
    for m in foto.get("movimientos", []):
        nuevo = dict(m, id=prefijo + str(m["id"]), producto=prefijo + str(m["producto"]))
        if m.get("destino"):
            nuevo["destino"] = prefijo + str(m["destino"])
        if nuevo["producto"] in ids and (not nuevo.get("destino") or nuevo["destino"] in ids):
            movs.append(nuevo)
    vals = [dict(v, id=prefijo + str(v["id"]), producto=prefijo + str(v["producto"]))
            for v in foto.get("valoraciones", [])]
    vals = [v for v in vals if v["producto"] in ids]
    if not movs and not vals:
        return cfg
    tapadas = {(v["producto"], v["fecha"]) for v in vals}
    salida = dict(cfg)
    salida["movimientos"] = sorted(list(cfg.get("movimientos", [])) + movs, key=lambda m: m.get("fecha") or "")
    salida["valoraciones"] = sorted([v for v in cfg.get("valoraciones", [])
                                     if (v.get("producto"), v.get("fecha")) not in tapadas] + vals,
                                    key=lambda v: (v.get("producto") or "", v.get("fecha") or ""))
    return salida


def foto_para(perfil_activo):
    """La foto que toca superponer con ese perfil activo (None si ninguna)."""
    cfgc = lee_config()
    if not cfgc or perfil_activo != cfgc["perfil"]:
        return None
    return lee_foto(cfgc["perfil"])


def envuelve(cartera, cartera_todos, modo, carpeta, perfiles, con_cartera):
    """Devuelve (cartera, cartera_todos) que leen con la capa de Caudal encima.
      - modo «propio»: la foto del perfil activo (si es el configurado);
      - modo «demo»: nada;
      - modo «todos»: la foto del perfil configurado, con su prefijo, como hace cartera_todos.
    Si algo falla, la cartera tal cual: la capa nunca puede romper el panel."""

    def cartera_con_caudal():
        base = cartera()
        try:
            if modo() != "propio":
                return base   # en «todos», cartera() ya ha usado cartera_todos con la capa
            return superpone(base, foto_para(perfiles()["activo"]))
        except Exception:
            logging.exception("[mod caudal] No he podido superponer la foto de Caudal")
            return base

    def cartera_todos_con_caudal():
        base = cartera_todos()
        try:
            cfgc = lee_config()
            if not cfgc or cfgc["perfil"] not in {x["id"] for x in con_cartera(perfiles()["lista"])}:
                return base
            return superpone(base, lee_foto(cfgc["perfil"]), prefijo=cfgc["perfil"] + "__")
        except Exception:
            logging.exception("[mod caudal] No he podido superponer la foto de Caudal en «Todos juntos»")
            return base

    return cartera_con_caudal, cartera_todos_con_caudal
