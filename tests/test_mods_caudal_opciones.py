"""[mod] Opciones de Caudal en Rumbo: sin rutas (404) todo sigue igual; con ellas, IRPF suma los
resultados, el pasivo resta del patrimonio y la pestaña tiene sus datos. Y las acciones de una
asignación llegan como una compra normal: su coste es el valor fiscal de Caudal y sale el aviso de
la regla de los dos meses.

Caudal está SIMULADO con tests/datos/caudal_opciones_v1.json y caudal_contrato_v1_asignacion.json
(datos inventados, copias idénticas de los de Caudal): nunca se sale a la red.
"""
import copy
import json
import os
from unittest import mock

from comun import RAIZ
from app import almacen, fiscal, servidor
from app.mods.caudal import capa, cliente, opciones
import test_mods_caudal as base

DATOS = os.path.join(RAIZ, "tests", "datos")


def lee(nombre):
    with open(os.path.join(DATOS, nombre), encoding="utf-8") as f:
        return json.load(f)


OPCIONES = {n: v for n, v in lee("caudal_opciones_v1.json").items() if not n.startswith("_")}
RUTA_A_NOMBRE = {ruta: nombre for nombre, ruta in opciones.RUTAS.items()}


class CaudalConOpciones:
    """Responde a las 4 rutas de opciones (con 304 si la versión coincide), o 404 si no las tiene."""

    def __init__(self, crudo=None, sin_modulo=False):
        self.crudo = copy.deepcopy(crudo if crudo is not None else OPCIONES)
        self.sin_modulo = sin_modulo
        self.caido = False
        self.pedidas = []

    def pide(self, base, ruta, token, version=None):
        self.pedidas.append((ruta, version))
        if self.caido:
            raise cliente.ErrorCaudal("Caudal no responde. ¿Está abierto?")
        if self.sin_modulo:
            raise cliente.NoExiste("Caudal no tiene esa ruta (error 404).")
        cuerpo = self.crudo[RUTA_A_NOMBRE[ruta]]
        if version == cuerpo["version"]:
            return 304, version, None
        return 200, cuerpo["version"], copy.deepcopy(cuerpo)


class ConOpciones(base.ConCaudal):
    SIN_MODULO = False

    def setUp(self):
        super().setUp()
        self.opc = CaudalConOpciones(sin_modulo=self.SIN_MODULO)
        p = mock.patch.object(cliente, "pide", side_effect=self.opc.pide)
        p.__enter__()
        self.parches.append(p)


# ---------------------------------------------------------------- sin módulo de opciones

class SinModulo(ConOpciones):
    SIN_MODULO = True

    def test_404_todo_sigue_igual_y_avisa(self):
        r = self.sincroniza()
        self.assertTrue(r["ok"], r)
        self.assertIn(opciones.AVISO_SIN_MODULO, r["avisos"])
        self.assertIn("c1001", self.movs())                  # lo de siempre entra igual
        foto = self.foto()
        self.assertFalse(foto["crudo"]["opciones"]["disponible"])
        self.assertFalse(any(v["id"].startswith("cvop_") for v in foto["valoraciones"]))
        irpf = self.web.get("/api/irpf-mod").get_json()
        self.assertTrue(irpf["ok"])
        self.assertEqual(irpf["opciones"]["porAno"], {})
        self.assertFalse(self.web.get("/api/caudal-mod/opciones").get_json()["disponible"])
        self.assertFalse(self.web.get("/api/caudal-mod/estado").get_json()["opciones"]["disponible"])


class PanelIdenticoSinOpciones(base.PanelIdentico):
    """La demo pasada por Caudal da el mismo panel y la misma Renta aunque Caudal no tenga opciones."""

    def setUp(self):
        super().setUp()
        p = mock.patch.object(cliente, "pide", side_effect=CaudalConOpciones(sin_modulo=True).pide)
        p.__enter__()
        self.parches.append(p)


# ---------------------------------------------------------------- con opciones

class ConModulo(ConOpciones):
    def test_se_guardan_en_la_foto_y_salen_en_la_pestana(self):
        r = self.sincroniza()
        self.assertTrue(r["ok"], r)
        opc = self.foto()["crudo"]["opciones"]
        self.assertTrue(opc["disponible"])
        self.assertEqual(set(opc["rutas"]), set(opciones.RUTAS))
        datos = self.web.get("/api/caudal-mod/opciones").get_json()
        self.assertTrue(datos["disponible"])
        self.assertEqual(len(datos["abiertas"]), 3)
        self.assertEqual(len(datos["campanas"]), 3)
        for nombre, cuerpo in OPCIONES.items():
            self.assertEqual(opciones.comprueba_formato(nombre, cuerpo), [], nombre)
        # La segunda vez se mandan las versiones: Caudal responde 304 y no cambia nada.
        r = self.sincroniza()
        self.assertFalse(r["cambiado"])
        self.assertTrue(all(v for ruta, v in self.opc.pedidas[-4:]))

    def test_irpf_suma_los_resultados_del_criterio_de_caudal(self):
        self.sincroniza()
        j = self.web.get("/api/irpf-mod").get_json()
        self.assertTrue(j["ok"])
        op = j["opciones"]
        self.assertEqual(op["criterio"], "dgt")
        a = op["porAno"]["2026"]
        esperado = round(sum(r["resultado_eur"] for r in OPCIONES["resultados"]["resultados"]), 2)
        self.assertEqual(a["saldo"], esperado)
        self.assertEqual(round(a["ganancias"] + a["perdidas"], 2), esperado)
        self.assertLess(a["perdidas"], 0)
        otro = round(sum(r["resultado_otro_criterio_eur"] for r in OPCIONES["resultados"]["resultados"]), 2)
        self.assertEqual(a["saldoOtro"], otro)              # «Con el otro criterio, este año serían…»
        self.assertIn("2026", j["anos"])                    # el año sale aunque no haya ventas
        self.assertIn("Opciones 2026", a["csv"])
        self.assertIn("AAPL 150P 16/01/26", a["csv"])

    def test_si_fallan_se_queda_lo_anterior_y_avisa(self):
        self.sincroniza()
        antes = copy.deepcopy(self.foto()["crudo"]["opciones"]["rutas"])
        self.opc.crudo["resultados"]["version"] += "x"
        self.opc.caido = True
        r = self.sincroniza()
        self.assertTrue(r["ok"], r)                         # lo de siempre no se bloquea
        self.assertTrue(any("No he podido leer las opciones" in a for a in r["avisos"]), r["avisos"])
        self.assertEqual(self.foto()["crudo"]["opciones"]["rutas"], antes)
        # Con un formato raro, tampoco se toca.
        self.opc.caido = False
        self.opc.crudo["resultados"]["schema"] = 2
        r = self.sincroniza()
        self.assertTrue(any("formato" in a for a in r["avisos"]))
        self.assertEqual(self.foto()["crudo"]["opciones"]["rutas"], antes)

    def test_el_pasivo_resta_del_patrimonio(self):
        cfg = {**almacen.CARTERA_VACIA, "productos": base.productos_contrato() + [
            {"id": "opc_vendidas", "nombre": "Opciones vendidas", "tipo": "deuda", "fuente": "manual", "slot": 8}]}
        self.escribe_cartera(cfg)
        self.sincroniza()
        antes = servidor.recalcula(descargar="faltan")["total"]["patrimonio"]
        # Solo con un producto de tipo deuda.
        self.assertEqual(self.enlaza("opciones", "pasivo", "iwda").status_code, 400)
        self.assertEqual(self.enlaza("opciones", "otra", "opc_vendidas").status_code, 400)
        r = self.enlaza("opciones", "pasivo", "opc_vendidas")
        self.assertEqual(r.status_code, 200, r.get_json())
        vals = {v["fecha"]: v for v in self.foto()["valoraciones"] if v["id"].startswith("cvop_")}
        ultimo = OPCIONES["pasivo"]["pasivo"][-1]
        self.assertEqual(vals[ultimo["fecha"]]["valor"], ultimo["pasivo_eur"])
        self.assertTrue(all(v["producto"] == "opc_vendidas" and v["origen"] == "caudal" for v in vals.values()))
        self.assertTrue(all(f >= self.DESDE for f in vals))
        despues = servidor.recalcula(descargar="faltan")["total"]["patrimonio"]
        self.assertAlmostEqual(antes - despues, ultimo["pasivo_eur"], places=2)
        self.assertEqual(self.web.get("/api/caudal-mod/estado").get_json()["opciones"]["pasivo"], "opc_vendidas")
        # Quitar el enlace lo devuelve como estaba.
        self.enlaza("opciones", "pasivo", "")
        self.assertFalse(any(v["id"].startswith("cvop_") for v in self.foto()["valoraciones"]))


# ---------------------------------------------------------------- una asignación llega como compra

class Asignacion(ConOpciones):
    DESDE = "2026-01-01"

    def setUp(self):
        super().setUp()
        asig = lee("caudal_contrato_v1_asignacion.json")
        self.caudal.crudo = {"operaciones": asig["operaciones"], "posiciones": asig["posiciones"],
                             "saldos": {"schema": 1, "version": "s1", "cuentas": [], "saldos": []}}
        # En Rumbo: compraste 100 Apple y las vendiste con pérdida en diciembre (antes de «desde»).
        self.escribe_cartera({**almacen.CARTERA_VACIA, "productos": base.productos_contrato(), "movimientos": [
            {"id": "m1", "fecha": "2025-10-01", "producto": "apple", "tipo": "compra", "unidades": 100, "importe": 20000},
            {"id": "m2", "fecha": "2025-12-20", "producto": "apple", "tipo": "venta", "unidades": 100, "importe": 15000}]})

    def test_el_coste_es_el_valor_fiscal_que_manda_caudal(self):
        r = self.sincroniza()
        self.assertTrue(r["ok"], r)
        m = self.movs()
        self.assertEqual((m["c2"]["tipo"], m["c2"]["producto"], m["c2"]["unidades"], m["c2"]["importe"]),
                         ("compra", "apple", 100, 14000))   # DGT: valor de mercado, nunca el strike a secas
        self.assertEqual((m["c4"]["tipo"], m["c4"]["importe"]), ("venta", 16000))
        self.assertEqual(r["conciliacion"], [])             # 100 acciones en Rumbo y en Caudal
        # La venta de la call ejercida: coste 14.000 (el de la asignación) → ganancia de 2.000.
        inf = fiscal.informe(servidor.cartera(), 2026)
        venta = next(v for v in inf["ventas"] if v["fecha"] == "2026-02-20")
        self.assertAlmostEqual(venta["adquisicion"], 14000, places=2)
        self.assertAlmostEqual(venta["ganancia"], 2000, places=2)

    def test_sale_el_aviso_de_los_dos_meses(self):
        self.sincroniza()
        inf = fiscal.informe(servidor.cartera(), 2025)
        venta = next(v for v in inf["ventas"] if v["fecha"] == "2025-12-20")
        self.assertLess(venta["ganancia"], 0)
        # Te asignan Apple el 16/01/2026: es una compra dentro de los dos meses siguientes a la venta con pérdida.
        self.assertTrue(any("dos meses" in a for a in venta["avisos"]), venta["avisos"])


if __name__ == "__main__":
    import unittest
    unittest.main()
