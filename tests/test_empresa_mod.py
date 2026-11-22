# -*- coding: utf-8 -*-
"""[mod] Pruebas de empresa_mod.py: dividendos, splits y 52 semanas de acciones y ETF."""
import calendar
import datetime as dt
import json
import os
import unittest
import urllib.parse
from unittest import mock

from comun import ConCarpeta, cartera, mov
from app import empresa_mod, red, servidor

HOY = dt.date(2026, 11, 22)


def ts(iso):
    return calendar.timegm(dt.date.fromisoformat(iso).timetuple()) + 14 * 3600


def dividendos():
    """Trimestral desde 2015, subiendo cada año (importes ya ajustados por el split de 2020)."""
    out = []
    for y in range(2015, 2027):
        for mes in (2, 5, 8, 11):
            out.append((f"{y}-{mes:02d}-13", round(0.30 + 0.02 * (y - 2015), 4)))
    return out


def yahoo_largo(divs=None, splits=(("2020-08-03", 2, 1),), moneda="USD"):
    divs = dividendos() if divs is None else divs
    return {"chart": {"result": [{
        "meta": {"currency": moneda, "longName": "Empresa de prueba", "gmtoffset": 0,
                 "fiftyTwoWeekHigh": 70.0, "fiftyTwoWeekLow": 50.0},
        "events": {
            "dividends": {str(ts(f)): {"amount": a, "date": ts(f)} for f, a in divs},
            "splits": {str(ts(f)): {"date": ts(f), "numerator": n, "denominator": d, "splitRatio": f"{n}:{d}"}
                       for f, n, d in splits}},
        "timestamp": [], "indicators": {"quote": [{}]}}]}}


def yahoo_anual():
    fechas = [(HOY - dt.timedelta(days=i)).isoformat() for i in range(360, 0, -1)]
    cierres = [60 + 10 * ((i % 90) / 90) for i in range(len(fechas))]
    cierres[100] = 72.0   # máximo
    cierres[200] = 48.0   # mínimo
    cierres[-1] = 64.0
    return {"chart": {"result": [{
        "meta": {"currency": "USD", "gmtoffset": 0},
        "timestamp": [ts(f) for f in fechas],
        "indicators": {"quote": [{"close": cierres, "high": cierres, "low": cierres}]}}]}}


def guardado(largo=None):
    d = empresa_mod.lee_largo(largo or yahoo_largo())
    d.update(empresa_mod.lee_anual(yahoo_anual()))
    return {"consulta": "2026-11-22T10:00:00", "datos": d, "simbolo": "TEST"}


MOVS = [mov("2019-01-10", "a", "compra", 10, 500),
        mov("2020-08-04", "a", "ajuste", 20, 0),
        mov("2026-03-01", "a", "dividendo", 0, 7.5)]


class Calculos(unittest.TestCase):
    def test_lee_lo_de_yahoo(self):
        d = guardado()["datos"]
        self.assertEqual(d["moneda"], "USD")
        self.assertEqual(len(d["dividendos"]), 48)
        self.assertEqual(d["splits"], [("2020-08-03", 2.0, 1.0)])
        self.assertEqual((d["precio"], d["max52"], d["min52"]), (64.0, 72.0, 48.0))

    def test_rentabilidad_frecuencia_y_rachas(self):
        m = empresa_mod.metricas(guardado(), MOVS, HOY)
        self.assertAlmostEqual(m["dps12"], 4 * 0.52)
        self.assertAlmostEqual(m["rentabilidad"], 4 * 0.52 / 64)
        self.assertEqual((m["frecuencia"], m["frecuenciaTexto"]), (4, "Trimestral"))
        self.assertEqual(m["rachaPagando"], 11)       # de 2015 a 2025
        self.assertEqual(m["rachaSubiendo"], 10)
        self.assertAlmostEqual(m["crece5"], (2.0 / 1.6) ** (1 / 5) - 1, places=5)
        self.assertEqual(m["proximo"]["importe"], 0.52)
        self.assertTrue("2027-02-01" <= m["proximo"]["fecha"] <= "2027-02-28")

    def test_cada_dividendo_con_tus_titulos(self):
        m = empresa_mod.metricas(guardado(), MOVS, HOY)
        por_fecha = {f["fecha"]: f for f in m["dividendos"]}
        self.assertEqual(por_fecha["2018-11-13"]["titulos"], 0)            # antes de comprar
        f19 = por_fecha["2019-02-13"]
        self.assertEqual(f19["titulos"], 10)
        self.assertAlmostEqual(f19["importe"], 0.38 * 2)                   # lo que pagó antes del split
        self.assertAlmostEqual(f19["teToca"], 10 * 0.38 * 2)
        self.assertEqual(por_fecha["2021-02-13"]["titulos"], 20)            # después del ajuste
        self.assertEqual(por_fecha["2026-02-13"]["estado"], "anotado")
        self.assertEqual(por_fecha["2026-08-13"]["estado"], "sinAnotar")
        self.assertEqual(por_fecha["2026-11-13"]["estado"], "porCobrar")

    def test_split_anotado_o_no(self):
        m = empresa_mod.metricas(guardado(), MOVS, HOY)
        self.assertEqual(m["splits"][0]["texto"], "2 por 1")
        self.assertTrue(m["splits"][0]["despuesDeComprar"])
        self.assertTrue(m["splits"][0]["anotado"])
        sin_ajuste = [x for x in MOVS if x["tipo"] != "ajuste"]
        self.assertFalse(empresa_mod.metricas(guardado(), sin_ajuste, HOY)["splits"][0]["anotado"])

    def test_sin_dividendos(self):
        m = empresa_mod.metricas(guardado(yahoo_largo(divs=[], splits=())), MOVS, HOY)
        self.assertEqual(m["dividendos"], [])
        self.assertEqual(m["rentabilidad"], 0)
        self.assertIsNone(m["frecuencia"])
        self.assertIsNone(m["proximo"])

    def test_peniques(self):
        divs = [(f, a / 100) for f, a in dividendos()]   # Yahoo en libras con el precio en peniques
        m = empresa_mod.metricas(guardado(yahoo_largo(divs=divs, splits=(), moneda="GBp")), [], HOY)
        self.assertAlmostEqual(m["dps12"], 4 * 0.52)


def serie_yahoo(tipo, pares, moneda="USD"):
    return {"meta": {"symbol": ["TEST"], "type": [tipo]}, "timestamp": [1] * len(pares),
            tipo: [{"asOfDate": f, "periodType": "12M", "currencyCode": moneda, "reportedValue": {"raw": v}}
                   for f, v in pares]}


ANOS = ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"]
FUND_RESPUESTA = {"timeseries": {"result": [
    serie_yahoo("trailingPeRatio", [("2026-11-20", 17.7)], None),
    serie_yahoo("trailingPbRatio", [("2026-11-20", 8.6)], None),
    serie_yahoo("trailingMarketCap", [("2026-11-20", 1.9e11)]),
    serie_yahoo("annualTotalRevenue", list(zip(ANOS, [80e9, 85e9, 90e9, 93.925e9]))),
    serie_yahoo("annualNetIncome", list(zip(ANOS, [8.9e9, 9e9, 9.5e9, 8.24e9]))),
    serie_yahoo("annualStockholdersEquity", list(zip(ANOS, [17e9, 18e9, 18e9, 20.6e9]))),
    serie_yahoo("annualTotalDebt", list(zip(ANOS, [40e9, 44e9, 45e9, 49.44e9]))),
    serie_yahoo("annualDilutedEPS", list(zip(ANOS, [5.0, 5.5, 6.0, 6.0]))),
    serie_yahoo("annualCashDividendsPaid", list(zip(ANOS, [-6e9, -6.5e9, -7e9, -7.6e9]))),
    serie_yahoo("annualFreeCashFlow", list(zip(ANOS, [6e9, 7e9, 7e9, 7.6e9]))),
    serie_yahoo("annualOrdinarySharesNumber", list(zip(ANOS, [1.4e9, 1.39e9, 1.38e9, 1.372e9]))),
]}}
BUSCA_RESPUESTA = {"quotes": [{"symbol": "TEST", "sector": "Consumer Defensive",
                               "industry": "Beverages\u2014Non-Alcoholic", "quoteType": "EQUITY"}]}


class Cifras(unittest.TestCase):
    def guardado(self):
        d = {"series": empresa_mod.lee_fundamentales(FUND_RESPUESTA), "sector": "Consumer Defensive",
             "industria": "Beverages\u2014Non-Alcoholic"}
        return {"consulta": "2026-11-22T10:00:00", "datos": d}

    def test_ratios_y_cuentas(self):
        c = empresa_mod.cifras(self.guardado())
        self.assertEqual(c["per"], 17.7)
        self.assertEqual(c["pvc"], 8.6)
        self.assertEqual(c["capitalizacion"], 1.9e11)
        self.assertAlmostEqual(c["roe"], 8.24 / 20.6, places=5)
        self.assertAlmostEqual(c["margenNeto"], 8.24 / 93.925, places=5)
        self.assertAlmostEqual(c["deudaPatrimonio"], 49.44 / 20.6, places=5)
        self.assertAlmostEqual(c["payout"], 7.6 / 8.24, places=5)
        self.assertAlmostEqual(c["payoutCaja"], 1.0, places=5)
        self.assertAlmostEqual(c["creceVentas"], (93.925 / 80) ** (1 / 3) - 1, places=5)
        self.assertEqual(c["anosCrece"], 3)
        self.assertAlmostEqual(c["cambioAcciones"], 1.372 / 1.4 - 1, places=5)
        self.assertEqual(c["sector"], "Consumo básico")
        self.assertEqual(c["industria"], "Beverages - Non-Alcoholic")
        self.assertEqual(c["historia"][-1][0], "2025")
        self.assertEqual(c["ejercicio"], "2025-12-31")

    def test_con_perdidas_no_hay_per_ni_payout(self):
        g = self.guardado()
        g["datos"]["series"]["trailingPeRatio"] = [("2026-11-20", -3.0, None)]
        g["datos"]["series"]["annualNetIncome"] = [("2025-12-31", -1e9, "USD")]
        c = empresa_mod.cifras(g)
        self.assertNotIn("per", c)
        self.assertNotIn("payout", c)

    def test_sin_datos(self):
        self.assertIsNone(empresa_mod.cifras({"consulta": "x", "datos": {"series": {}}}))
        self.assertIsNone(empresa_mod.cifras(None))


class Ruta(ConCarpeta):
    def setUp(self):
        super().setUp()
        cfg = cartera([{"id": "a", "nombre": "Mi acción", "tipo": "accion", "fuente": "yahoo", "codigo": "TEST",
                        "identificador": "US1912161007", "moneda": "USD", "slot": 1},
                       {"id": "f", "nombre": "Mi fondo", "tipo": "fondo", "fuente": "morningstar",
                        "codigo": "0P0001CLDK", "slot": 2}], MOVS)
        with open(os.path.join(self.carpeta, "cartera.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f)

    def test_ruta_con_cache_y_solo_el_ticker(self):
        urls = []

        class Resp:
            def __init__(self, cuerpo):
                self.cuerpo = cuerpo

            def read(self):
                return json.dumps(self.cuerpo).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def falso(url, cabeceras=None, timeout=15):
            urls.append(url)
            partes = urllib.parse.urlsplit(url)
            self.assertIn(partes.hostname, red.PERMITIDOS)
            if "fundamentals-timeseries" in url:
                return Resp(FUND_RESPUESTA)
            if "/v1/finance/search" in url:
                return Resp(BUSCA_RESPUESTA)
            return Resp(yahoo_anual() if "range=1y" in url else yahoo_largo())

        with mock.patch.object(servidor, "DATOS", self.carpeta), mock.patch.object(red, "abrir", falso):
            web = servidor.app.test_client()
            j = web.get("/api/empresa-mod").get_json()
            self.assertTrue(j["ok"])
            self.assertEqual(list(j["productos"]), ["a"])       # el fondo no
            self.assertEqual(len(urls), 2)                       # los dividendos no esperan a las cifras
            c = web.get("/api/empresa-mod/cifras").get_json()
            self.assertEqual(list(c["productos"]), ["a"])
            self.assertEqual(c["productos"]["a"]["per"], 17.7)
            self.assertEqual(len(urls), 4)
            for u in urls:
                self.assertNotIn("500", u)
                self.assertNotIn("Mi", u)
            web.get("/api/empresa-mod")                          # la segunda vez, de la cache
            web.get("/api/empresa-mod/cifras")
            self.assertEqual(len(urls), 4)
            self.assertTrue(os.path.exists(os.path.join(self.carpeta, "cache", "EMPRESA_FUND_TEST.json")))
            self.assertTrue(os.path.exists(os.path.join(self.carpeta, "cache", "EMPRESA_TEST.json")))

    def test_sin_internet_no_falla(self):
        with mock.patch.object(servidor, "DATOS", self.carpeta):
            j = servidor.app.test_client().get("/api/empresa-mod").get_json()
            c = servidor.app.test_client().get("/api/empresa-mod/cifras").get_json()
        self.assertEqual(j, {"ok": True, "productos": {}})
        self.assertEqual(c, {"ok": True, "productos": {}})


if __name__ == "__main__":
    unittest.main()
