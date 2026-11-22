# Mis cambios en Rumbo

## Versión base
Fork de https://github.com/danidm98/rumbo, copiado el 22/11/2026.

## Cómo está organizado
Todo lo mío vive en carpetas propias. El código del autor solo tiene unas pocas líneas
marcadas con `[mod]` que enganchan esas carpetas (lista completa más abajo).

```
app/mods/                      ← lo mío, parte del servidor (Python)
  __init__.py                    engancha todos los mods al servidor (lista MODS)
  cache.py                       guarda en mis_datos/cache lo que se baja de internet
  pestana_dividendos.py          pestaña «Dividendos»: todos los cobros  →  /api/dividendos-mod
  empresa/                       datos de empresas de Yahoo para acciones y ETF
    yahoo.py                       qué se pide a Yahoo y cómo se lee
    comun.py                       a qué productos se aplica y cómo se recorre la cartera
    dividendos.py                  nivel 1  →  /api/empresa-mod
    cifras.py                      nivel 2  →  /api/empresa-mod/cifras
    analistas.py                   nivel 3  →  /api/empresa-mod/analistas
app/web/mods/                  ← lo mío, parte del navegador (JavaScript)
  mods.js                        núcleo: carga los demás y reparte las llamadas de app.js
  empresa/
    comun.js                       estilos (clases emod…) y formatos comunes
    dividendos.js / cifras.js / analistas.js   un archivo por apartado
  filtro_esfuerzo.js             filtro de años en «Tu esfuerzo y el del mercado» (pestaña Mes)
  pestana_dividendos.js          pestaña «Dividendos» (crea su botón y su panel)
tests/test_mods_empresa.py     ← mis pruebas (sin internet)
tests/test_mods_dividendos.py
```

**Para añadir un mod nuevo** (por ejemplo, el control de gastos), sin tocar nada del autor:
- Servidor: crea `app/mods/gastos.py` (o una carpeta) con `registra(app, cartera, carpeta_cache)`
  y añádelo a la lista `MODS` de `app/mods/__init__.py`.
- Navegador: crea `app/web/mods/gastos.js` que llame a `Mods.registra({ ficha, resumen })` y
  añádelo a la lista `ARCHIVOS` de `app/web/mods/mods.js`.
- Pruebas: `tests/test_mods_gastos.py`.

## Líneas tocadas en archivos del autor (todas con `[mod]`)
Si al traer una actualización del autor sale un conflicto, busca `[mod]` en ese archivo: casi
siempre basta con quedarse con las dos partes (lo del autor y la línea `[mod]`).

| Archivo | Qué | Para |
|---|---|---|
| `app/servidor.py` | 3 líneas antes de `/api/ping`: `mods.registra(...)` | todas las rutas de mis mods |
| `app/web/app.js` | 2 líneas al final de `pintaFondos()`: `Mods.ficha(...)` | apartados en la pestaña del producto |
| `app/web/app.js` | 2 líneas después de `pintaDividendos()`: `Mods.resumen(...)` | apartados en «Rendimiento» |
| `app/web/app.js` | 2 líneas al final de `pintaMes()`: `Mods.mes(...)` | filtro de años del gráfico de la pestaña «Mes» |
| `app/web/app.js` | 1 línea antes de `const estado`: `D.vivo = null` | quita el precio en vivo (pastilla «Bitcoin en vivo») |
| `app/web/index.html` | `"mods/mods.js"` en la lista de scripts del cargador | carga la parte del navegador |
| `app/web/index.html` | `--s13` en los dos temas | color negro |
| `app/web/index.html` | `.prog{…}`: quitado `max-width:760px` | barra de progreso a todo el ancho |
| `app/web/index.html` | `.hito{…}`: `flex:1 1 0` en vez de `flex:none` | hitos repartidos por todo el ancho |
| `app/motor.py` | color 13 en `PALETA` | color negro |
| `app/web/editor.js` | 2 líneas: 13 colores en el selector | color negro |

La prueba `test_lo_tocado_del_autor_lleva_mod` comprueba que toda línea añadida en un archivo
del autor lleva `[mod]` (necesita git y el remoto «upstream»; si no, se salta).

## Hecho
- **22/11/2026 · Color negro en la paleta de productos** (color nº 13).
  - En modo oscuro el «negro» se ve casi blanco; si no, no se distinguiría del fondo.
  - El botón «Repartir colores» y el color automático de los productos nuevos siguen usando
    solo los 12 originales: el negro solo se pone a mano.

- **22/11/2026 · Nivel 1: dividendos, splits y 52 semanas de acciones y ETF** (`dividendos.py/.js`).
  - De Yahoo, solo con el ticker y por `red.py` (sin sitios nuevos): historial de dividendos,
    splits y el último año de precios. Caché `EMPRESA_*.json`, 12 horas.
  - Calcula rentabilidad por dividendo, crecimiento (1, 5 y 10 años), rachas, próximo pago
    estimado, lo que te tocaba en cada pago con tus títulos y si lo tienes anotado.
  - Dónde se ve: **Productos** → «Dividendos y precio» (rango de 52 semanas, cifras, gráfico por
    año, tus dividendos uno a uno, avisos de dividendos sin anotar y de splits sin «Ajuste de
    participaciones»). **Rendimiento** → «Lo que pagan tus acciones y ETF» (un año, calendario de
    12 meses y tabla).

- **22/11/2026 · Nivel 2: la empresa en cifras** (`cifras.py/.js`).
  - Morningstar rechaza estas consultas (401), así que sale de Yahoo (`query2.finance.yahoo.com`,
    ya permitido en `red.py`): ratios del día (PER, PER estimado, PEG, P/VC, P/ventas, EV/EBITDA,
    capitalización), sector e industria y cuentas de los últimos 4 años, de las que salen ROE,
    ROA, márgenes, deuda, liquidez, crecimiento, recompras y payout. Comprobado con acciones de
    EE. UU., España y Alemania (.F y .DE). Ojo: puede que por lo del 401 tampoco funcione el «Qué
    hay dentro» del autor para acciones; no lo he tocado.
  - Caché `EMPRESA_FUND_*.json`, 3 días (si viene vacío, reintenta a las 6 h). Solo acciones.
  - Dónde se ve: **Productos** → «La empresa en cifras» (con «¿Qué significa cada dato?» y gráfico
    de beneficio y caja libre). **Rendimiento** → «Tus acciones en cifras» (tabla ordenable, con
    la media ponderada por lo que tienes).

- **22/11/2026 · Nivel 3: analistas (Yahoo «insights», sin cookie)** (`analistas.py/.js`).
  - Valoración y técnico a corto, medio y largo plazo (Trading Central), soporte y resistencia,
    opinión de Argus, argumentos a favor y en contra (Morningstar, en inglés) y hechos relevantes.
    Muy completo en acciones de EE. UU.; en las europeas trae poco. Las líneas .F/.DE se miran en
    su cotización principal (por el ISIN). Caché `EMPRESA_INS_*.json`, 20 horas.
  - Dónde se ve: **Productos** → «Analistas». **Rendimiento** → «Analistas de tus acciones».
  - Descartado: la ficha completa de Yahoo (precio objetivo, recomendaciones, calendario). Pide
    una cookie que en Europa solo se da aceptando su aviso de cookies, y en este PC
    `fc.yahoo.com` no conecta. Se quitó todo su código.

- **22/11/2026 · Reorganización del código** (sin cambiar nada de lo que se ve).
  - `app/empresa_mod.py` (640 líneas) → paquete `app/mods/empresa/` con un archivo por nivel.
    Las tres cachés, que eran casi iguales, son ahora una sola (`app/mods/cache.py`). Quitado lo
    que no se usaba (el parámetro `red_ok`, restos de la prueba con cookies en las pruebas).
  - `app/web/empresa_mod.js` (700 líneas) → `app/web/mods/` con un archivo por apartado; las
    peticiones al servidor y las tablas ordenables, que estaban repetidas, son ahora comunes.
  - Los enganches de `servidor.py` y `app.js` ya no dicen «empresa», sino «mods»: sirven para
    cualquier mod futuro sin volver a tocar los archivos del autor.
  - Si un apartado falla, ya no puede romper el resto del panel (antes, un error en «Rendimiento»
    podía dejar sin pintar lo que va debajo, como «Para la Renta»).
  - Comprobado: todas las pruebas (las del autor y las mías) pasan, y el panel se ve **idéntico** (mismo
    HTML en 46 pantallas probadas en Chrome, con datos inventados), igual que las respuestas del
    servidor, lo que se pide a Yahoo y los archivos de caché.

- **22/11/2026 · Barra de progreso del patrimonio a todo el ancho.**
  - Antes la barra de «% del camino hacia la meta» se paraba a los 760 px; ahora ocupa el mismo
    ancho que las tarjetas de debajo (una sola línea de CSS en `index.html`, marcada con `[mod]`).

- **22/11/2026 · Hitos repartidos por todo el ancho de su tarjeta.**
  - Las casillas de «Hitos» tenían un ancho fijo y dejaban un hueco a la derecha. Ahora se reparten
    el ancho a partes iguales, sean 5, 7 o los que haya; en pantallas estrechas, si no caben
    (mínimo 132 px cada una), la fila sigue pudiendo desplazarse de lado. Una línea de CSS con `[mod]`.

- **22/11/2026 · Filtro de años en «Tu esfuerzo y el del mercado, mes a mes»** (`filtro_esfuerzo.js`).
  - Arriba a la derecha de la tarjeta (pestaña **Mes**) hay un selector: «Últimos 18 meses» (lo de
    siempre, por defecto), «Últimos 12 meses» y un botón por cada año con datos (2025, 2026…).
    Al elegir un año se ven solo los meses de ese año (el actual, hasta el último mes). Sin
    «Últimos 18 meses» si hay 12 meses de datos o menos.
  - Es el mismo gráfico del autor con los mismos colores; solo cambian los meses. La elección se
    mantiene al cambiar de mes en la pestaña, pero vuelve a «Últimos 18 meses» al recargar la página.
  - Nuevo gancho en mi núcleo: `Mods.registra({ mes(meses) {…} })` (como `ficha` y `resumen`).

- **22/11/2026 · «La empresa en cifras» reorganizada** (`cifras.js` y estilos en `comun.js`).
  - Antes: filas de casillas de distinto ancho, con huecos, y un gráfico de barras finas a todo el ancho.
  - Ahora: «La empresa» (sector, industria, capitalización, cuentas) arriba a todo el ancho; debajo,
    una tarjeta por tema («¿Cara o barata?», «El negocio», «Deuda y solidez», «Crecimiento y
    accionista») con casillas del mismo tamaño y el valor siempre abajo, y el gráfico de beneficio y
    caja libre en una tarjeta al lado, de la altura de las dos tarjetas de la izquierda.
  - En pantallas estrechas (menos de unos 860 px) todo pasa a una sola columna. Se ve igual en modo
    claro y oscuro. Los textos, los datos y los avisos «¿Qué significa cada dato?» no han cambiado.
  - Solo toca archivos míos (nada del autor): clases nuevas `emodCifras`, `emodGrupo`, `emodTile`…

- **22/11/2026 · Quitado el indicador «Bitcoin en vivo».**
  - Era el precio en vivo de **una sola cripto** (la primera de CoinGecko que hubiera en la cartera,
    en tu caso The Graph, aunque la etiqueta decía «Bitcoin»). Cada minuto movía su valor y, con él,
    el patrimonio total.
  - Ahora el panel usa siempre el último cierre y el navegador ya no consulta a CoinGecko ni a
    Binance. Una sola línea con `[mod]` en `app.js` (`D.vivo = null`). Para volver a activarlo, basta
    con borrar esa línea.
  - Con esto también desaparece la pastilla «Cotización a cierre del …» que salía cuando el
    precio en vivo no llegaba, y en la ficha del producto, «Valor al cierre» vuelve a ser «Valor hoy».

- **22/11/2026 · Pestaña «Dividendos»** (`pestana_dividendos.py/.js`).
  - Nueva pestaña entre «Rendimiento» y «Mis datos». **No toca ningún archivo del autor**: el
    botón y el panel los crea el propio mod y se comportan como los demás (recuerda la pestaña
    al recargar, `?tab=dividendos`, tema, moneda, modo vídeo, recarga si hay cambios en Mis datos).
  - Filtros arriba: **qué cuento** (Dividendos / Intereses / Cupones / Alquileres / Todo junto,
    según el tipo del producto: cuentas y P2P = intereses, bonos = cupones, inmuebles = alquileres)
    y **periodo** (Todo o un año).
  - Cifras: total, este año hasta hoy frente al año pasado a estas alturas, últimos 12 meses frente a
    los 12 anteriores, media al mes, rentabilidad sobre lo que vale y sobre lo que pusiste (YOC),
    cuántos productos te pagan.
  - Tarjetas: «Año a año» (gráfico + tabla año × mes coloreada, como «Div. Anuales» del Excel),
    «Tu renta de los últimos 12 meses» (línea móvil: ¿crece la renta pasiva?), «año frente al
    anterior, mes a mes», «Quién te paga» (ranking ordenable con % del total, frecuencia de pago,
    YOC; concentración; donuts por producto, broker y divisa) y «Todos los cobros» (con comisión,
    importe por título si anotaste títulos, y nota).
  - Los cobros con fecha futura salen como «previsto» en la lista y no cuentan en las cifras.
  - Los datos vienen de la ruta nueva `/api/dividendos-mod` (solo lee tu cartera, no baja nada de
    internet). El resumen del autor en «Rendimiento» sigue igual.

## Pendiente (ideas)
- Dividendos, fase 2: retención en origen, doble imposición recuperable y exceso reclamable por país
  (hoy Rumbo solo guarda importe y comisión; habría que anotarlo aparte). Previsión de cobros de los
  próximos 12 meses usando el calendario de Yahoo que ya baja el nivel 1.
- Más cambios visuales: colores y textos.
- Control de gastos (pensar antes de programar). Iría como mod nuevo (ver «Para añadir un mod nuevo»).

## Notas
- mis_datos/ no se toca ni se sube a GitHub.
- En `mis_datos/cache/` sobran los `EMPRESA_MS_*.json` (intento con Morningstar) y los
  `EMPRESA_QS_*.json` (intento con la ficha completa de Yahoo): ya no se usan y se pueden borrar.
- Después de cambiar archivos de la app (o de traer una actualización del autor), cerrar la
  ventana negra de Rumbo y volver a abrir Iniciar.bat. Si queda un Rumbo viejo abierto, el
  panel sale vacío (la huella de seguridad de index.html no coincide).
- Pruebas: doble clic en `tests\ejecutar_tests.bat`.
