"""[mod] Caudal → Rumbo: traducción, capa al leer la cartera, todo o nada, perfiles, portero y conciliación.

Caudal está SIMULADO con tests/datos/caudal_contrato_v1.json (datos inventados, copia idéntica del
de Caudal): nunca se sale a la red. Cada prueba usa una carpeta de datos temporal.
"""
import copy
import json
import os
import types
import unittest
import urllib.error
from unittest import mock

from comun import RAIZ, ConCarpeta, PreciosInventados, lee_demo
from app import almacen, fiscal, servidor
from app.mods.caudal import capa, cliente, rutas, traductor

CONTRATO = os.path.join(RAIZ, "tests", "datos", "caudal_contrato_v1.json")


def lee_contrato():
    with open(CONTRATO, encoding="utf-8") as f:
        c = json.load(f)
    return {n: c[n] for n in cliente.RUTAS}


def productos_contrato():
    """Productos de Rumbo que encajan con los activos y cuentas del contrato."""
    return [
        {"id": "iwda", "nombre": "iShares MSCI World", "tipo": "etf", "fuente": "yahoo", "codigo": "IWDA.AS",
         "identificador": "IE00B4L5Y983", "moneda": "EUR", "slot": 1},                      # por ISIN
        {"id": "apple", "nombre": "Apple", "tipo": "accion", "fuente": "yahoo", "codigo": "AAPL",
         "moneda": "USD", "slot": 2},                                                         # por ticker
        {"id": "world", "nombre": "Fidelity World", "tipo": "fondo", "fuente": "morningstar",
         "codigo": "0P0001CLDK", "expoComo": "IE00BYX5NX33", "moneda": "EUR", "slot": 3},     # por expoComo
        {"id": "emerg", "nombre": "Fidelity Emergentes", "tipo": "fondo", "fuente": "morningstar",
         "codigo": "0P0001CJGK", "identificador": "IE00BYX5M476", "moneda": "EUR", "slot": 4},  # solo destino
        {"id": "santander", "nombre": "Santander", "tipo": "accion", "fuente": "yahoo", "codigo": "SAN.MC",
         "moneda": "EUR", "slot": 5},                                                         # por ticker
        {"id": "remunerada", "nombre": "Cuenta remunerada", "tipo": "efectivo", "fuente": "manual", "slot": 6},
        {"id": "prestamo", "nombre": "Préstamo coche", "tipo": "deuda", "fuente": "manual", "slot": 7},
    ]


def contrato_desde_cartera(cfg, version="v1"):
    """Lo que publicaría Caudal si tuviera los movimientos de esta cartera de Rumbo (compras y ventas)."""
    prods = {p["id"]: p for p in cfg["productos"]}
    activos, ops = {}, []
    for n, m in enumerate(cfg["movimientos"], 1):
        p = prods[m["producto"]]
        if m["producto"] not in activos:
            activos[m["producto"]] = {"id": len(activos) + 1, "isin": p.get("identificador") or None,
                                      "ticker": p.get("codigo") or None, "nombre": p["nombre"],
                                      "tipo": p["tipo"], "divisa": "EUR"}
        com = m.get("comision") or 0
        bruto = round(m["importe"] - com, 2) if m["tipo"] == "compra" else round(m["importe"] + com, 2)
        ops.append({"id": str(n), "tipo": m["tipo"], "fecha": m["fecha"], "activo": activos[m["producto"]],
                    "cuenta_id": 1, "unidades": m["unidades"], "bruto_eur": bruto, "comision_eur": com,
                    "neto_eur": m["importe"], "ret_origen_eur": None, "ret_es_eur": None, "pais": None,
                    "convenio_pct": None, "destino_activo_id": None, "unidades_destino": None,
                    "nota": m.get("nota")})
    return {"operaciones": {"schema": 1, "version": version, "operaciones": ops},
            "saldos": {"schema": 1, "version": version, "cuentas": [], "saldos": []},
            "posiciones": {"schema": 1, "version": version, "posiciones": [
                {"activo_id": a["id"], "unidades": almacen.unidades_a(cfg, pid, "2999-12-31")}
                for pid, a in activos.items()]}}


class CaudalFalso:
    """Caudal simulado: responde 304 si la versión que se le manda es la suya."""

    def __init__(self, crudo):
        self.crudo = copy.deepcopy(crudo)
        self.llamadas = []
        self.caido = False

    def descarga(self, base, token, versiones):
        self.llamadas.append(dict(versiones or {}))
        if self.caido:
            raise cliente.ErrorCaudal("Caudal no responde. ¿Está abierto?")
        salida = {}
        for n in cliente.RUTAS:
            cuerpo = self.crudo[n]
            if (versiones or {}).get(n) == cuerpo["version"]:
                salida[n] = (304, cuerpo["version"], None)
            else:
                salida[n] = (200, cuerpo["version"], copy.deepcopy(cuerpo))
        return salida

    def cambia(self, nombre, fn):
        fn(self.crudo[nombre])
        self.crudo[nombre]["version"] += "x"


def _sin_red(*a, **k):
    raise AssertionError("Las pruebas del mod de Caudal no pueden salir a la red")


class ConCaudal(ConCarpeta):
    """Carpeta de datos temporal, precios inventados y Caudal simulado con el contrato."""
    DESDE = "2026-01-01"

    def setUp(self):
        super().setUp()
        self.caudal = CaudalFalso(lee_contrato())
        self.parches = [mock.patch.object(servidor, "DATOS", self.carpeta), PreciosInventados(),
                        mock.patch.object(cliente, "descarga", side_effect=self.caudal.descarga),
                        mock.patch.object(cliente, "_abrir", side_effect=_sin_red)]
        for p in self.parches:
            p.__enter__()
        rutas._ULTIMO.clear()
        rutas._PENDIENTE.clear()
        capa._CACHE.clear()
        self.web = servidor.app.test_client()
        self.escribe_cartera({**almacen.CARTERA_VACIA, "productos": productos_contrato()})
        self.config()

    def tearDown(self):
        for p in reversed(self.parches):
            p.__exit__(None, None, None)
        super().tearDown()

    def config(self, **cambios):
        datos = {"activo": True, "url": "http://127.0.0.1:8000", "token": "secreto", "perfil": "principal",
                 "desde": self.DESDE, **cambios}
        with open(os.path.join(self.carpeta, "caudal.json"), "w", encoding="utf-8") as f:
            json.dump(datos, f)

    def escribe_cartera(self, cfg, carpeta=None):
        carpeta = carpeta or self.carpeta
        os.makedirs(carpeta, exist_ok=True)
        with open(os.path.join(carpeta, "cartera.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False)

    def sincroniza(self):
        r = self.web.post("/api/caudal-mod/sincronizar")
        self.assertEqual(r.status_code, 200)
        return r.get_json()

    def enlaza(self, clase, caudal_id, producto):
        return self.web.post("/api/caudal-mod/enlazar", json={"clase": clase, "caudal_id": caudal_id,
                                                               "producto": producto})

    def enlaza_todo(self):
        for args in (("activo", "104", "emerg"), ("cuenta", "3", "remunerada"), ("cuenta", "4", "prestamo")):
            r = self.enlaza(*args)
            self.assertEqual(r.status_code, 200, r.get_json())

    def foto(self):
        return capa.lee_foto("principal")

    def movs(self):
        return {m["id"]: m for m in self.foto()["movimientos"]}


# ---------------------------------------------------------------- panel idéntico

def _sin_ids(x):
    if isinstance(x, dict):
        return {k: _sin_ids(v) for k, v in x.items() if k not in ("id", "origen")}
    if isinstance(x, list):
        return [_sin_ids(v) for v in x]
    return x


class PanelIdentico(ConCaudal):
    DESDE = "1900-01-01"

    def test_la_demo_desde_caudal_da_el_mismo_panel_y_la_misma_renta(self):
        demo = lee_demo()
        self.caudal.crudo = contrato_desde_cartera(demo)
        self.escribe_cartera(dict(demo, movimientos=[]))
        r = self.sincroniza()
        self.assertTrue(r["ok"], r)
        self.assertEqual(len(self.foto()["movimientos"]), len(demo["movimientos"]))
        self.assertEqual(r["conciliacion"], [])
        con_capa = servidor.recalcula(descargar="faltan")
        cfg = servidor.cartera()
        renta_capa = {a: fiscal.informe(cfg, a) for a in fiscal.anos_con_datos(cfg)}

        self.escribe_cartera(demo)
        os.remove(os.path.join(self.carpeta, "caudal.json"))
        normal = servidor.recalcula(descargar="faltan")
        cfg = servidor.cartera()
        renta_normal = {a: fiscal.informe(cfg, a) for a in fiscal.anos_con_datos(cfg)}

        self.assertTrue(renta_normal)
        self.assertGreater(con_capa["total"]["patrimonio"], 0)
        self.assertTrue(any(inf["ventas"] for inf in renta_capa.values()))   # las 2 ventas de la demo
        self.assertEqual(sorted(renta_capa), sorted(renta_normal))
        self.assertEqual(_sin_ids(con_capa), _sin_ids(normal))
        self.assertEqual(_sin_ids(renta_capa), _sin_ids(renta_normal))


# ---------------------------------------------------------------- traducción

class Traduccion(ConCaudal):
    def test_cada_tipo_del_contrato(self):
        self.assertTrue(self.sincroniza()["ok"])
        self.enlaza_todo()
        m = self.movs()
        self.assertEqual(sorted(m), sorted(f"c{n}" for n in range(1001, 1014)))
        self.assertTrue(all(x["origen"] == "caudal" for x in m.values()))
        ver = lambda mid, *claves: tuple(m[mid].get(k) for k in claves)  # noqa: E731
        claves = ("tipo", "producto", "unidades", "importe", "comision")
        # Compra: importe = bruto + comisión (lo que pagaste); venta: bruto − comisión (lo que cobras).
        self.assertEqual(ver("c1001", *claves), ("compra", "iwda", 10, 1001.5, 1.5))
        self.assertEqual(m["c1001"]["nota"], "Primera compra")
        self.assertEqual(ver("c1002", *claves), ("compra", "apple", 40, 6801, 1))
        self.assertEqual(ver("c1003", *claves), ("compra", "world", 120.5, 2000, None))
        self.assertEqual(ver("c1004", *claves), ("compra", "santander", 100, 382, 2))
        self.assertEqual(ver("c1007", *claves), ("venta", "iwda", 4, 439, 1))
        self.assertEqual(ver("c1008", "tipo", "producto", "importe"), ("comision", "iwda", 2.5))
        self.assertEqual(ver("c1012", *claves), ("compra", "iwda", 2, 210, None))
        # Dividendo de EE. UU.: neto, con el bruto y las retenciones en «fiscal» (15 % y 19 %).
        self.assertEqual(ver("c1005", "tipo", "producto", "importe"), ("dividendo", "apple", 27.54))
        self.assertEqual(m["c1005"]["fiscal"], {"pais": "US", "bruto": 40.0, "origen": 6.0, "espana": 6.46,
                                                "convenio": 0.15})
        # Interés: dividendo del producto efectivo enlazado a la cuenta, con el 19 % español.
        self.assertEqual(ver("c1006", "tipo", "producto", "importe"), ("dividendo", "remunerada", 24.3))
        self.assertEqual(m["c1006"]["fiscal"], {"pais": "ES", "bruto": 30.0, "origen": 0.0, "espana": 5.7,
                                                "convenio": None})
        self.assertEqual(m["c1011"]["fiscal"]["espana"], 3.8)
        self.assertNotIn("fiscal", m["c1013"])   # sin datos fiscales en Caudal: no se inventan
        # Traspaso total entre fondos; ajuste por split: Caudal dice +100, Rumbo guarda las 200 que tienes.
        self.assertEqual(ver("c1009", "tipo", "producto", "destino", "unidades", "unidadesDestino", "importe", "total"),
                         ("traspaso", "world", "emerg", 120.5, 150.25, 2100, True))
        self.assertEqual(ver("c1010", "tipo", "producto", "unidades", "importe"), ("ajuste", "santander", 200, 0))
        # Saldos → valoraciones de los productos enlazados (el préstamo, en positivo).
        vals = {(v["producto"], v["fecha"]): v["valor"] for v in self.foto()["valoraciones"]}
        self.assertEqual(vals, {("remunerada", "2026-09-30"): 10024.3, ("remunerada", "2026-10-31"): 10024.3,
                                ("remunerada", "2026-11-20"): 10024.3, ("prestamo", "2026-09-30"): 8000,
                                ("prestamo", "2026-10-31"): 7800, ("prestamo", "2026-11-20"): 7650})
        self.assertTrue(all(v["id"].startswith("cv") and v["origen"] == "caudal" for v in self.foto()["valoraciones"]))
        # Con todo enlazado, las unidades cuadran con Caudal.
        self.assertEqual(self.foto()["conciliacion"], [])

    def test_enlaces_automaticos_y_pendientes(self):
        r = self.sincroniza()
        self.assertTrue(r["ok"], r)
        como = {e["caudal_id"]: (e["producto"], e["como"]) for e in self.foto()["enlazados"]}
        self.assertEqual(como, {"101": ("iwda", "ISIN"), "102": ("apple", "ticker"), "103": ("world", "ISIN"),
                                "105": ("santander", "ticker")})
        pend = {(p["clase"], p["caudal_id"]): p for p in r["pendientes"]}
        self.assertTrue(pend[("activo", "104")]["obligatorio"])      # destino del traspaso: sin ISIN conocido
        self.assertTrue(pend[("cuenta", "3")]["obligatorio"])        # tiene intereses
        self.assertFalse(pend[("cuenta", "1")]["obligatorio"])       # solo saldos: enlazarla es opcional
        self.assertNotIn("c1009", self.movs())                       # el traspaso no entra...
        self.assertNotIn("c1006", self.movs())                       # ...ni el interés
        self.assertTrue(any("no entran" in a for a in r["avisos"]))
        # Sin el traspaso, Rumbo tiene 120,5 del fondo World y Caudal 0: la conciliación lo dice.
        self.assertEqual([(c["producto"], c["rumbo"], c["caudal"]) for c in r["conciliacion"]], [("world", 120.5, 0)])

    def test_enlazar_a_mano(self):
        self.sincroniza()
        r = self.enlaza("activo", "104", "emerg")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["cambiado"])
        self.assertIn("c1009", self.movs())
        self.assertEqual(json.load(open(os.path.join(self.carpeta, "cartera.json"), encoding="utf-8"))["movimientos"], [])
        # Una cuenta solo con efectivo o deuda; un activo, nunca con ellos.
        self.assertEqual(self.enlaza("cuenta", "3", "iwda").status_code, 400)
        self.assertEqual(self.enlaza("activo", "101", "remunerada").status_code, 400)
        self.assertEqual(self.enlaza("activo", "101", "no_existe").status_code, 400)
        # Quitar el enlace a mano: el traspaso vuelve a quedar fuera.
        self.assertEqual(self.enlaza("activo", "104", "").status_code, 200)
        self.assertNotIn("c1009", self.movs())

    def test_el_contrato_tiene_el_formato_que_espera_rumbo(self):
        for nombre, cuerpo in lee_contrato().items():
            self.assertEqual(traductor.comprueba_formato(nombre, cuerpo), [], nombre)
        self.assertTrue(traductor.comprueba_formato("operaciones", {"schema": 2, "operaciones": []}))


# ---------------------------------------------------------------- todo o nada, ids, desde y ETag

class TodoONada(ConCaudal):
    def test_una_venta_de_mas_deja_la_foto_anterior_intacta(self):
        self.assertTrue(self.sincroniza()["ok"])
        with open(capa.ruta_foto("principal"), "rb") as f:
            antes = f.read()
        self.caudal.cambia("operaciones", lambda c: next(o for o in c["operaciones"] if o["id"] == "1007")
                           .update(unidades=400, bruto_eur=440, neto_eur=439))
        r = self.sincroniza()
        self.assertFalse(r["ok"])
        self.assertFalse(r["cambiado"])
        self.assertEqual(len(r["errores"]), 1)
        error = r["errores"][0]
        self.assertEqual((error["fecha"], error["activo"]), ("2026-06-10", "iShares Core MSCI World"))
        self.assertIn("solo tenías", error["motivo"])
        with open(capa.ruta_foto("principal"), "rb") as f:
            self.assertEqual(f.read(), antes)
        # El panel sigue con lo anterior.
        self.assertIn("c1007", {m["id"] for m in servidor.cartera()["movimientos"]})
        self.assertEqual(self.web.get("/api/caudal-mod/estado").get_json()["errores"][0]["fecha"], "2026-06-10")

    def test_ids_estables_entre_sincronizaciones(self):
        self.sincroniza()
        primeros = sorted(self.movs())
        self.caudal.cambia("operaciones", lambda c: None)   # versión nueva, mismo contenido
        r = self.sincroniza()
        self.assertTrue(r["ok"])
        self.assertFalse(r["cambiado"])
        self.assertEqual(sorted(self.movs()), primeros)

    def test_solo_entra_lo_de_desde(self):
        self.config(desde="2026-09-01")
        self.enlaza_todo()
        self.sincroniza()
        self.assertEqual(sorted(self.movs()), ["c1011", "c1012", "c1013"])
        self.assertTrue(all(v["fecha"] >= "2026-09-01" for v in self.foto()["valoraciones"]))
        self.assertEqual(self.foto()["antesDeDesde"], 10)

    def test_con_el_mismo_etag_no_se_recalcula(self):
        with mock.patch.object(servidor, "recalcula", wraps=servidor.recalcula) as recalcula:
            r = self.sincroniza()
            self.assertTrue(r["cambiado"])
            self.assertEqual(recalcula.call_count, 1)
            r = self.sincroniza()
            self.assertTrue(r["ok"])
            self.assertFalse(r["cambiado"])
            self.assertEqual(recalcula.call_count, 1)
        self.assertEqual(self.caudal.llamadas[0], {})
        self.assertEqual(self.caudal.llamadas[1], {n: self.caudal.crudo[n]["version"] for n in cliente.RUTAS})

    def test_si_cambia_tu_cartera_se_vuelve_a_traducir(self):
        cfg = {**almacen.CARTERA_VACIA, "productos": [p for p in productos_contrato() if p["id"] != "santander"]}
        self.escribe_cartera(cfg)
        self.sincroniza()
        self.assertNotIn("c1004", self.movs())
        self.escribe_cartera({**almacen.CARTERA_VACIA, "productos": productos_contrato()})
        r = self.sincroniza()   # Caudal responde 304, pero ahora existe «Santander» y se enlaza por ticker
        self.assertTrue(r["cambiado"])
        self.assertIn("c1004", self.movs())


# ---------------------------------------------------------------- perfiles

class Perfiles(ConCaudal):
    def test_la_foto_del_principal_no_sale_en_otro_perfil(self):
        self.sincroniza()
        self.assertIn("c1001", {m["id"] for m in self.web.get("/api/cartera").get_json()["cartera"]["movimientos"]})
        self.assertEqual(self.web.post("/api/perfiles", json={"nombre": "Ana"}).status_code, 200)
        self.escribe_cartera({**almacen.CARTERA_VACIA, "productos": productos_contrato()},
                             os.path.join(self.carpeta, "perfiles", "ana"))
        self.assertEqual(servidor.perfiles()["activo"], "ana")
        self.assertEqual(self.web.get("/api/cartera").get_json()["cartera"]["movimientos"], [])

    def test_todos_juntos_la_muestra_con_prefijo(self):
        self.sincroniza()
        self.web.post("/api/perfiles", json={"nombre": "Ana"})
        self.assertEqual(self.web.post("/api/perfiles/activar", json={"id": "todos"}).status_code, 200)
        ids = {m["id"]: m for m in servidor.cartera()["movimientos"]}
        self.assertIn("principal__c1001", ids)
        self.assertEqual(ids["principal__c1001"]["producto"], "principal__iwda")
        self.assertNotIn("c1001", ids)

    def test_en_la_demo_no_hay_capa(self):
        self.sincroniza()
        os.remove(os.path.join(self.carpeta, "cartera.json"))
        self.assertEqual(servidor.modo(), "demo")
        self.assertFalse(any(str(m["id"]).startswith("c") for m in servidor.cartera()["movimientos"]))

    def test_con_activo_false_no_hace_nada(self):
        self.sincroniza()
        self.config(activo=False)
        self.assertEqual(servidor.cartera()["movimientos"], [])
        self.assertFalse(self.sincroniza()["ok"])
        self.assertFalse(self.web.get("/api/caudal-mod/estado").get_json()["activo"])


# ---------------------------------------------------------------- portero

class Portero(ConCaudal):
    def setUp(self):
        super().setUp()
        self.sincroniza()

    def test_editar_o_borrar_lo_de_caudal(self):
        r = self.web.post("/api/movimientos", json={"id": "c1001", "producto": "iwda", "tipo": "compra",
                                                   "fecha": "2026-02-03", "unidades": 1, "importe": 10})
        self.assertEqual(r.status_code, 409)
        self.assertIn("viene de Caudal: edítalo allí", r.get_json()["errores"][0])
        r = self.web.delete("/api/movimientos/c1001")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.web.delete("/api/valoraciones/cv1_2026-09-30").status_code, 409)

    def test_anotar_a_mano_en_un_producto_enlazado(self):
        r = self.web.post("/api/movimientos", json={"producto": "iwda", "tipo": "compra", "fecha": "2026-11-02",
                                                   "unidades": 1, "importe": 100})
        self.assertEqual(r.status_code, 409)
        self.assertIn("enlazado con Caudal", r.get_json()["errores"][0])
        # Antes de «desde», sí (es tu historia anterior en Rumbo).
        r = self.web.post("/api/movimientos", json={"producto": "iwda", "tipo": "compra", "fecha": "2025-11-02",
                                                   "unidades": 1, "importe": 100})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertIn("c1001", {m["id"] for m in r.get_json()["cartera"]["movimientos"]})   # con la capa
        # Un producto sin enlazar, también.
        r = self.web.post("/api/movimientos", json={"producto": "emerg", "tipo": "compra", "fecha": "2026-11-02",
                                                   "unidades": 1, "importe": 100})
        self.assertEqual(r.status_code, 200, r.get_json())

    def test_importar_y_periodicas_sobre_enlazados(self):
        plan = types.SimpleNamespace(movimientos=[{"producto": "apple", "fecha": "2026-10-01", "tipo": "compra"}],
                                     valoraciones=[])
        servidor.PLANES["tok"] = plan
        try:
            r = self.web.post("/api/importar/confirmar", json={"token": "tok"})
            self.assertEqual(r.status_code, 409)
            self.assertIn("Apple", r.get_json()["errores"][0])
        finally:
            servidor.PLANES.clear()
        r = self.web.post("/api/periodicas/crear", json={"producto": "iwda", "importe": 100, "dia": 1,
                                                        "desde": "2026-01-01", "hasta": "2026-11-01"})
        self.assertEqual(r.status_code, 409)

    def test_lo_de_otra_web_sigue_dando_403(self):
        for cab in ({"Origin": "https://evil.com"}, {"Sec-Fetch-Site": "cross-site"}):
            r = self.web.delete("/api/movimientos/c1001", headers=cab)
            self.assertEqual(r.status_code, 403)
            r = self.web.post("/api/caudal-mod/sincronizar", headers=cab)
            self.assertEqual(r.status_code, 403)

    def test_sin_sincronizacion_activa_no_actua(self):
        self.config(activo=False)
        r = self.web.delete("/api/movimientos/c1001")
        self.assertEqual(r.status_code, 400)   # lo contesta Rumbo: «Ese movimiento ya no existe»


# ---------------------------------------------------------------- Caudal caído y conciliación

class CaudalCaido(ConCaudal):
    def test_sin_conexion_el_panel_sigue_con_la_ultima_foto(self):
        self.assertTrue(self.sincroniza()["ok"])
        self.caudal.caido = True
        r = self.sincroniza()
        self.assertFalse(r["ok"])
        self.assertTrue(any(a.startswith("Caudal sin conexión: datos del ") for a in r["avisos"]), r["avisos"])
        self.assertIn("c1001", {m["id"] for m in servidor.cartera()["movimientos"]})
        estado = self.web.get("/api/caudal-mod/estado").get_json()
        self.assertFalse(estado["conexion"])

    def test_sin_conexion_y_sin_foto(self):
        self.caudal.caido = True
        r = self.sincroniza()
        self.assertFalse(r["ok"])
        self.assertIsNone(self.foto())
        self.assertEqual(servidor.cartera()["movimientos"], [])

    def test_una_foto_rota_no_rompe_nada(self):
        self.sincroniza()
        with open(capa.ruta_foto("principal"), "w", encoding="utf-8") as f:
            f.write("{esto no es json")
        self.assertEqual(servidor.cartera()["movimientos"], [])
        self.assertEqual(self.web.get("/api/cartera").status_code, 200)


class Conciliacion(ConCaudal):
    def test_unidades_distintas_avisan(self):
        self.enlaza_todo()
        self.caudal.cambia("posiciones", lambda c: c["posiciones"][0].update(unidades=9))
        r = self.sincroniza()
        self.assertTrue(r["ok"])
        self.assertEqual([(c["producto"], c["rumbo"], c["caudal"]) for c in r["conciliacion"]], [("iwda", 8, 9)])
        self.assertTrue(any("no cuadran" in a for a in r["avisos"]))


# ---------------------------------------------------------------- cliente HTTP

class _Respuesta:
    def __init__(self, cuerpo, etag=""):
        self.cuerpo, self.headers = cuerpo, {"ETag": etag}

    def read(self, n=-1):
        return self.cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Cliente(unittest.TestCase):
    def test_direcciones_permitidas(self):
        self.assertEqual(cliente.comprueba_url("http://127.0.0.1:8000/"), "http://127.0.0.1:8000")
        self.assertEqual(cliente.comprueba_url("http://localhost:8000"), "http://localhost:8000")
        self.assertEqual(cliente.comprueba_url("https://caudal.ejemplo.ts.net"), "https://caudal.ejemplo.ts.net")
        for mala in ("http://192.168.1.5:8000", "http://caudal.com", "ftp://127.0.0.1", "file:///c:/x",
                     "https://yo:clave@caudal.com", ""):
            with self.subTest(url=mala):
                with self.assertRaises(cliente.ErrorCaudal):
                    cliente.comprueba_url(mala)

    def test_cabeceras_timeout_y_304(self):
        vistas = []

        def abrir(peticion, timeout):
            vistas.append((peticion, timeout))
            if peticion.get_header("If-none-match"):
                raise urllib.error.HTTPError(peticion.full_url, 304, "Not Modified", {}, None)
            return _Respuesta(json.dumps({"schema": 1, "version": "v9", "posiciones": []}).encode(), '"v9"')

        with mock.patch.object(cliente, "_abrir", side_effect=abrir):
            r = cliente.descarga("http://127.0.0.1:8000", "secreto", {"operaciones": "v1"})
        self.assertEqual(r["operaciones"], (304, "v1", None))
        self.assertEqual(r["posiciones"][:2], (200, "v9"))
        peticion, timeout = vistas[0]
        self.assertEqual(timeout, 10)
        self.assertEqual(peticion.get_method(), "GET")
        self.assertEqual(peticion.get_header("Authorization"), "Bearer secreto")
        self.assertEqual(peticion.get_header("If-none-match"), '"v1"')
        self.assertEqual(vistas[1][0].full_url, "http://127.0.0.1:8000/api/v1/cuentas/saldos?corte=fin_mes")

    def test_errores_con_explicacion(self):
        for codigo, texto in ((401, "token"), (503, "CAUDAL_TOKEN_LECTURA"), (302, "redirección"), (500, "500")):
            with self.subTest(codigo=codigo):
                error = urllib.error.HTTPError("http://127.0.0.1:8000", codigo, "x", {}, None)
                with mock.patch.object(cliente, "_abrir", side_effect=error):
                    with self.assertRaises(cliente.ErrorCaudal) as e:
                        cliente.pide("http://127.0.0.1:8000", "/x", "t")
                self.assertIn(texto, str(e.exception))
        with mock.patch.object(cliente, "_abrir", side_effect=urllib.error.URLError("apagado")):
            with self.assertRaises(cliente.ErrorCaudal):
                cliente.pide("http://127.0.0.1:8000", "/x", "t")
        with self.assertRaises(cliente.ErrorCaudal):
            cliente.descarga("http://127.0.0.1:8000", "", {})

    def test_no_sigue_redirecciones(self):
        manejador = cliente._SinRedirecciones()
        self.assertIsNone(manejador.redirect_request(None, None, 302, "x", {}, "https://otro.com"))


# ---------------------------------------------------------------- estructura

class Estructura(unittest.TestCase):
    def test_servidor_lleva_las_dos_lineas_mod(self):
        with open(os.path.join(RAIZ, "app", "servidor.py"), encoding="utf-8") as f:
            lineas = [x for x in f.read().splitlines() if "_caudal" in x]
        self.assertEqual(len(lineas), 2)
        self.assertTrue(all("[mod]" in x for x in lineas))

    def test_plantilla_de_configuracion_sin_token_real(self):
        with open(os.path.join(RAIZ, "caudal.ejemplo.json"), encoding="utf-8") as f:
            ejemplo = json.load(f)
        self.assertEqual(set(ejemplo) - {"_ayuda"}, {"activo", "url", "token", "perfil", "desde"})
        self.assertFalse(ejemplo["activo"])
        self.assertLess(len(ejemplo["token"]), 30)

    def test_mis_datos_esta_ignorado(self):
        with open(os.path.join(RAIZ, ".gitignore"), encoding="utf-8") as f:
            self.assertIn("mis_datos/", f.read().splitlines())


if __name__ == "__main__":
    unittest.main()
