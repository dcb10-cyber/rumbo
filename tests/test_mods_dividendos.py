# -*- coding: utf-8 -*-
"""[mod] Pruebas de la pestaña «Ingr. Pasivos» y de las retenciones de los dividendos, sin internet."""
import json
import os
import re
import unittest
from unittest import mock

from comun import RAIZ, ConCarpeta, cartera, etf, manual, mov
from app import almacen, servidor
from app.mods import fiscal_dividendos, pestana_dividendos

PRODUCTOS = [etf("vym", codigo="VYM", moneda="USD", entidad="IBKR", corto="Vanguard High Div"),
             manual("cuenta", tipo="efectivo", entidad="Trade Republic")]
MOVS = [mov("2025-03-20", "vym", "compra", 10, 1000),
        mov("2025-06-25", "vym", "dividendo", 0, 8.4, comision=0.5, nota="Ret. 15 % EE. UU."),
        mov("2025-03-25", "vym", "dividendo", 10, "7.9"),
        mov("2025-07-01", "cuenta", "dividendo", 0, 12.3),
        mov("2025-07-02", "otro", "dividendo", 0, 99),        # producto que ya no existe
        mov("2025-08-01", "vym", "venta", 1, 110)]


class Cobros(unittest.TestCase):
    def test_solo_dividendos_ordenados(self):
        lista, info = pestana_dividendos.cobros(cartera(PRODUCTOS, MOVS))
        self.assertEqual([(c["fecha"], c["producto"], c["importe"]) for c in lista],
                         [("2025-03-25", "vym", 7.9), ("2025-06-25", "vym", 8.4), ("2025-07-01", "cuenta", 12.3)])
        self.assertEqual(lista[1]["comision"], 0.5)
        self.assertEqual(lista[1]["nota"], "Ret. 15 % EE. UU.")
        self.assertEqual(lista[0]["unidades"], 10)
        self.assertIsNone(lista[1]["unidades"])

    def test_datos_de_quien_paga(self):
        _, info = pestana_dividendos.cobros(cartera(PRODUCTOS, MOVS))
        self.assertEqual(set(info), {"vym", "cuenta"})
        self.assertEqual(info["vym"], {"nombre": "VYM", "corto": "Vanguard High Div", "tipo": "etf",
                                       "entidad": "IBKR", "moneda": "USD"})
        self.assertEqual(info["cuenta"]["tipo"], "efectivo")

    def test_cartera_vacia(self):
        self.assertEqual(pestana_dividendos.cobros({}), ([], {}))
        self.assertEqual(pestana_dividendos.cobros(None), ([], {}))


class Ruta(ConCarpeta):
    def test_ruta(self):
        with open(os.path.join(self.carpeta, "cartera.json"), "w", encoding="utf-8") as f:
            json.dump(cartera(PRODUCTOS, MOVS), f)
        with mock.patch.object(servidor, "DATOS", self.carpeta):
            j = servidor.app.test_client().get("/api/dividendos-mod").get_json()
        self.assertTrue(j["ok"])
        self.assertEqual(len(j["cobros"]), 3)
        self.assertIn("vym", j["productos"])


class Fiscal(unittest.TestCase):
    """Los campos fis_* del formulario se guardan en el movimiento como «fiscal», en euros."""

    def guarda(self, **datos):
        cfg = cartera(PRODUCTOS, [])
        base = {"producto": "vym", "tipo": "dividendo", "fecha": "2025-06-25", "importe": "68,85"}
        return almacen.guarda_movimiento(cfg, {**base, **datos}), cfg

    def test_guarda_en_el_movimiento(self):
        m, _ = self.guarda(fis_pais="us", fis_bruto="100", fis_origen="15", fis_espana="16,15", fis_convenio="15")
        self.assertEqual(m["importe"], 68.85)
        self.assertEqual(m["fiscal"], {"pais": "US", "bruto": 100.0, "origen": 15.0, "espana": 16.15, "convenio": 0.15})

    def test_sin_convenio(self):
        m, _ = self.guarda(fis_pais="DK", fis_bruto="100", fis_origen="27", fis_convenio="")
        self.assertIsNone(m["fiscal"]["convenio"])
        self.assertEqual(m["fiscal"]["espana"], 0.0)

    def test_sin_bruto_no_hay_fiscal(self):
        m, _ = self.guarda()
        self.assertNotIn("fiscal", m)
        m, _ = self.guarda(fis_bruto="")
        self.assertNotIn("fiscal", m)

    def test_al_editar_se_puede_quitar(self):
        m, cfg = self.guarda(fis_bruto="100", fis_origen="15")
        almacen.guarda_movimiento(cfg, {"id": m["id"], "producto": "vym", "tipo": "dividendo",
                                        "fecha": "2025-06-25", "importe": "85"})
        self.assertNotIn("fiscal", cfg["movimientos"][0])

    def test_solo_en_dividendos(self):
        cfg = cartera(PRODUCTOS, [])
        m = almacen.guarda_movimiento(cfg, {"producto": "vym", "tipo": "compra", "fecha": "2025-06-25",
                                            "unidades": "1", "importe": "100", "fis_bruto": "100"})
        self.assertNotIn("fiscal", m)

    def test_numeros_imposibles(self):
        with self.assertRaises(almacen.ErrorValidacion):
            self.guarda(fis_bruto="100", fis_origen="90", fis_espana="20")
        with self.assertRaises(almacen.ErrorValidacion):
            self.guarda(fis_bruto="100", fis_origen="-1")
        with self.assertRaises(almacen.ErrorValidacion):
            self.guarda(fis_bruto="abc")

    def test_en_dolares_se_pasa_a_euros_con_el_mismo_cambio(self):
        # El servidor pasa el importe a euros (0,9 €/$) antes de guardar: 81 $ → 72,90 €.
        datos = {"producto": "vym", "tipo": "dividendo", "fecha": "2025-06-25", "importe": "81", "moneda": "USD",
                 "fis_pais": "US", "fis_bruto": "100", "fis_origen": "15", "fis_espana": "4", "fis_convenio": "15",
                 "fis_neto": "81"}
        with mock.patch.object(servidor, "cambio_del_dia", lambda mon, f: 0.9):
            en_eur = servidor.movimiento_en_euros(datos)
        m = almacen.guarda_movimiento(cartera(PRODUCTOS, []), en_eur)
        self.assertEqual(m["importe"], 72.9)
        self.assertEqual(m["fiscal"]["bruto"], 90.0)
        self.assertEqual(m["fiscal"]["origen"], 13.5)
        self.assertEqual(m["fiscal"]["moneda"], "USD")

    def test_numeros_a_la_espanola(self):
        self.assertEqual(fiscal_dividendos._num("1.234,56"), 1234.56)
        self.assertEqual(fiscal_dividendos._num("1.000"), 1000.0)
        self.assertEqual(fiscal_dividendos._num("12.5"), 12.5)
        self.assertIsNone(fiscal_dividendos._num(""))

    def test_la_ruta_lo_devuelve(self):
        m, cfg = self.guarda(fis_bruto="100", fis_origen="15")
        lista, _ = pestana_dividendos.cobros(cfg)
        self.assertEqual(lista[0]["fiscal"]["origen"], 15.0)


class Navegador(unittest.TestCase):
    def test_se_carga_desde_mods_js(self):
        with open(os.path.join(RAIZ, "app", "web", "mods", "mods.js"), encoding="utf-8") as f:
            lista = re.search(r"const ARCHIVOS = \[(.*?)\];", f.read(), flags=re.S).group(1)
        self.assertIn('"pestana_dividendos.js"', lista)
        self.assertIn('"fiscal_dividendos.js"', lista)
        self.assertLess(lista.index("fiscal_dividendos.js"), lista.index("pestana_dividendos.js"))
        # La pestaña IRPF va detrás de «Ingr. Pasivos» (se coloca a su lado) y usa Mods.fiscal.
        self.assertLess(lista.index("pestana_dividendos.js"), lista.index("pestana_irpf.js"))

    def test_no_toca_index_ni_app(self):
        # La pestaña se crea desde el mod: los archivos del autor no la mencionan.
        for nombre in ("index.html", "app.js"):
            with open(os.path.join(RAIZ, "app", "web", nombre), encoding="utf-8") as f:
                texto = f.read()
            self.assertNotIn('data-tab="dividendos"', texto)
            self.assertNotIn('data-tab="irpf"', texto)


if __name__ == "__main__":
    unittest.main()
