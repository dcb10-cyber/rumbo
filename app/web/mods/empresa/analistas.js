/* ============================================================
   mods/empresa/analistas.js  ·  [mod] Nivel 3: analistas
   ============================================================
   - Pestaña de cada acción, «Analistas»: valoración, Argus, técnico, soporte y
     resistencia, argumentos a favor y en contra y hechos relevantes.
   - «Rendimiento», «Analistas de tus acciones»: tabla ordenable.
   Datos: /api/empresa-mod/analistas (app/mods/empresa/analistas.py).
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || !M.empresa) return;
  const G = window.G, D = window.DATOS;
  const { escH, visible, seccion, oculta, fuente, tablaOrdenable } = M.util;
  const { esAccion, enCartera, nf, cargando, celdaNombre } = M.empresa;

  const datos = fuente("api/empresa-mod/analistas");
  const CARGANDO = "Pidiendo los datos a Yahoo Finance…";
  const precioN = v => v == null ? "—" : nf(v, v >= 1000 ? 0 : 2);
  const claseDir = d => d === "Alcista" ? "pos" : d === "Bajista" ? "neg" : "";
  const lista = (titulo, color, xs) => `<div><h3 style="font-size:12px;color:var(${color});margin:0 0 6px">${titulo}</h3>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--tinta2);line-height:1.55">${(xs || []).map(x => `<li>${escH(x)}</li>`).join("")}</ul></div>`;

  /* ================================================================
     FICHA DE LA ACCIÓN
     ================================================================ */
  function ficha(p, color) {
    const sec = seccion("empresaMod3", "empresaMod2");
    if (!sec) return;
    if (!esAccion(p)) { oculta(sec); return; }
    sec.style.setProperty("--c", color);
    if (datos.datos === null) {
      sec.hidden = false;
      sec.innerHTML = cargando("Analistas", CARGANDO);
      datos.trae().then(() => { if (M.util.fichaActual() === p.id && visible("fondos")) ficha(p, color); });
      return;
    }
    const a = datos.datos[p.id];
    if (!a) { oculta(sec); return; }
    sec.hidden = false;
    const consulta = a.consulta ? G.fmtFecha(a.consulta.slice(0, 10)) : null;

    // [título, valor, qué significa]
    const celdas = [];
    if (a.valoracion) celdas.push(["Valoración", escH(a.valoracion) + (a.descuento ? ` · ${escH(a.descuento)}` : ""),
      "Según Trading Central: si el precio está por encima o por debajo de lo que calculan que vale."]);
    if (a.argus) celdas.push(["Opinión de Argus", escH(a.argus) + (a.argusObjetivo ? ` · objetivo ${precioN(a.argusObjetivo)}` : ""),
      "Recomendación de la casa de análisis Argus Research."]);
    (a.tecnico || []).forEach(t => celdas.push([`Técnico, ${t.plazo.toLowerCase()}`,
      `<span class="${claseDir(t.direccion)}">${escH(t.direccion)}</span>`,
      "Lo que dicen los gráficos de precio (análisis técnico de Trading Central). Mide la tendencia, no lo que vale la empresa."]));
    if (a.soporte || a.resistencia) celdas.push(["Soporte / resistencia", `${precioN(a.soporte)} / ${precioN(a.resistencia)}`,
      "Precios donde, según el análisis técnico, suele frenar la caída (soporte) o la subida (resistencia)."]);

    sec.innerHTML = `
      <header>
        <h2>Analistas</h2>
        <div class="sep"></div>
        <span class="expoNota ${a.sinConexion ? "viejo" : ""}">${a.sinConexion ? "⚠ " : ""}Yahoo Finance${a.deSimbolo ? " · " + escH(a.deSimbolo) : ""}${consulta ? " · consultado el " + consulta : ""}</span>
      </header>
      ${celdas.length ? `<div class="emodRejilla">${celdas.map(c =>
        `<div class="ventana" title="${escH(c[2])}"><div class="e">${c[0]}</div><div class="v">${c[1]}</div></div>`).join("")}</div>` : ""}
      ${(a.aFavor || a.enContra) ? `<details class="emodMas"><summary>Argumentos a favor y en contra (Morningstar, en inglés)</summary>
        <div class="expo" style="margin-top:10px">${lista("A favor", "--bien", a.aFavor)}
        ${lista("En contra", "--mal", a.enContra)}</div>
      </details>` : ""}
      ${(a.noticias || []).length ? `<div class="emodBloque" style="margin-top:14px"><h3>Hechos relevantes recientes (en inglés)</h3>
        ${a.noticias.map(n => `<p style="margin:0 0 4px;font-size:13px;color:var(--tinta2)"><span style="color:var(--tinta3)">${n.fecha ? G.fmtFechaCorta(n.fecha) : ""}</span> · ${escH(n.titular)}</p>`).join("")}</div>` : ""}
      <p class="subt" style="margin:12px 0 0">Opiniones recogidas por Yahoo Finance: información para analizar, no una
        recomendación de compra o venta. Se vuelve a pedir una vez al día.</p>`;
  }

  /* ================================================================
     RENDIMIENTO · ANALISTAS DE TUS ACCIONES
     ================================================================ */
  const tecnicoDe = (x, plazo) => { const t = (x.tecnico || []).find(z => z.plazo === plazo); return t ? t.direccion : null; };
  const direccion = v => v ? `<span class="${claseDir(v)}">${escH(v)}</span>` : null;
  const texto = v => v ? escH(v) : null;
  const COLS = [
    { k: "nombre", t: "Producto" },
    { k: "valoracion", t: "Valoración", f: v => v ? escH(v.replace(/ \(.*\)/, "")) : null },
    { k: "descuento", t: "Descuento", f: texto },
    { k: "argus", t: "Argus", f: texto },
    { k: "corto", t: "Técnico corto", f: direccion },
    { k: "medio", t: "Técnico medio", f: direccion },
    { k: "largo", t: "Técnico largo", f: direccion },
  ];
  const orden = { k: "nombre", asc: true };

  function resumen(todos, color) {
    const sec = seccion("empresaModAgenda", "empresaModCifras");
    if (!sec) return;
    const acciones = enCartera(todos).filter(esAccion);
    if (!acciones.length) { oculta(sec); return; }
    if (datos.datos === null) {
      sec.hidden = false;
      sec.innerHTML = cargando("Analistas de tus acciones", CARGANDO);
      datos.trae().then(() => { if (visible("rendimiento")) resumen(todos, color); });
      return;
    }
    const filas = acciones.filter(p => datos.datos[p.id]).map(p => {
      const a = datos.datos[p.id];
      return { p, nombre: p.corto || p.nombre, ...a, corto: tecnicoDe(a, "Corto plazo"), medio: tecnicoDe(a, "Medio plazo"),
        largo: tecnicoDe(a, "Largo plazo") };
    });
    if (!filas.length) { oculta(sec); return; }
    sec.hidden = false;
    tablaOrdenable(sec, {
      cabecera: `<header><h2>Analistas de tus acciones</h2>
          <span class="subt">Según Yahoo Finance · pulsa una columna para ordenar</span></header>`,
      cols: COLS.map(c => ({ k: c.k, t: c.t, celda: c.k === "nombre" ? x => celdaNombre(color, x.p, x.nombre) : x => c.f(x[c.k]) })),
      filas, orden,
      comparar: (a, b) => String(a).localeCompare(String(b), "es"),
      ascAlCambiar: () => true,
      nota: `<p class="subt" style="margin:10px 0 0">Valoración y técnico: Trading Central. Argus: casa de análisis Argus Research.
          En acciones europeas Yahoo suele dar poco. Información para analizar, no una recomendación.</p>`,
    });
  }

  M.registra({ ficha, resumen });
  if (D.productos && D.productos.some(esAccion)) datos.trae();
})();
