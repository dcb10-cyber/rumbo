# -*- coding: utf-8 -*-
"""[mod] Pruebas de la ruta de la pestaña «IRPF» (app/mods/irpf.py), sin internet."""
import json
import os
import re
import unittest
from unittest import mock

from comun import RAIZ, ConCarpeta, cartera, etf, mov
from app import servidor
from app.mods import irpf

PRODUCTOS = [etf("a", codigo="AAA", moneda="USD"), etf("b", codigo="BBB")]
MOVS = [mov("2024-01-10", "a", "compra", 10, 1000), mov("2024-02-10", "b", "compra", 10, 500),
        mov("2025-03-10", "a", "venta", 5, 400),        # costó 500: pierde 100
        mov("2026-03-10", "b", "venta", 10, 800),       # costó 500: gana 300
        mov("2026-04-01", "b", "comision", 0, 12)]


class Ventas(unittest.TestCase):
    def test_todos_los_anos_con_el_calculo_del_autor(self):
        anos, por = irpf.ventas_por_ano(cartera(PRODUCTOS, MOVS))
        self.assertEqual(anos, ["2026", "2025"])
        self.assertEqual(por["2025"]["totales"]["saldo"], -100.0)
        self.assertEqual(por["2026"]["totales"]["saldo"], 300.0)
        self.assertEqual(por["2026"]["comisiones"][0]["importe"], 12.0)
        self.assertIn("Valor de transmisión", por["2026"]["csv"])


class Ruta(ConCarpeta):
    def test_ruta(self):
        with open(os.path.join(self.carpeta, "cartera.json"), "w", encoding="utf-8") as f:
            json.dump(cartera(PRODUCTOS, MOVS), f)
        with mock.patch.object(servidor, "DATOS", self.carpeta):
            j = servidor.app.test_client().get("/api/irpf-mod").get_json()
        self.assertTrue(j["ok"])
        self.assertEqual(len(j["porAno"]["2025"]["ventas"]), 1)


class Navegador(unittest.TestCase):
    def test_se_carga_y_oculta_para_la_renta(self):
        with open(os.path.join(RAIZ, "app", "web", "mods", "mods.js"), encoding="utf-8") as f:
            lista = re.search(r"const ARCHIVOS = \[(.*?)\];", f.read(), flags=re.S).group(1)
        self.assertIn('"pestana_irpf.js"', lista)
        with open(os.path.join(RAIZ, "app", "web", "mods", "pestana_irpf.js"), encoding="utf-8") as f:
            self.assertIn("#seccionFiscal{display:none", f.read())


if __name__ == "__main__":
    unittest.main()
