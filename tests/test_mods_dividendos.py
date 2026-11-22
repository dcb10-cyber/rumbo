# -*- coding: utf-8 -*-
"""[mod] Pruebas de la pestaña «Dividendos» (app/mods/pestana_dividendos.py), sin internet."""
import json
import os
import re
import unittest
from unittest import mock

from comun import RAIZ, ConCarpeta, cartera, etf, manual, mov
from app import servidor
from app.mods import pestana_dividendos

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


class Navegador(unittest.TestCase):
    def test_se_carga_desde_mods_js(self):
        with open(os.path.join(RAIZ, "app", "web", "mods", "mods.js"), encoding="utf-8") as f:
            lista = re.search(r"const ARCHIVOS = \[(.*?)\];", f.read(), flags=re.S).group(1)
        self.assertIn('"pestana_dividendos.js"', lista)

    def test_no_toca_index_ni_app(self):
        # La pestaña se crea desde el mod: los archivos del autor no la mencionan.
        for nombre in ("index.html", "app.js"):
            with open(os.path.join(RAIZ, "app", "web", nombre), encoding="utf-8") as f:
                self.assertNotIn('data-tab="dividendos"', f.read())


if __name__ == "__main__":
    unittest.main()
