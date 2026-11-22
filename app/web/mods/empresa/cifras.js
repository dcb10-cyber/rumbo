/* ============================================================
   mods/empresa/cifras.js  ·  [mod] Nivel 2: la empresa en cifras
   ============================================================
   - Pestaña de cada acción, «La empresa en cifras»: ratios, negocio, deuda,
     crecimiento y un gráfico de beneficio y caja libre por año.
   - «Rendimiento», «Tus acciones en cifras»: tabla para ordenarlas por PER, ROE,
     deuda... con la media ponderada por lo que tienes en cada una.
   Datos: /api/empresa-mod/cifras (app/mods/empresa/cifras.py). Se piden aparte:
   los dividendos no los esperan.
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || !M.empresa) return;
  const G = window.G, D = window.DATOS;
  const { $, escH, visible, seccion, oculta, fuente, tablaOrdenable } = M.util;
  const { esAccion, enCartera, nf, fmtGrande, pctC, pctSC, veces, cargando, celdaNombre } = M.empresa;

  const datos = fuente("api/empresa-mod/cifras");

  // Qué significa cada dato, en cristiano. Se ve al pasar el ratón y en «¿Qué significa cada dato?».
  const QUE_ES = {
    "Sector": "La gran familia de negocio en la que está la empresa.",
    "Industria": "Su negocio concreto, más fino que el sector (lo da Yahoo en inglés).",
    "Capitalización": "Lo que vale toda la empresa en bolsa: precio por número de acciones.",
    "Cuentas del ejercicio": "Fecha de las últimas cuentas anuales de las que salen los datos del negocio.",
    "PER": "Cuántos años de beneficios actuales pagas al comprarla: precio entre beneficio por acción de los últimos 12 meses. Más bajo es más barata respecto a lo que gana, pero puede ser por un motivo.",
    "PER estimado": "El mismo PER, pero con el beneficio que los analistas esperan para el próximo año.",
    "PEG": "El PER dividido entre lo que se espera que crezca el beneficio. Alrededor de 1 se suele considerar razonable; por debajo, barata para lo que crece.",
    "Precio / valor contable": "Precio frente a lo que vale la empresa según su contabilidad. 1 quiere decir que cotiza justo por lo que dicen sus libros.",
    "Precio / ventas": "Lo que vale en bolsa entre lo que factura en un año. Útil en empresas que aún ganan poco.",
    "EV / EBITDA": "Lo que costaría comprar la empresa entera, deuda incluida, entre lo que gana su negocio antes de intereses, impuestos y amortizaciones. Sirve para comparar empresas con distinta deuda.",
    "ROE": "Cuánto gana al año por cada euro que han puesto los accionistas. Más alto, negocio más rentable (ojo: la deuda lo infla).",
    "ROA": "Cuánto gana al año por cada euro de todo lo que tiene (incluido lo comprado con deuda).",
    "Margen bruto": "De cada 100 € que vende, cuánto le queda tras pagar lo que cuesta fabricar o comprar lo que vende.",
    "Margen operativo": "De cada 100 € que vende, cuánto le queda tras pagar todos los gastos del negocio.",
    "Margen neto": "De cada 100 € que vende, cuántos le quedan de beneficio al final, después de intereses e impuestos.",
    "Deuda / patrimonio": "Cuánta deuda tiene por cada euro de los accionistas. Por encima de 1 debe más de lo que tiene de fondos propios.",
    "Deuda neta / EBITDA": "Cuántos años tardaría en pagar su deuda (menos la caja) con lo que genera su negocio. Por debajo de 2-3 suele considerarse cómodo.",
    "Liquidez": "Lo que tiene para cobrar o vender en menos de un año entre lo que tiene que pagar en ese tiempo. Por encima de 1, cubre sus pagos cercanos.",
    "Crecimiento de las ventas": "Cuánto han crecido al año sus ventas, de media, en los últimos años que da Yahoo.",
    "Crecimiento del beneficio por acción": "Cuánto ha crecido al año el beneficio de cada acción, de media.",
    "Número de acciones": "Cuánto ha cambiado el número de acciones. Si baja, la empresa recompra acciones y cada una tuya vale un trozo mayor; si sube, emite nuevas y te diluye.",
    "Payout (sobre beneficio)": "Qué parte del beneficio reparte en dividendos. Por encima del 100 % paga más de lo que gana: difícil de mantener.",
    "Payout (sobre caja libre)": "Qué parte del dinero que de verdad le sobra (caja libre) se va en dividendos. Más fiable que el anterior.",
  };

  // [grupo, [[dato, valor ya formateado o null, texto detrás del nombre]]]
  function grupos(c) {
    const anos = c.anosCrece ? ` (${c.anosCrece} años)` : "";
    return [
      ["La empresa", [["Sector", c.sector && escH(c.sector)], ["Industria", c.industria && escH(c.industria)],
        ["Capitalización", fmtGrande(c.capitalizacion, c.monedaCap)],
        ["Cuentas del ejercicio", c.ejercicio ? G.fmtFecha(c.ejercicio) : null]]],
      ["¿Cara o barata?", [["PER", veces(c.per)], ["PER estimado", veces(c.perFuturo)], ["PEG", c.peg != null ? nf(c.peg, 2) : null],
        ["Precio / valor contable", veces(c.pvc)], ["Precio / ventas", veces(c.pventas)], ["EV / EBITDA", veces(c.evEbitda)]]],
      ["El negocio", [["ROE", pctC(c.roe)], ["ROA", pctC(c.roa)], ["Margen bruto", pctC(c.margenBruto)],
        ["Margen operativo", pctC(c.margenOperativo)], ["Margen neto", pctC(c.margenNeto)]]],
      ["Deuda y solidez", [["Deuda / patrimonio", c.deudaPatrimonio != null ? nf(c.deudaPatrimonio, 2) : null],
        ["Deuda neta / EBITDA", c.deudaNetaEbitda != null ? nf(c.deudaNetaEbitda, 1) : null],
        ["Liquidez", c.liquidez != null ? nf(c.liquidez, 2) : null]]],
      ["Crecimiento y accionista", [[`Crecimiento de las ventas`, pctSC(c.creceVentas), anos],
        ["Crecimiento del beneficio por acción", pctSC(c.creceBpa), anos],
        ["Número de acciones", c.cambioAcciones != null ? G.fmtPctSigno(c.cambioAcciones, 1) + (c.cambioAcciones < -0.005 ? " · recompra" : c.cambioAcciones > 0.005 ? " · emite" : "") : null, anos],
        ["Payout (sobre beneficio)", pctC(c.payout, 0)], ["Payout (sobre caja libre)", pctC(c.payoutCaja, 0)]]],
    ];
  }

  /* ================================================================
     FICHA DE LA ACCIÓN
     ================================================================ */
  function ficha(p, color) {
    const sec = seccion("empresaMod2", "empresaMod");
    if (!sec) return;
    if (!esAccion(p)) { oculta(sec); return; }
    sec.style.setProperty("--c", color);
    if (datos.datos === null) {
      sec.hidden = false;
      sec.innerHTML = cargando("La empresa en cifras", "Pidiendo las cuentas de la empresa a Yahoo Finance…");
      datos.trae().then(() => { if (M.util.fichaActual() === p.id && visible("fondos")) ficha(p, color); });
      return;
    }
    const c = datos.datos[p.id];
    if (!c) { oculta(sec); return; }
    const gs = grupos(c).map(([t, items]) => [t, items.filter(x => x[1] != null && x[1] !== "")]).filter(g => g[1].length);
    if (!gs.length) { oculta(sec); return; }
    sec.hidden = false;
    const usados = gs.flatMap(g => g[1].map(x => x[0]));
    const consulta = c.consulta ? G.fmtFecha(c.consulta.slice(0, 10)) : null;
    const hist = (c.historia || []).filter(h => h[2] != null || h[3] != null);
    const monC = c.monedaCuentas;
    sec.innerHTML = `
      <header>
        <h2>La empresa en cifras</h2>
        <div class="sep"></div>
        <span class="expoNota ${c.sinConexion ? "viejo" : ""}">${c.sinConexion ? "⚠ " : ""}Yahoo Finance${consulta ? " · consultado el " + consulta : ""}</span>
      </header>
      ${gs.map(([t, items]) => `<div class="ventanas"><span class="grupoEtq">${t}</span>${items.map(([e, v, extra]) =>
        `<div class="ventana" title="${escH(QUE_ES[e] || "")}"><div class="e">${e}${extra || ""}</div><div class="v">${v}</div></div>`).join("")}</div>`).join("")}
      ${hist.length >= 2 ? `<div class="emodBloque" style="margin-top:8px"><h3>Beneficio neto y caja libre, cada año${monC ? " · en " + escH(monC) : ""}</h3>
        <div class="envGraf" id="emodGrafCuentas"></div>
        <div class="emodLeyenda"><span><i style="background:${color}"></i>Beneficio neto</span><span><i style="background:${G.css("--s5")}"></i>Caja libre</span></div></div>` : ""}
      <details class="emodMas"><summary>¿Qué significa cada dato?</summary>
        <div class="tablaEnv" style="margin-top:10px"><table class="dt"><tbody>${usados.filter(e => QUE_ES[e]).map(e =>
          `<tr><td style="white-space:nowrap;text-align:left"><b>${e}</b></td><td style="text-align:left;white-space:normal">${QUE_ES[e]}</td></tr>`).join("")}</tbody></table></div>
      </details>
      <p class="subt" style="margin:12px 0 0">Ratios del día y cuentas anuales según Yahoo Finance; ROE, márgenes, deuda y payout
        están calculados con las últimas cuentas anuales. Se vuelven a pedir cada 3 días. Información para analizar, no una
        recomendación de compra o venta.</p>`;
    if (hist.length >= 2) {
      G.barrasAgrupadas($("#emodGrafCuentas"), {
        categorias: hist.map(h => h[0]), alto: 230,
        series: [{ nombre: "Beneficio neto", valores: hist.map(h => h[2]), color: color },
          { nombre: "Caja libre", valores: hist.map(h => h[3]), color: G.css("--s5") }],
        formatoY: v => fmtGrande(v, null) || "0",
      });
    }
  }

  /* ================================================================
     RENDIMIENTO · TUS ACCIONES EN CIFRAS
     ================================================================ */
  const COLS = [
    { k: "nombre", t: "Producto" }, { k: "sector", t: "Sector" },
    { k: "per", t: "PER", f: veces, q: "PER" }, { k: "perFuturo", t: "PER est.", f: veces, q: "PER estimado" },
    { k: "pvc", t: "P/VC", f: veces, q: "Precio / valor contable" },
    { k: "roe", t: "ROE", f: v => pctC(v), q: "ROE" }, { k: "margenNeto", t: "Margen neto", f: v => pctC(v), q: "Margen neto" },
    { k: "deudaPatrimonio", t: "Deuda/patr.", f: v => v == null ? null : nf(v, 2), q: "Deuda / patrimonio" },
    { k: "creceVentas", t: "Crec. ventas", f: v => pctSC(v), q: "Crecimiento de las ventas" },
    { k: "payout", t: "Payout", f: v => pctC(v, 0), q: "Payout (sobre beneficio)" },
  ];
  const orden = { k: "valor", asc: false };

  function resumen(todos, color) {
    const sec = seccion("empresaModCifras", "empresaModResumen");
    if (!sec) return;
    const acciones = enCartera(todos).filter(esAccion);
    if (!acciones.length) { oculta(sec); return; }
    if (datos.datos === null) {
      sec.hidden = false;
      sec.innerHTML = cargando("Tus acciones en cifras", "Pidiendo las cuentas de las empresas a Yahoo Finance…");
      datos.trae().then(() => { if (visible("rendimiento")) resumen(todos, color); });
      return;
    }
    const filas = acciones.filter(p => datos.datos[p.id]).map(p => ({ p, valor: p.valor || 0, nombre: p.corto || p.nombre, ...datos.datos[p.id] }));
    if (!filas.length) { oculta(sec); return; }
    sec.hidden = false;
    // Medias ponderadas por lo que tienes en cada una (PER y P/VC con media armónica: es lo correcto para un cociente).
    const pond = k => {
      const xs = filas.filter(x => x[k] != null && x.valor > 0), tot = xs.reduce((a, x) => a + x.valor, 0);
      return tot ? xs.reduce((a, x) => a + x[k] * x.valor, 0) / tot : null;
    };
    const armonica = k => {
      const xs = filas.filter(x => x[k] > 0 && x.valor > 0);
      return xs.length ? xs.reduce((a, x) => a + x.valor, 0) / xs.reduce((a, x) => a + x.valor / x[k], 0) : null;
    };
    const medias = { per: armonica("per"), perFuturo: armonica("perFuturo"), pvc: armonica("pvc"), roe: pond("roe"),
      margenNeto: pond("margenNeto"), deudaPatrimonio: pond("deudaPatrimonio"), creceVentas: pond("creceVentas"), payout: pond("payout") };

    tablaOrdenable(sec, {
      cabecera: `<header><h2>Tus acciones en cifras</h2>
          <span class="subt">Según Yahoo Finance · pulsa una columna para ordenar</span></header>`,
      cols: COLS.map(c => ({
        k: c.k, t: c.t, titulo: QUE_ES[c.q] || "",
        celda: c.k === "nombre" ? x => celdaNombre(color, x.p, x.nombre)
          : x => c.f ? c.f(x[c.k]) : (x[c.k] != null ? escH(x[c.k]) : null),
      })),
      filas, orden,
      comparar: (a, b) => typeof a === "string" ? a.localeCompare(b, "es") : a - b,
      ascAlCambiar: k => k === "nombre" || k === "sector",
      pie: `<tfoot><tr>${COLS.map(c => c.k === "nombre" ? "<td>Media de lo que tienes</td>"
        : `<td>${medias[c.k] != null ? c.f(medias[c.k]) : ""}</td>`).join("")}</tr></tfoot>`,
      nota: `<p class="subt" style="margin:10px 0 0">La media pesa cada empresa según lo que tienes en ella (PER y P/VC con media
          armónica, que es la correcta para un cociente). Pasa el ratón por el título de cada columna para ver qué significa.
          Información para analizar, no una recomendación.</p>`,
    });
  }

  M.registra({ ficha, resumen });
  if (D.productos && D.productos.some(esAccion)) datos.trae();
})();
