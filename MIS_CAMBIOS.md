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

## Pendiente (ideas)
- Más cambios visuales: colores y textos.
- Control de gastos (pensar antes de programar).

## Notas
- mis_datos/ no se toca ni se sube a GitHub.
