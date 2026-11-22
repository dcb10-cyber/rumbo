/* ============================================================
   mods/empresa/dividendos.js  ·  [mod] Nivel 1: dividendos, splits y 52 semanas
   ============================================================
   - Pestaña del producto (acciones y ETF con precio de Yahoo), «Dividendos y precio»:
     rango de 52 semanas, rentabilidad por dividendo, crecimiento, próximo pago
     estimado, dividendo por año, splits y cada dividendo con lo que te tocaba y si
     lo tienes anotado.
   - «Rendimiento», debajo de los dividendos cobrados, «Lo que pagan tus acciones y
     ETF»: lo que te pagarían en un año, mes a mes, y una tabla para compararlos.
   Datos: /api/empresa-mod (app/mods/empresa/dividendos.py).
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || !M.empresa) return;
  const G = window.G, D = window.DATOS;
  const { $, escH, visible, seccion, oculta, fuente } = M.util;
  const { aplica, titulosDe, enCartera, factorEur, fmtNat, pct, pctS, anos, cargando, kpis, celdaNombre } = M.empresa;

  const datos = fuente("api/empresa-mod");
  const CARGANDO = "Pidiendo los datos a Yahoo Finance…";

  /* ================================================================
     FICHA DEL PRODUCTO
     ================================================================ */
  function ficha(p, color) {
    const sec = seccion("empresaMod", "fondoFicha");
    if (!sec) return;
    if (!aplica(p)) { oculta(sec); return; }
    sec.style.setProperty("--c", color);
    if (datos.datos === null) {
      sec.hidden = false;
      sec.innerHTML = cargando("Dividendos y precio", CARGANDO);
      datos.trae().then(() => { if (M.util.fichaActual() === p.id && visible("fondos")) ficha(p, color); });
      return;
    }
    const e = datos.datos[p.id];
    if (!e) { oculta(sec); return; }
    sec.hidden = false;
    pintaFicha(sec, p, e, color);
  }

  function pintaFicha(sec, p, e, color) {
    const f = factorEur(p, e);
    const tit = titulosDe(p);
    const mon = e.moneda;
    const dpsEur = f != null && e.dps12 != null ? e.dps12 * f : null;
    const anual = dpsEur != null ? dpsEur * tit : null;
    const yoc = dpsEur != null && p.precioMedio ? dpsEur / p.precioMedio : null;
    const hayDiv = (e.dividendos || []).length > 0;
    const consulta = e.consulta ? G.fmtFecha(e.consulta.slice(0, 10)) : null;

    // ---- avisos: splits sin anotar y dividendos que no veo anotados
    const avisos = [];
    (e.splits || []).filter(s => s.despuesDeComprar && s.anotado === false).forEach(s => {
      avisos.push(`El <b>${G.fmtFecha(s.fecha)}</b> hubo un split <b>${escH(s.texto)}</b> y no veo un «Ajuste de participaciones»
        cerca de esa fecha. Si no lo has anotado, tus títulos y tu precio medio estarán mal: anótalo en
        Mis datos → Movimientos con los títulos que te quedaron después.`);
    });
    const sinAnotar = (e.dividendos || []).filter(x => x.estado === "sinAnotar");
    if (sinAnotar.length) {
      avisos.push(`Hay <b>${sinAnotar.length} ${sinAnotar.length === 1 ? "dividendo" : "dividendos"}</b> que, por los títulos que tenías,
        te tocaba cobrar y no veo anotados (el último, con fecha de corte ${G.fmtFecha(sinAnotar[0].fecha)}). Míralo en la tabla
        de abajo y, si lo cobraste, anótalo en Mis datos → Movimientos como «Dividendo».`);
    }
    if (e.sinConexion) avisos.push("Yahoo no ha respondido: estás viendo los últimos datos guardados.");

    // ---- 52 semanas
    let rango = "";
    if (e.max52 != null && e.min52 != null && e.precio != null && e.max52 > e.min52) {
      const pos = v => Math.max(0, Math.min(100, (v - e.min52) / (e.max52 - e.min52) * 100));
      const medioNat = p.precioMedio && f ? p.precioMedio / f : null;
      const medioDentro = medioNat != null && medioNat >= e.min52 && medioNat <= e.max52;
      rango = `<div class="emodBloque"><h3>El precio en las últimas 52 semanas</h3>
        <div class="emodRango">
          <div class="emodLleno" style="width:${pos(e.precio).toFixed(1)}%"></div>
          <div class="emodMarca" style="left:${pos(e.precio).toFixed(1)}%"><span>Hoy ${fmtNat(e.precio, mon, 2)}</span></div>
          ${medioDentro ? `<div class="emodMarca medio" style="left:${pos(medioNat).toFixed(1)}%"><span>tu precio medio</span></div>` : ""}
        </div>
        <div class="emodExtremos" style="margin-top:${medioDentro ? 22 : 8}px">
          <span>Mínimo <b>${fmtNat(e.min52, mon, 2)}</b>${e.fechaMin52 ? " · " + G.fmtFechaCorta(e.fechaMin52) : ""}</span>
          <span>Máximo <b>${fmtNat(e.max52, mon, 2)}</b>${e.fechaMax52 ? " · " + G.fmtFechaCorta(e.fechaMax52) : ""}</span>
        </div>
        <div class="ventanas" style="margin:12px 0 0">
          <div class="ventana"><div class="e">Desde el máximo</div><div class="v">${pctS(e.precio / e.max52 - 1)}</div></div>
          <div class="ventana"><div class="e">Sobre el mínimo</div><div class="v">${pctS(e.precio / e.min52 - 1)}</div></div>
          <div class="ventana"><div class="e">Dónde está en el rango</div><div class="v">${Math.round(pos(e.precio))} %</div></div>
          ${medioNat != null ? `<div class="ventana"><div class="e">Hoy frente a tu precio medio</div><div class="v">${pctS(e.precio / medioNat - 1)}</div></div>` : ""}
        </div></div>`;
    }

    // ---- dividendos: cifras clave
    let clave = "";
    if (hayDiv) {
      const px = e.proximo;
      clave = `${kpis([
        { e: "Rentabilidad por dividendo", v: pct(e.rentabilidad), n: `${fmtNat(e.dps12, mon)} por título en 12 meses` },
        { e: "Te pagaría en un año", v: anual != null ? G.fmtEur(anual) : "—",
          n: tit ? `bruto, con tus ${G.nfNum.format(tit)} títulos${mon !== "EUR" ? " · al cambio de hoy" : ""}` : "ahora no tienes títulos" },
        { e: "Sobre tu precio de compra", v: pct(yoc), n: "lo que rinde lo que pagaste (yield on cost)" },
        { e: "Próximo dividendo", v: px ? G.fmtFechaCorta(px.fecha) : "—",
          n: px ? `estimado · unos ${fmtNat(px.importe, mon)} por título${px.atrasado ? " · ⚠ va con retraso o lo han cambiado" : ""}`
            : "no sigue un calendario fijo" },
      ], "0 0 16px")}
        <div class="ventanas">
          <span class="grupoEtq">Cómo se porta el dividendo</span>
          <div class="ventana"><div class="e">Frecuencia</div><div class="v">${escH(e.frecuenciaTexto || "—")}</div></div>
          <div class="ventana"><div class="e">Crecimiento en 1 año</div><div class="v">${pctS(e.crece1)}</div></div>
          <div class="ventana"><div class="e">Al año, 5 años</div><div class="v">${pctS(e.crece5)}</div></div>
          <div class="ventana"><div class="e">Al año, 10 años</div><div class="v">${pctS(e.crece10)}</div></div>
          <div class="ventana" title="Años naturales completos seguidos con algún dividendo"><div class="e">Años seguidos pagando</div><div class="v">${anos(e.rachaPagando)}</div></div>
          <div class="ventana" title="Años naturales seguidos en los que la suma del año supera a la del anterior"><div class="e">Años seguidos subiéndolo</div><div class="v">${anos(e.rachaSubiendo)}</div></div>
        </div>
        <p class="subt desglose">Cuentas con el dividendo bruto, antes de impuestos. El crecimiento y las rachas comparan años
          naturales completos, así que un pago que se retrasa de diciembre a enero las puede mover.</p>`;
    } else {
      clave = `<p class="subt" style="margin:0 0 18px">Según Yahoo Finance, ${p.tipoClave === "etf" ? "este ETF no reparte dividendos (será de acumulación)" : "esta empresa no ha pagado dividendos"}.</p>`;
    }

    // ---- tus dividendos, uno a uno
    const mios = (e.dividendos || []).filter(x => x.titulos > 0);
    const estado = x => x.estado === "anotado" ? `<span class="emodEstado si">✓ Anotado</span>`
      : x.estado === "porCobrar" ? `<span class="emodEstado pend">Por cobrar</span>`
        : `<span class="emodEstado no">¿Sin anotar?</span>`;
    const eur = v => f != null ? G.fmtEur(v * f) : fmtNat(v, mon);
    let tabla = "";
    if (mios.length) {
      const toca12 = e.toca12 != null && f != null ? e.toca12 * f : null;
      tabla = `<div class="emodBloque"><h3>Tus dividendos, uno a uno</h3>
        ${toca12 != null ? `<p class="subt" style="margin:-4px 0 12px">Últimos 12 meses: te tocaban unos <b>${G.fmtEur(toca12)}</b> brutos
          y tienes anotados <b>${G.fmtEur(e.cobrado12Eur)}</b>. Es normal que lo anotado sea algo menos: suele ser lo que llega
          después de impuestos.</p>` : ""}
        <div class="tablaEnv alto"><table class="dt">
          <thead><tr><th title="Quien tiene el título antes de este día cobra el dividendo">Fecha de corte</th><th>Por título</th>
            <th>Tus títulos</th><th>Te tocaba (bruto)</th><th>Anotado</th><th>Estado</th></tr></thead>
          <tbody>${mios.map(x => `<tr><td>${G.fmtFecha(x.fecha)}</td><td>${fmtNat(x.importe, mon)}</td>
            <td>${G.nfNum.format(x.titulos)}</td><td>${eur(x.teToca)}</td>
            <td>${x.anotado ? `${G.fmtEur(x.anotado.importe)} · ${G.fmtFechaCorta(x.anotado.fecha)}` : "—"}</td>
            <td>${estado(x)}</td></tr>`).join("")}</tbody></table></div>
        <p class="subt" style="margin:8px 0 0">Los títulos salen de tus compras, ventas y ajustes anotados.
          ${mon !== "EUR" ? "Los importes en euros van al cambio de hoy, así que los antiguos son aproximados. " : ""}«Anotado» busca
          un dividendo tuyo de este producto entre unos días antes y 75 días después de la fecha de corte.</p></div>`;
    }
    const historial = hayDiv ? `<details class="emodMas"><summary>Ver todo el historial de dividendos (${e.dividendos.length})</summary>
      <div class="tablaEnv alto" style="margin-top:10px"><table class="dt"><thead><tr><th>Fecha de corte</th><th>Por título</th></tr></thead>
      <tbody>${e.dividendos.map(x => `<tr><td>${G.fmtFecha(x.fecha)}</td><td>${fmtNat(x.importe, mon)}</td></tr>`).join("")}</tbody></table></div>
      <p class="subt" style="margin:8px 0 0">Importe que pagó ese día por cada título, sin ajustar por splits posteriores.</p></details>` : "";

    const splits = (e.splits || []).length ? `<p class="subt" style="margin:14px 0 0">Splits: ${e.splits.map(s =>
      `${escH(s.texto)} el ${G.fmtFecha(s.fecha)}${s.despuesDeComprar ? (s.anotado ? " (anotado ✓)" : " (⚠ sin anotar)") : ""}`).join(" · ")}.</p>` : "";

    sec.innerHTML = `
      <header>
        <h2>Dividendos y precio</h2>
        <div class="sep"></div>
        <span class="expoNota ${e.sinConexion ? "viejo" : ""}">Yahoo Finance · ${escH(e.simbolo || "")}${consulta ? " · consultado el " + consulta : ""}</span>
      </header>
      ${avisos.length ? `<div class="emodAvisos">${avisos.map(a => `<div class="av"><span>⚠</span><span>${a}</span></div>`).join("")}</div>` : ""}
      ${rango}
      ${hayDiv || rango ? `<div class="emodBloque"><h3>Dividendos</h3>${clave}</div>` : clave}
      ${hayDiv ? `<div class="emodBloque"><h3>Dividendo por título, cada año</h3><div class="envGraf" id="emodGrafAnos"></div>
        <p class="subt" style="margin:6px 0 0">* ${e.anoActual}: año en curso, aún incompleto.</p></div>` : ""}
      ${tabla}${historial}${splits}`;

    if (hayDiv) {
      const filas = (e.porAno || []).slice(-15);
      G.barrasSimples($("#emodGrafAnos"), {
        categorias: filas.map(([a]) => String(a) + (a === e.anoActual ? " *" : "")),
        valores: filas.map(([, v]) => v), alto: 220, color: color,
        formatoY: v => fmtNat(v, mon, 2), formatoValor: v => fmtNat(v, mon, 2),
      });
    }
  }

  /* ================================================================
     RENDIMIENTO · LO QUE PAGAN TUS ACCIONES Y ETF
     ================================================================ */
  function resumen(todos, color) {
    const prods = enCartera(todos);
    const sec = seccion("empresaModResumen", "seccionDividendos");
    if (!sec) return;
    if (!prods.length) { oculta(sec); return; }
    sec.hidden = false;
    if (datos.datos === null) {
      sec.innerHTML = cargando("Lo que pagan tus acciones y ETF", CARGANDO);
      datos.trae().then(() => { if (visible("rendimiento")) resumen(todos, color); });
      return;
    }
    const filas = prods.map(p => {
      const e = datos.datos[p.id];
      if (!e) return null;
      const f = factorEur(p, e), tit = titulosDe(p);
      const dpsEur = f != null && e.dps12 != null ? e.dps12 * f : null;
      return { p, e, f, tit, anual: dpsEur != null ? dpsEur * tit : null,
        yoc: dpsEur != null && p.precioMedio ? dpsEur / p.precioMedio : null,
        sinAnotar: (e.dividendos || []).filter(x => x.estado === "sinAnotar").length,
        splitSinAnotar: (e.splits || []).some(s => s.despuesDeComprar && s.anotado === false) };
    }).filter(Boolean);
    if (!filas.length) { oculta(sec); return; }

    const total = filas.reduce((a, x) => a + (x.anual || 0), 0);
    const valor = filas.reduce((a, x) => a + (x.p.valor || 0), 0);
    const coste = filas.reduce((a, x) => a + (x.anual != null && x.p.aportado ? x.p.aportado : 0), 0);
    const pagan = filas.filter(x => x.anual);
    const avisos = filas.reduce((a, x) => a + x.sinAnotar, 0);
    const splitsMal = filas.filter(x => x.splitSinAnotar);
    const meses = calendario(pagan);

    const ord = filas.slice().sort((a, b) => (b.anual || 0) - (a.anual || 0));
    sec.innerHTML = `
      <header><h2>Lo que pagan tus acciones y ETF</h2>
        <span class="subt">Lo que pagan las empresas según Yahoo Finance, con tus títulos de hoy</span></header>
      ${avisos || splitsMal.length ? `<div class="emodAvisos">
        ${avisos ? `<div class="av"><span>⚠</span><span>Hay <b>${avisos} ${avisos === 1 ? "dividendo" : "dividendos"}</b> que te tocaba cobrar y no veo
          anotados. Entra en cada producto (pestaña de productos) para ver cuáles.</span></div>` : ""}
        ${splitsMal.length ? `<div class="av"><span>⚠</span><span>Posible split sin anotar en: <b>${splitsMal.map(x => escH(x.p.corto || x.p.nombre)).join(", ")}</b>.
          Revisa sus títulos en la pestaña de productos.</span></div>` : ""}</div>` : ""}
      ${kpis([
        { e: "Te pagarían en un año", v: G.fmtEur(total), n: `bruto, con lo que tienes hoy · ${pagan.length} de ${filas.length} pagan` },
        { e: "Al mes, de media", v: G.fmtEur(total / 12), n: "antes de impuestos" },
        { e: "Rentabilidad por dividendo", v: valor > 0 ? pct(total / valor) : "—", n: "sobre lo que valen hoy" },
        { e: "Sobre lo que pusiste", v: coste > 0 ? pct(total / coste) : "—", n: "yield on cost de los que pagan" },
      ], "6px 0 24px")}
      ${total > 0 ? `<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta3);margin:0 0 10px">Próximos 12 meses, mes a mes (estimado)</h3>
        <div class="envGraf" id="emodGrafMeses"></div>` : ""}
      <div class="tablaEnv" style="margin-top:16px"><table class="dt">
        <thead><tr><th>Producto</th><th>Rentabilidad</th><th>Por título, 12 meses</th><th>Frecuencia</th>
          <th>Próximo (estimado)</th><th>Crec. 5 años</th><th>Te pagaría al año</th><th title="Yield on cost">Sobre tu precio</th></tr></thead>
        <tbody>${ord.map(x => `<tr>
          ${celdaNombre(color, x.p, x.p.corto || x.p.nombre, x.sinAnotar || x.splitSinAnotar ? ' <span class="emodEstado no">⚠</span>' : "")}
          <td>${pct(x.e.rentabilidad)}</td><td>${x.e.dps12 ? fmtNat(x.e.dps12, x.e.moneda) : "—"}</td>
          <td>${escH(x.e.frecuenciaTexto || "No reparte")}</td>
          <td>${x.e.proximo ? G.fmtFechaCorta(x.e.proximo.fecha) + (x.e.proximo.atrasado ? " ⚠" : "") : "—"}</td>
          <td>${pctS(x.e.crece5)}</td>
          <td>${x.anual != null ? G.fmtEur(x.anual) : "—"}</td><td>${pct(x.yoc)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td>${valor > 0 ? pct(total / valor) : "—"}</td><td></td><td></td><td></td><td></td>
          <td>${G.fmtEur(total)}</td><td>${coste > 0 ? pct(total / coste) : "—"}</td></tr></tfoot></table></div>
      <p class="subt" style="margin:10px 0 0">Es una estimación: supone que cada empresa paga lo mismo que en los últimos 12 meses y en
        las fechas de siempre. Importes brutos (antes de impuestos) y, si cotiza en otra moneda, al cambio de hoy.</p>`;
    if (total > 0) {
      G.barrasSimples($("#emodGrafMeses"), {
        categorias: meses.map(m => m.et), valores: meses.map(m => m.v), alto: 200, color: G.css("--s3"),
        formatoY: G.fmtEurCorto, formatoValor: v => v ? G.fmtEur(v, 0) : "",
      });
    }
  }

  // Calendario de los próximos 12 meses: cada pago estimado, repartido por meses.
  function calendario(pagan) {
    const ym = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const hoy = new Date(); hoy.setDate(1);
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
      return { clave: ym(d), et: d.toLocaleDateString("es-ES", { month: "short" }).replace(".", "") +
        (d.getMonth() === 0 || i === 0 ? " " + String(d.getFullYear()).slice(2) : ""), v: 0 };
    });
    const fin = meses[11].clave;
    pagan.forEach(x => {
      const e = x.e;
      if (!e.frecuencia || !e.proximo || x.f == null) return;
      const porPago = e.dps12 / e.frecuencia * x.tit * x.f;
      let d = new Date(e.proximo.fecha + "T12:00:00");
      const ahora = new Date();
      if (d < ahora) d = new Date(ahora.getFullYear(), ahora.getMonth(), 15);   // atrasado: lo cuento este mes
      for (let k = 0; k < 13; k++) {
        const c = ym(d);
        if (c > fin) break;
        const m = meses.find(z => z.clave === c);
        if (m) m.v += porPago;
        d = new Date(d.getTime() + 365.25 / e.frecuencia * 864e5);
      }
    });
    return meses;
  }

  M.registra({ ficha, resumen });
  // Se piden ya los datos, para que estén listos al abrir un producto.
  if (D.productos && D.productos.some(aplica)) datos.trae();
})();
