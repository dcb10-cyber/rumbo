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
  pestana_dividendos.py          pestaña «Ingr. Pasivos»: todos los cobros  →  /api/dividendos-mod
  fiscal_dividendos.py           guarda las retenciones de cada dividendo (campo «fiscal»)
  irpf.py                        pestaña «IRPF»: ventas de todos los años  →  /api/irpf-mod
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
  filtro_componentes.js          filtro por tipo y orden en «Componentes de la cartera» (pestaña Patrimonio)
  fiscal_dividendos.js           retenciones en el formulario de «Dividendo» + tabla de países y cuentas
  pestana_dividendos.js          pestaña «Ingr. Pasivos» (crea su botón y su panel)
  pestana_irpf.js                pestaña «IRPF»: retenciones e impuestos
tests/test_mods_empresa.py     ← mis pruebas (sin internet)
tests/test_mods_dividendos.py
tests/test_mods_irpf.py
```

**Para añadir una pestaña nueva**: `Mods.util.pestana({ id, texto, despuesDe, pinta(panel) })` (en
`mods.js`) crea el botón y el panel y se encarga de recordarla, del tema, la moneda, etc.

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
| `app/web/app.js` | 2 líneas al final de `pintaChips()`: `Mods.componentes(...)` | filtro y orden de «Componentes de la cartera» |
| `app/web/graficos.js` | 3 líneas en `donut()` | anillo con un solo elemento y importe centrado |
| `app/web/index.html` | `"mods/mods.js"` en la lista de scripts del cargador | carga la parte del navegador |
| `app/web/index.html` | `--s13` en los dos temas | color negro |
| `app/web/index.html` | `.prog{…}`: quitado `max-width:760px` | barra de progreso a todo el ancho |
| `app/web/index.html` | `.hito{…}`: `flex:1 1 0` en vez de `flex:none` | hitos repartidos por todo el ancho |
| `app/motor.py` | color 13 en `PALETA` | color negro |
| `app/almacen.py` | 2 líneas en `guarda_movimiento()`: `fiscal_de(...)` | guardar las retenciones del dividendo |
| (ninguna) | «Para la Renta» de Rendimiento se oculta con CSS desde `pestana_irpf.js` (`#seccionFiscal`) | ahora está en IRPF |
| `app/web/editor.js` | 1 línea tras `rellena(...)` en `formMovimiento()`: `Mods.formMovimiento(...)` | campos de retenciones en el formulario |
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

- **22/11/2026 · «Dividendos» pasa a llamarse «Ingr. Pasivos»** (también cuenta intereses, cupones y alquileres).

- **22/11/2026 · Retenciones de cada dividendo** (`fiscal_dividendos.py/.js`).
  - En Mis datos → Movimientos → Dividendo hay un bloque nuevo «Retenciones e impuestos» (casilla
    «Anotar el bruto y las retenciones»): país, dividendo bruto, retenido en origen, retenido en España,
    máximo del convenio y si el bróker retiene en España.
  - Se rellena solo: el país sale del ISIN (o del sufijo del ticker; Yahoo sin sufijo = EE. UU.), la
    retención en origen de una tabla de ~30 países (EE. UU. 15 %, Alemania 26,375 %, Suiza 35 %,
    Dinamarca 27 % sin convenio…), la española es el 19 % de lo que llega si el bróker es español
    (MyInvestor, CaixaBank, ING…) y el «Importe total» del autor = bruto − retenciones. Todo editable.
    Lo que elijas en «¿Tu bróker retiene en España?» se recuerda para ese bróker. Para el siguiente
    dividendo del mismo producto se usan el país y el convenio del anterior.
  - Debajo, las cuentas: lo que deduces en la Renta, lo reclamable en origen, lo que se pierde (países
    sin convenio), lo que te falta pagar (o te devuelven) al 19 % y lo que te queda limpio. Avisa si
    bruto − retenciones no cuadra con el importe.
  - Se guarda en el movimiento como `"fiscal": {pais, bruto, origen, espana, convenio, moneda?, fx?}`,
    todo en euros (si escribes en dólares, con el mismo cambio que el importe). Desmarcar la casilla y
    guardar lo quita. Si algún día quito el mod, el autor ignora ese campo (pero lo borra al editar ese
    movimiento con su formulario).
  - Regla usada: en la Renta se deduce lo menor entre lo retenido fuera (como mucho, el % del
    convenio) y lo que pagarías en España por ese cobro; lo retenido por encima del convenio se
    reclama al otro país; sin convenio (Dinamarca desde 2009) no hay nada que reclamar y lo que pase
    de lo que pagarías en España se pierde.
  - En **Ingr. Pasivos**, tarjeta nueva **«Hacienda {año}»**: bruto, retenido en origen, deducible,
    reclamable, lo que se pierde, retenido en España, impuesto con la escala del ahorro (19-30 %) solo
    sobre estos cobros y lo que falta por pagar o te devuelven; tabla por país. Los cobros sin datos
    fiscales se cuentan aparte y se avisa. En «Todos los cobros», columnas Bruto, Ret. origen y Ret. España.

- **22/11/2026 · Pestaña «IRPF»** (`pestana_irpf.js`), entre «Ingr. Pasivos» y «Mis datos».
  - Todo lo fiscal sale de «Ingr. Pasivos» (allí ya no hay tarjeta Hacienda ni columnas de retenciones)
    y va aquí, por año de la Renta: resumen (bruto, retenido en origen, deducible, reclamable, lo que se
    pierde, retenido en España, impuesto con la escala del ahorro, lo que falta pagar o te devuelven),
    tabla por país con cómo reclamar lo retenido de más, cobro a cobro, los cobros sin retenciones
    anotadas (para completarlos) y año a año. Los alquileres no entran (van a la base general).
  - Los datos se siguen apuntando en el formulario de «Dividendo» (bloque «Retenciones e impuestos»).
  - Código común nuevo en `mods.js`: `Mods.util.pestana(...)` (crear pestañas) y `Mods.util.cobros`
    (los cobros de `/api/dividendos-mod`, pedidos una sola vez para las dos pestañas).

- **22/11/2026 · Arreglos.**
  - «Ingr. Pasivos»: los filtros «Qué cuento» y «Periodo» no hacían nada desde la reorganización de las
    pestañas (llamaban a `pinta()` sin el panel). Ya funcionan.
  - Formulario de Dividendo: la casilla «Anotar el bruto y las retenciones» sale siempre marcada (también al
    editar uno antiguo). El «Importe total» se recalcula (bruto − retenciones) cada vez que cambias algo del
    bloque de retenciones, también al editar; si lo escribes a mano, se queda tu cifra hasta que vuelvas a
    tocar el bruto o las retenciones.

- **22/11/2026 · Retenciones visibles en Mis datos → Movimientos** (`fiscal_dividendos.js`).
  - Debajo del tipo de cada dividendo o interés sale una etiqueta: en verde lo anotado («✓ bruto 2,29 € ·
    Estados Unidos · origen 0,34 €», y lo retenido en España si hay) o «sin retenciones» en naranja. Al pie,
    «X de Y dividendos o intereses con retenciones anotadas (faltan Z)», según el filtro de producto.
  - No toca editor.js: el mod completa la tabla del autor cuando aparece (MutationObserver) con los datos de
    `/api/dividendos-mod`, que ahora también devuelve el `id` de cada movimiento.

- **22/11/2026 · IRPF completo: ventas, compensación de pérdidas y liquidación** (`irpf.py`, `pestana_irpf.js`).
  - Las ventas (ganancias y pérdidas) salen del mismo cálculo que «Para la Renta» del autor (`fiscal.informe`:
    FIFO, traspasos, avisos de la regla de los dos meses), de todos los años a la vez (`/api/irpf-mod`).
  - «Para la Renta» ya no se ve en **Rendimiento** (CSS desde el mod, sin tocar app.js); todo está en **IRPF**:
    tabla de ventas, comisiones de custodia, rescates de planes y el CSV para Excel.
  - Nueva tarjeta «Cómo sale tu base del ahorro»: dividendos/intereses brutos − gastos de custodia,
    ganancias y pérdidas por ventas, compensación entre ellas (máx. 25 %), pérdidas de los 4 años anteriores
    (las más antiguas primero), base, impuesto con la escala del ahorro, deducción por doble imposición (sin
    pasar del impuesto), retenciones y resultado. Debajo, lo pendiente de compensar y hasta qué año.
  - El resumen de arriba y «Año a año» ya incluyen las ventas. Los dividendos sin el bruto anotado siguen
    fuera (se avisa). No incluye: retenciones de fondos españoles al vender, otras ganancias, alquileres,
    rescates de planes.
  - La Ayuda del autor todavía dice «Rendimiento → Para la Renta»: no la he tocado.

- **22/11/2026 · Retención de los intereses** (`fiscal_dividendos.js`, `pestana_irpf.js`).
  - En una cuenta remunerada o P2P, el bloque «Retenciones e impuestos» del formulario es más sencillo: Intereses
    brutos, ¿Te retienen? (Sí, el 19 % / No) y Retenido. El importe (lo recibido) se calcula solo y se puede cambiar.
    Cuentas: lo que te retienen, lo que te falta pagar en la Renta y lo que te queda limpio. Se guarda igual que un
    dividendo (`fiscal` con país ES, sin origen ni convenio).
  - «¿Te retienen?» se recuerda por banco, aparte de lo que elijas para los dividendos de ese mismo bróker (clave
    `int:<entidad>`); si ya hay intereses anotados de esa cuenta, se usa lo del último.
  - Etiquetas en Movimientos: «✓ bruto 30,00 € · retenido 5,70 €», «✓ … · sin retención» o «sin retención» en naranja.
  - En IRPF, los intereses salen en su propia fila («Intereses (cuentas y P2P)»), no mezclados con España.
  - Arreglo: «Ingr. Pasivos» e IRPF usaban como «hoy» la fecha de los últimos precios: un cobro anotado hoy sin
    actualizar precios salía como «previsto» y no contaba. Ahora usan la fecha real (`Mods.util.hoy()`).

- **22/11/2026 · «Mes a mes» en Ingr. Pasivos.**
  - Con un año elegido sale solo ese año (antes salía comparado con el anterior). Al pasar el ratón por un mes, la
    viñeta da el total y lo que pagó cada producto ese mes (de más a menos, ×2 si pagó dos veces, máx. 12 + «N más»).
    El gráfico es el del autor (`G.barrasAgrupadas`), que no deja cambiar la viñeta: el mod escucha el ratón en la
    misma zona después que él y reescribe el contenido y la posición (`vinetaPorProducto`).
  - Con «Todo» salen todos los años, uno al lado del otro, con la viñeta del autor como antes.

- **22/11/2026 · «vs año ant.» del año en curso** (tabla «Año a año» de Ingr. Pasivos): ya no sale «—» hasta que
  acabe el año. Compara lo que llevas cobrado este año con el TOTAL acumulado del año anterior entero (empieza en
  -100 % y va subiendo según cobras; pasa a positivo cuando superas lo del año pasado) y lleva «del total 2025» al lado.
  Los años cerrados siguen comparando año completo con año completo. Pasando el ratón se ven las dos cifras.

- **23/11/2026 · Filtro por tipo y orden en «Componentes de la cartera»** (`filtro_componentes.js`).
  - Arriba a la derecha de ese apartado (pestaña **Patrimonio**): botones «Todos / Acciones / ETF /
    Fondos / Cripto / Efectivo…» (solo salen los tipos que tienes, cada uno con cuántos son) y un
    desplegable para ordenar: orden original (por defecto), valor, rentabilidad %, ganancia en € (de
    mayor a menor o al revés) y nombre A-Z. Los que no tienen el dato (por ejemplo, sin aportaciones
    como «Trade Republic») van siempre al final. Si filtras, sale «6 de 20».
  - Solo esconde y reordena las tarjetas: no cambia los gráficos ni los totales (eso lo siguen
    decidiendo «Ver todo» / «Solo largo plazo»). La elección se mantiene al cambiar de pestaña,
    pero se pierde al recargar la página.
  - Nuevo gancho en mi núcleo: `Mods.registra({ componentes(lista) {…} })`.
  - Multiselección: se pueden marcar varios tipos a la vez (por ejemplo, Acciones y Cripto). Pulsar un
    tipo marcado lo desmarca; «Todos» quita todas las marcas. «6 de 20» cuenta lo de todos los marcados.
  - Los botones del filtro llevan ahora 4 px de separación, para que dos marcados seguidos no se
    vean pegados (mismo estilo de siempre).
  - Retoque: el tipo «Préstamos P2P / crowdfunding» sale en el filtro como «Crowdfunding», y se
    esconde el texto «Pulsa uno para abrir su ficha completa» del título (lo hace el propio mod,
    sin tocar nada del autor).

- **23/11/2026 · Gráficos de anillo: un solo elemento e importe centrado** (`graficos.js`, 3 líneas `[mod]`).
  - Con un solo elemento (por ejemplo «Por divisa del producto», con todo en EUR) el anillo salía
    vacío: una vuelta entera es un arco que empieza y acaba en el mismo punto y el navegador no lo
    dibuja. Ahora se dibuja completo. Pasaba igual en «Distribución» de Patrimonio.
  - Cuando el anillo no lleva título (los tres de «Ingr. Pasivos»), el importe del centro quedaba
    unos 20 px por debajo; ahora está justo en el centro. Los de Patrimonio, que llevan título
    («Total») encima del importe, se quedan como estaban.

## Pendiente (ideas)
- Completar el bruto y las retenciones de los dividendos antiguos (o importarlos de BD_DIV del Excel).
- Previsión de cobros de los próximos 12 meses usando el calendario de Yahoo que ya baja el nivel 1.
- Checklist de lo reclamable por país (formulario, plazo, si ya lo pediste).
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
