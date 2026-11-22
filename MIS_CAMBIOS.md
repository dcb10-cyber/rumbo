# Mis cambios en Rumbo

## Versión base
Fork de danidm98/rumbo, copiado el 22/11/2026.

## Cómo marco los cambios
En el código, cada línea tocada lleva un comentario `[mod]`. Si al traer
una actualización del autor sale un conflicto, busca `[mod]` en ese archivo
para ver qué era mío.

## Hecho
- **22/11/2026 · Color negro en la paleta de productos** (color nº 13).
  - `app/motor.py`: añadido el 13 a `PALETA` (claro `#1a1a1a`, oscuro `#e6e6e6`).
  - `app/web/index.html`: añadida la variable `--s13` en los dos temas.
  - `app/web/editor.js`: el selector muestra 13 colores en vez de 12.
  - En modo oscuro el «negro» se ve casi blanco; si no, no se distinguiría del fondo.
  - El botón «Repartir colores» y el color automático de los productos nuevos
    siguen usando solo los 12 originales: el negro solo se pone a mano.

- **22/11/2026 · Dividendos, splits y 52 semanas de acciones y ETF** (nivel 1 de «más datos de empresas»).
  - Archivos nuevos (solo míos, sin conflictos posibles):
    - `app/empresa_mod.py`: pide a Yahoo el historial de dividendos, los splits y el último año de
      precios (solo con el ticker, por `red.py`, sin sitios nuevos). Lo guarda en
      `mis_datos/cache/EMPRESA_*.json` y lo vuelve a pedir como mucho cada 12 horas. Calcula
      rentabilidad por dividendo, crecimiento (1, 5 y 10 años), rachas, próximo pago estimado,
      lo que te tocaba en cada pago con tus títulos y si lo tienes anotado.
    - `app/web/empresa_mod.js`: lo pinta. Sus estilos van dentro (clases `emod…`).
    - `tests/test_empresa_mod.py`: pruebas (sin internet).
  - Líneas tocadas en archivos del autor (todas con `[mod]`):
    - `app/servidor.py`: 3 líneas antes de `/api/ping` que añaden la ruta `/api/empresa-mod`.
    - `app/web/app.js`: 1 línea al final de `pintaFondos()` y 1 después de `pintaDividendos()`.
    - `app/web/index.html`: `"empresa_mod.js"` añadido a la lista de scripts del cargador.
  - Dónde se ve:
    - Pestaña **Productos**, en cada acción o ETF con precio de Yahoo: apartado «Dividendos y precio»
      (rango de 52 semanas, cifras del dividendo, gráfico por año, tus dividendos uno a uno,
      avisos de dividendos sin anotar y de splits sin «Ajuste de participaciones»).
    - Pestaña **Rendimiento**, debajo de los dividendos: «Lo que pagan tus acciones y ETF»
      (lo que te pagarían en un año, calendario de los próximos 12 meses y tabla comparativa).
  - La web exportada («Compartir») no lo incluye: allí no hay servidor.
  - Si al traer una actualización del autor algo choca, basta con volver a poner las 5 líneas `[mod]`.

## Pendiente (ideas)
- Nivel 2 de datos de empresas: industria, capitalización, PER, P/VC, rentabilidad por dividendo
  según Morningstar (ampliando la búsqueda de `exposicion.py`, hay que probar los nombres de campo).
- Nivel 3: ficha completa de Yahoo (márgenes, deuda, analistas, calendario de resultados). Necesita
  cookie + «crumb» y añadir un sitio a `red.py`: más frágil.
- Más cambios visuales: colores y textos.
- Control de gastos (pensar antes de programar).

## Notas
- mis_datos/ no se toca ni se sube a GitHub.
