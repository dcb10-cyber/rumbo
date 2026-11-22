# -*- coding: utf-8 -*-
"""[mod] Pruebas de app/mods/empresa: dividendos, cifras y analistas de acciones y ETF (sin internet)."""
import calendar
import datetime as dt
import json
import os
import re
import subprocess
import unittest
import urllib.parse
from unittest import mock

from comun import ConCarpeta, cartera, mov
from app import red, servidor
from app.mods import cache
from app.mods.empresa import analistas, cifras, dividendos, yahoo

HOY = dt.date(2026, 11, 22)


def ts(iso):
    return calendar.timegm(dt.date.fromisoformat(iso).timetuple()) + 14 * 3600


def dividendos_prueba():
    """Trimestral desde 2015, subiendo cada año (importes ya ajustados por el split de 2020)."""
    out = []
    for y in range(2015, 2027):
        for mes in (2, 5, 8, 11):
            out.append((f"{y}-{mes:02d}-13", round(0.30 + 0.02 * (y - 2015), 4)))
    return out


def yahoo_largo(divs=None, splits=(("2020-08-03", 2, 1),), moneda="USD"):
    divs = dividendos_prueba() if divs is None else divs
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
    d = yahoo.lee_largo(largo or yahoo_largo())
    d.update(yahoo.lee_anual(yahoo_anual()))
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
        m = dividendos.metricas(guardado(), MOVS, HOY)
        self.assertAlmostEqual(m["dps12"], 4 * 0.52)
        self.assertAlmostEqual(m["rentabilidad"], 4 * 0.52 / 64)
        self.assertEqual((m["frecuencia"], m["frecuenciaTexto"]), (4, "Trimestral"))
        self.assertEqual(m["rachaPagando"], 11)       # de 2015 a 2025
        self.assertEqual(m["rachaSubiendo"], 10)
        self.assertAlmostEqual(m["crece5"], (2.0 / 1.6) ** (1 / 5) - 1, places=5)
        self.assertEqual(m["proximo"]["importe"], 0.52)
        self.assertTrue("2027-02-01" <= m["proximo"]["fecha"] <= "2027-02-28")

    def test_cada_dividendo_con_tus_titulos(self):
        m = dividendos.metricas(guardado(), MOVS, HOY)
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
        m = dividendos.metricas(guardado(), MOVS, HOY)
        self.assertEqual(m["splits"][0]["texto"], "2 por 1")
        self.assertTrue(m["splits"][0]["despuesDeComprar"])
        self.assertTrue(m["splits"][0]["anotado"])
        sin_ajuste = [x for x in MOVS if x["tipo"] != "ajuste"]
        self.assertFalse(dividendos.metricas(guardado(), sin_ajuste, HOY)["splits"][0]["anotado"])

    def test_sin_dividendos(self):
        m = dividendos.metricas(guardado(yahoo_largo(divs=[], splits=())), MOVS, HOY)
        self.assertEqual(m["dividendos"], [])
        self.assertEqual(m["rentabilidad"], 0)
        self.assertIsNone(m["frecuencia"])
        self.assertIsNone(m["proximo"])

    def test_peniques(self):
        divs = [(f, a / 100) for f, a in dividendos_prueba()]   # Yahoo en libras con el precio en peniques
        m = dividendos.metricas(guardado(yahoo_largo(divs=divs, splits=(), moneda="GBp")), [], HOY)
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
        d = {"series": yahoo.lee_fundamentales(FUND_RESPUESTA), "sector": "Consumer Defensive",
             "industria": "Beverages\u2014Non-Alcoholic"}
        return {"consulta": "2026-11-22T10:00:00", "datos": d}

    def test_ratios_y_cuentas(self):
        c = cifras.cifras(self.guardado())
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
        c = cifras.cifras(g)
        self.assertNotIn("per", c)
        self.assertNotIn("payout", c)

    def test_sin_datos(self):
        self.assertIsNone(cifras.cifras({"consulta": "x", "datos": {"series": {}}}))
        self.assertIsNone(cifras.cifras(None))


INS_RESPUESTA = {"finance": {"result": {
    "symbol": "PEP",
    "instrumentInfo": {
        "technicalEvents": {"shortTermOutlook": {"direction": "Bearish", "score": 2},
                            "intermediateTermOutlook": {"direction": "Bullish", "score": 3},
                            "longTermOutlook": {"direction": "Bearish", "score": 2}},
        "keyTechnicals": {"support": 140.3, "resistance": 143.69},
        "valuation": {"description": "Near Fair Value", "discount": "2%"}},
    "recommendation": {"provider": "Argus Research", "rating": "HOLD"},
    "upsell": {"msBullishSummary": ["Snacks and drinks together."], "msBearishSummary": ["Prices too high."]},
    "sigDevs": [{"headline": "Pepsico Declares Quarterly Dividend", "date": "2026-11-18"}]}}}


class Respuesta:
    """Lo que devuelve red.abrir: se lee como JSON."""

    def __init__(self, cuerpo):
        self.cuerpo = cuerpo

    def read(self):
        return json.dumps(self.cuerpo).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Analistas(unittest.TestCase):
    def test_perspectivas_traducidas(self):
        a = analistas.analistas({"consulta": "2026-11-22T10:00:00", "datos": INS_RESPUESTA["finance"]["result"]})
        self.assertEqual(a["valoracion"], "Cerca de su valor razonable")
        self.assertEqual(a["descuento"], "2%")
        self.assertEqual(a["argus"], "Mantener")
        self.assertEqual([x["direccion"] for x in a["tecnico"]], ["Bajista", "Alcista", "Bajista"])
        self.assertEqual((a["soporte"], a["resistencia"]), (140.3, 143.69))
        self.assertEqual(a["aFavor"], ["Snacks and drinks together."])
        self.assertEqual(a["noticias"][0], {"fecha": "2026-11-18", "titular": "Pepsico Declares Quarterly Dividend"})

    def test_sin_nada_no_sale(self):
        self.assertIsNone(analistas.analistas({"consulta": "x", "datos": {"symbol": "REP.MC", "sigDevs": []}}))
        self.assertIsNone(analistas.analistas(None))

    def test_linea_secundaria_mira_la_principal(self):
        urls = []

        def abrir(url, cabeceras=None, timeout=15):
            urls.append(url)
            if "/v1/finance/search" in url:
                return Respuesta({"quotes": [{"symbol": "NVD.DE", "quoteType": "EQUITY"},
                                                  {"symbol": "NVDA", "quoteType": "EQUITY"}]})
            if "symbol=NVD.DE" in url:
                return Respuesta({"finance": {"result": {"symbol": "NVD.DE"}}})
            if "symbol=NVDA" in url:
                return Respuesta(INS_RESPUESTA)
            raise AssertionError(url)

        with mock.patch.object(red, "abrir", abrir):
            r = yahoo.descarga_insights("NVD.DE", "US67066G1040")
        self.assertEqual(r["deSimbolo"], "NVDA")
        self.assertLessEqual({urllib.parse.urlsplit(u).hostname for u in urls}, set(red.PERMITIDOS))
        self.assertNotIn("fc.yahoo.com", red.PERMITIDOS)


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

        def falso(url, cabeceras=None, timeout=15):
            urls.append(url)
            partes = urllib.parse.urlsplit(url)
            self.assertIn(partes.hostname, red.PERMITIDOS)
            if "fundamentals-timeseries" in url:
                return Respuesta(FUND_RESPUESTA)
            if "/v1/finance/search" in url:
                return Respuesta(BUSCA_RESPUESTA)
            return Respuesta(yahoo_anual() if "range=1y" in url else yahoo_largo())

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

    def test_ruta_analistas(self):
        urls = []

        def abrir(url, cabeceras=None, timeout=15):
            urls.append(url)
            return Respuesta(INS_RESPUESTA)

        with mock.patch.object(servidor, "DATOS", self.carpeta), mock.patch.object(red, "abrir", abrir):
            j = servidor.app.test_client().get("/api/empresa-mod/analistas").get_json()
        self.assertEqual(j["productos"]["a"]["argus"], "Mantener")
        for u in urls:
            self.assertIn("symbol=TEST", u)
            self.assertNotIn("Mi", u)

    def test_sin_internet_no_falla(self):
        with mock.patch.object(servidor, "DATOS", self.carpeta):
            j = servidor.app.test_client().get("/api/empresa-mod").get_json()
            c = servidor.app.test_client().get("/api/empresa-mod/cifras").get_json()
            a = servidor.app.test_client().get("/api/empresa-mod/analistas").get_json()
        self.assertEqual(j, {"ok": True, "productos": {}})
        self.assertEqual(a, {"ok": True, "productos": {}})
        self.assertEqual(c, {"ok": True, "productos": {}})


class Cache(ConCarpeta):
    """mods/cache.py: lo guardado se usa mientras no caduque, y si internet falla también."""

    def obten(self, descarga, caducidad=dt.timedelta(hours=1)):
        return cache.obten(self.carpeta, "PRUEBA_", "AB.C", lambda g: caducidad, descarga)

    def guarda(self, horas_atras, datos):
        consulta = (dt.datetime.now() - dt.timedelta(hours=horas_atras)).replace(microsecond=0).isoformat()
        with open(cache.ruta(self.carpeta, "PRUEBA_", "AB.C"), "w", encoding="utf-8") as f:
            json.dump({"consulta": consulta, "datos": datos}, f)

    def test_nombre_del_archivo(self):
        self.assertTrue(cache.ruta(self.carpeta, "EMPRESA_", "REP.MC").endswith("EMPRESA_REP_MC.json"))

    def test_descarga_y_guarda(self):
        g = self.obten(lambda: {"x": 1})
        self.assertEqual(g["datos"], {"x": 1})
        self.assertTrue(os.path.exists(cache.ruta(self.carpeta, "PRUEBA_", "AB.C")))

    def test_reciente_no_descarga(self):
        self.guarda(0.5, {"x": "viejo"})
        self.assertEqual(self.obten(lambda: self.fail("no tenía que descargar"))["datos"], {"x": "viejo"})

    def test_caducado_descarga(self):
        self.guarda(2, {"x": "viejo"})
        self.assertEqual(self.obten(lambda: {"x": "nuevo"})["datos"], {"x": "nuevo"})

    def test_sin_internet_usa_lo_guardado(self):
        def falla():
            raise OSError("sin red")
        self.guarda(2, {"x": "viejo"})
        g = self.obten(falla)
        self.assertEqual(g["datos"], {"x": "viejo"})
        self.assertTrue(g["sinConexion"])

    def test_sin_internet_ni_nada_guardado(self):
        def falla():
            raise OSError("sin red")
        self.assertIsNone(self.obten(falla))

    def test_cifras_vacias_se_reintentan_antes(self):
        self.assertEqual(cifras._caducidad({"datos": {"series": {}}}), cifras.CADUCA_VACIO)
        self.assertEqual(cifras._caducidad({"datos": {"series": {"x": [1]}}}), cifras.CADUCA)


RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_MODS = os.path.join(RAIZ, "app", "web", "mods")


class Estructura(unittest.TestCase):
    """Que la parte del navegador esté bien enganchada y que el código del autor siga limpio."""

    def test_index_carga_el_nucleo(self):
        with open(os.path.join(RAIZ, "app", "web", "index.html"), encoding="utf-8") as f:
            self.assertIn('"mods/mods.js"', f.read())

    def test_los_scripts_de_mods_js_existen(self):
        with open(os.path.join(WEB_MODS, "mods.js"), encoding="utf-8") as f:
            lista = re.search(r"const ARCHIVOS = \[(.*?)\];", f.read(), flags=re.S).group(1)
        archivos = re.findall(r'"([^"]+\.js)"', lista)
        self.assertTrue(archivos)
        for a in archivos:
            with self.subTest(archivo=a):
                self.assertTrue(os.path.exists(os.path.join(WEB_MODS, a)))

    def test_sin_codigo_en_linea_ni_eval(self):
        # Con la política de seguridad de la página (CSP) un onclick="..." no funcionaría.
        for carpeta, _, archivos in os.walk(WEB_MODS):
            for nombre in archivos:
                with open(os.path.join(carpeta, nombre), encoding="utf-8") as f:
                    texto = f.read()
                with self.subTest(archivo=nombre):
                    self.assertIsNone(re.search(r"\son[a-z]+=[\"']", texto))
                    self.assertNotIn("javascript:", texto)
                    self.assertNotIn("eval(", texto)

    def test_lo_tocado_del_autor_lleva_mod(self):
        """Cada línea añadida en un archivo del autor tiene que llevar [mod] (para encontrarla
        si choca al traer una actualización). Necesita git y el remoto «upstream»."""
        mios = ("app/mods/", "app/web/mods/", "tests/test_mods_", "MIS_CAMBIOS.md")
        try:
            r = subprocess.run(["git", "diff", "-U0", "upstream/main", "--", "."], cwd=RAIZ,
                               capture_output=True, text=True, encoding="utf-8", timeout=30)
        except (OSError, subprocess.SubprocessError):
            self.skipTest("git no disponible")
        if r.returncode != 0:
            self.skipTest("sin el remoto upstream")
        archivo = None
        for linea in r.stdout.splitlines():
            if linea.startswith("+++ "):
                archivo = linea[6:] if linea.startswith("+++ b/") else None
            elif linea.startswith("+") and archivo and not archivo.startswith(mios) and linea[1:].strip():
                with self.subTest(archivo=archivo, linea=linea[:80]):
                    self.assertIn("[mod]", linea)


if __name__ == "__main__":
    unittest.main()
