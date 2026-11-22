/* ============================================================
   empresa_mod.js  ·  [mod] Dividendos, splits, 52 semanas y cifras de la empresa
   ============================================================
   Archivo propio (no es del autor original). Pinta dos apartados nuevos:

   - En la pestaña del producto, para acciones y ETF con precio de Yahoo:
     «Dividendos y precio»: rango de 52 semanas, rentabilidad por dividendo,
     crecimiento, próximo pago estimado, dividendo por año, splits y cada
     dividendo con lo que te tocaba y si lo tienes anotado.
   - En «Rendimiento», debajo de los dividendos cobrados:
     «Lo que pagan tus acciones y ETF»: lo que te pagarían en un año, mes a mes,
     y una tabla para comparar unos con otros.
   - Nivel 2 (Yahoo, /api/empresa-mod/cifras): «La empresa en cifras» en la pestaña
     de cada acción, y «Tus acciones en cifras» en «Rendimiento», una tabla para
     ordenarlas por PER, ROE, deuda... Se pide aparte: los dividendos no lo esperan.

   Los datos los da el servidor en /api/empresa-mod (app/empresa_mod.py).
   app.js solo tiene dos líneas marcadas con [mod] que llaman a EmpresaMod.ficha()
   y EmpresaMod.resumen(). Si no hay servidor (la web exportada) o no hay internet,
   estos apartados simplemente no aparecen.
   ============================================================ */
(function () {
  "use strict";

  const G = window.G;
  const D = window.DATOS;
  if (!G || !D) return;
  const $ = s => document.querySelector(s);
  const escH = s => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  /* ---------------------------------------------- estilos propios (prefijo emod) */
  if (!document.getElementById("empresaModCss")) {
    const st = document.createElement("style");
    st.id = "empresaModCss";
    st.textContent = `
      .emodBloque{margin:4px 0 22px}
      .emodBloque h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta3);margin:0 0 12px;font-weight:600}
      .emodRango{position:relative;height:10px;border-radius:99px;background:var(--sup2);border:1px solid var(--borde);margin:34px 6px 8px}
      .emodRango .emodLleno{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:color-mix(in srgb,var(--c) 55%,transparent)}
      .emodMarca{position:absolute;top:-7px;width:3px;height:22px;border-radius:2px;background:var(--tinta);transform:translateX(-1.5px)}
      .emodMarca.medio{background:var(--tinta3);height:16px;top:-4px}
      .emodMarca span{position:absolute;bottom:25px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11.5px;color:var(--tinta2)}
      .emodMarca.medio span{bottom:auto;top:20px;color:var(--tinta3)}
      .emodExtremos{display:flex;justify-content:space-between;font-size:12px;color:var(--tinta3);margin:0 0 6px}
      .emodExtremos b{color:var(--tinta);font-weight:600}
      .emodAvisos{display:grid;gap:8px;margin:0 0 18px}
      .emodEstado{font-size:12px;font-weight:600;white-space:nowrap}
      .emodEstado.si{color:var(--bien)} .emodEstado.no{color:var(--aviso)} .emodEstado.pend{color:var(--tinta3)}
      .emodCargando{color:var(--tinta3);font-size:13px;margin:6px 0}
      details.emodMas{margin-top:14px}
      details.emodMas summary{cursor:pointer;color:var(--tinta2);font-size:13px}
      .emodLeyenda{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:var(--tinta2);margin-top:8px}
      .emodLeyenda i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    `;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------- datos */
  let datos = null, pidiendo = null;
  function trae() {
    if (location.protocol === "file:") return Promise.resolve((datos = {}));
    if (!pidiendo) {
      pidiendo = fetch("api/empresa-mod", { headers: { Accept: "application/json" } })
        .then(r => (r.ok ? r.json() : null))
        .then(j => (datos = (j && j.ok && j.productos) || {}))
        .catch(() => (datos = {}));
    }
    return pidiendo;
  }

  const aplica = p => p && p.fuente === "yahoo" && (p.tipoClave === "accion" || p.tipoClave === "etf");
  const titulosDe = p => p.titulos != null ? p.titulos : (p.participaciones || 0);

  // De la moneda de cotización a euros: con el precio de hoy del propio producto
  // (Rumbo ya lo tiene en euros), así sirve también para peniques, dólares, francos...
  function factorEur(p, e) {
    if ((e.moneda || "").toUpperCase() === "EUR") return 1;
    const nav = p.nav != null ? p.nav : p.precioActual;
    return nav && e.precio ? nav / e.precio : null;
  }

  const SIMBOLOS = { EUR: "€", USD: "$", GBP: "£", GBp: "p", CHF: "CHF", JPY: "¥", CAD: "C$", DKK: "kr", SEK: "kr", NOK: "kr" };
  function fmtNat(v, moneda, dec) {
    if (v == null) return "—";
    const n = v.toLocaleString("es-ES", { minimumFractionDigits: dec == null ? 2 : dec, maximumFractionDigits: dec == null ? 4 : dec });
    return `${n} ${SIMBOLOS[moneda] || moneda || ""}`.trim();
  }
  const pct = (v, d) => v == null ? "—" : G.fmtPct(v, d == null ? 2 : d);
  const pctS = (v, d) => v == null ? "—" : `<span class="${v >= 0 ? "pos" : "neg"}">${G.fmtPctSigno(v, d == null ? 1 : d)}</span>`;
  const anos = n => n ? `${n} ${n === 1 ? "año" : "años"}` : "—";

  function seccion(id, despuesDe) {
    let s = document.getElementById(id);
    const ref = document.getElementById(despuesDe);
    if (!ref) return null;
    if (!s) {
      s = document.createElement("section");
      s.className = "tarjeta";
      s.id = id;
      ref.insertAdjacentElement("afterend", s);
    }
    return s;
  }

  /* ================================================================
     FICHA DEL PRODUCTO
     ================================================================ */
  let fichaActual = null;

  function ficha(p, color) {
    fichaActual = p && p.id;
    const sec = seccion("empresaMod", "fondoFicha");
    if (!sec) return;
    const sec2 = seccion("empresaMod2", "empresaMod");
    if (!aplica(p)) {
      sec.hidden = true; sec.innerHTML = "";
      if (sec2) { sec2.hidden = true; sec2.innerHTML = ""; }
      return;
    }
    pintaParteDividendos(sec, p, color);
    if (sec2) pintaParteCifras(sec2, p, color);   // por separado: una no espera a la otra
  }

  function pintaParteDividendos(sec, p, color) {
    sec.style.setProperty("--c", color);
    if (datos === null) {
      sec.hidden = false;
      sec.innerHTML = `<header><h2>Dividendos y precio</h2></header><p class="emodCargando">Pidiendo los datos a Yahoo Finance…</p>`;
      trae().then(() => { if (fichaActual === p.id && !$("#tab-fondos").hidden) pintaParteDividendos(sec, p, color); });
      return;
    }
    const e = datos[p.id];
    if (!e) { sec.hidden = true; sec.innerHTML = ""; return; }
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
      const kpis = [
        { e: "Rentabilidad por dividendo", v: pct(e.rentabilidad), n: `${fmtNat(e.dps12, mon)} por título en 12 meses` },
        { e: "Te pagaría en un año", v: anual != null ? G.fmtEur(anual) : "—",
          n: tit ? `bruto, con tus ${G.nfNum.format(tit)} títulos${mon !== "EUR" ? " · al cambio de hoy" : ""}` : "ahora no tienes títulos" },
        { e: "Sobre tu precio de compra", v: pct(yoc), n: "lo que rinde lo que pagaste (yield on cost)" },
        { e: "Próximo dividendo", v: px ? G.fmtFechaCorta(px.fecha) : "—",
          n: px ? `estimado · unos ${fmtNat(px.importe, mon)} por título${px.atrasado ? " · ⚠ va con retraso o lo han cambiado" : ""}`
            : "no sigue un calendario fijo" },
      ];
      clave = `<div class="kpis" style="margin:0 0 16px">${kpis.map(k =>
        `<div class="kpi"><div class="e">${k.e}</div><div class="v">${k.v}</div><div class="n">${k.n}</div></div>`).join("")}</div>
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
    const prods = (todos || []).filter(p => aplica(p) && titulosDe(p) > 0 && (p.valor || 0) > 0);
    const sec = seccion("empresaModResumen", "seccionDividendos");
    if (!sec) return;
    if (!prods.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    resumenCifras(prods, color);   // por separado: no espera a los dividendos
    sec.hidden = false;
    if (datos === null) {
      sec.innerHTML = `<header><h2>Lo que pagan tus acciones y ETF</h2></header><p class="emodCargando">Pidiendo los datos a Yahoo Finance…</p>`;
      trae().then(() => { if (!$("#tab-rendimiento").hidden) resumen(todos, color); });
      return;
    }
    const filas = prods.map(p => {
      const e = datos[p.id];
      if (!e) return null;
      const f = factorEur(p, e), tit = titulosDe(p);
      const dpsEur = f != null && e.dps12 != null ? e.dps12 * f : null;
      return { p, e, f, tit, anual: dpsEur != null ? dpsEur * tit : null,
        yoc: dpsEur != null && p.precioMedio ? dpsEur / p.precioMedio : null,
        sinAnotar: (e.dividendos || []).filter(x => x.estado === "sinAnotar").length,
        splitSinAnotar: (e.splits || []).some(s => s.despuesDeComprar && s.anotado === false) };
    }).filter(Boolean);
    if (!filas.length) { sec.hidden = true; sec.innerHTML = ""; return; }

    const total = filas.reduce((a, x) => a + (x.anual || 0), 0);
    const valor = filas.reduce((a, x) => a + (x.p.valor || 0), 0);
    const coste = filas.reduce((a, x) => a + (x.anual != null && x.p.aportado ? x.p.aportado : 0), 0);
    const pagan = filas.filter(x => x.anual);
    const avisos = filas.reduce((a, x) => a + x.sinAnotar, 0);
    const splitsMal = filas.filter(x => x.splitSinAnotar);

    // Calendario de los próximos 12 meses: cada pago estimado, repartido por meses.
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

    const kpis = [
      { e: "Te pagarían en un año", v: G.fmtEur(total), n: `bruto, con lo que tienes hoy · ${pagan.length} de ${filas.length} pagan` },
      { e: "Al mes, de media", v: G.fmtEur(total / 12), n: "antes de impuestos" },
      { e: "Rentabilidad por dividendo", v: valor > 0 ? pct(total / valor) : "—", n: "sobre lo que valen hoy" },
      { e: "Sobre lo que pusiste", v: coste > 0 ? pct(total / coste) : "—", n: "yield on cost de los que pagan" },
    ];
    const ord = filas.slice().sort((a, b) => (b.anual || 0) - (a.anual || 0));
    sec.innerHTML = `
      <header><h2>Lo que pagan tus acciones y ETF</h2>
        <span class="subt">Lo que pagan las empresas según Yahoo Finance, con tus títulos de hoy</span></header>
      ${avisos || splitsMal.length ? `<div class="emodAvisos">
        ${avisos ? `<div class="av"><span>⚠</span><span>Hay <b>${avisos} ${avisos === 1 ? "dividendo" : "dividendos"}</b> que te tocaba cobrar y no veo
          anotados. Entra en cada producto (pestaña de productos) para ver cuáles.</span></div>` : ""}
        ${splitsMal.length ? `<div class="av"><span>⚠</span><span>Posible split sin anotar en: <b>${splitsMal.map(x => escH(x.p.corto || x.p.nombre)).join(", ")}</b>.
          Revisa sus títulos en la pestaña de productos.</span></div>` : ""}</div>` : ""}
      <div class="kpis" style="margin:6px 0 24px">${kpis.map(k =>
        `<div class="kpi"><div class="e">${k.e}</div><div class="v">${k.v}</div><div class="n">${k.n}</div></div>`).join("")}</div>
      ${total > 0 ? `<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta3);margin:0 0 10px">Próximos 12 meses, mes a mes (estimado)</h3>
        <div class="envGraf" id="emodGrafMeses"></div>` : ""}
      <div class="tablaEnv" style="margin-top:16px"><table class="dt">
        <thead><tr><th>Producto</th><th>Rentabilidad</th><th>Por título, 12 meses</th><th>Frecuencia</th>
          <th>Próximo (estimado)</th><th>Crec. 5 años</th><th>Te pagaría al año</th><th title="Yield on cost">Sobre tu precio</th></tr></thead>
        <tbody>${ord.map(x => `<tr>
          <td><i class="pt" style="background:${color ? color(x.p) : "var(--s1)"}"></i>${escH(x.p.corto || x.p.nombre)}${x.sinAnotar || x.splitSinAnotar ? ' <span class="emodEstado no">⚠</span>' : ""}</td>
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

  /* ================================================================
     NIVEL 2 · LA EMPRESA EN CIFRAS (Yahoo: ratios y cuentas anuales)
     ================================================================ */
  let cifrasDatos = null, pidiendoCifras = null;
  function traeCifras() {
    if (location.protocol === "file:") return Promise.resolve((cifrasDatos = {}));
    if (!pidiendoCifras) {
      pidiendoCifras = fetch("api/empresa-mod/cifras", { headers: { Accept: "application/json" } })
        .then(r => (r.ok ? r.json() : null))
        .then(j => (cifrasDatos = (j && j.ok && j.productos) || {}))
        .catch(() => (cifrasDatos = {}));
    }
    return pidiendoCifras;
  }

  const nf = (v, d) => v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtGrande(v, moneda) {
    if (v == null) return null;
    const a = Math.abs(v), m = moneda ? " " + (SIMBOLOS[moneda] || moneda) : "";
    if (a >= 1e12) return nf(v / 1e12, 2) + " billones" + m;
    if (a >= 1e9) return nf(v / 1e9, 1) + " mil M" + m;
    if (a >= 1e6) return nf(v / 1e6, 0) + " M" + m;
    return nf(v, 0) + m;
  }
  const veces = v => v == null ? null : nf(v, v >= 100 ? 0 : 1);
  const pctC = (v, d) => v == null ? null : G.fmtPct(v, d == null ? 1 : d);
  const pctSC = (v, d) => v == null ? null : `<span class="${v >= 0 ? "pos" : "neg"}">${G.fmtPctSigno(v, d == null ? 1 : d)}</span>`;

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

  function pintaParteCifras(sec, p, color) {
    if (p.tipoClave !== "accion") { sec.hidden = true; sec.innerHTML = ""; return; }
    sec.style.setProperty("--c", color);
    if (cifrasDatos === null) {
      sec.hidden = false;
      sec.innerHTML = `<header><h2>La empresa en cifras</h2></header><p class="emodCargando">Pidiendo las cuentas de la empresa a Yahoo Finance…</p>`;
      traeCifras().then(() => { if (fichaActual === p.id && !$("#tab-fondos").hidden) pintaParteCifras(sec, p, color); });
      return;
    }
    const c = cifrasDatos[p.id];
    if (!c) { sec.hidden = true; sec.innerHTML = ""; return; }
    const gs = grupos(c).map(([t, items]) => [t, items.filter(x => x[1] != null && x[1] !== "")]).filter(g => g[1].length);
    if (!gs.length) { sec.hidden = true; sec.innerHTML = ""; return; }
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

  /* ---------------------------------------------- Rendimiento: tus acciones, comparadas */
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

  function resumenCifras(prods, color) {
    const sec = seccion("empresaModCifras", "empresaModResumen");
    if (!sec) return;
    const acciones = prods.filter(p => p.tipoClave === "accion");
    if (!acciones.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    if (cifrasDatos === null) {
      sec.hidden = false;
      sec.innerHTML = `<header><h2>Tus acciones en cifras</h2></header><p class="emodCargando">Pidiendo las cuentas de las empresas a Yahoo Finance…</p>`;
      traeCifras().then(() => { if (!$("#tab-rendimiento").hidden) resumenCifras(prods, color); });
      return;
    }
    const filas = acciones.filter(p => cifrasDatos[p.id]).map(p => ({ p, valor: p.valor || 0, nombre: p.corto || p.nombre, ...cifrasDatos[p.id] }));
    if (!filas.length) { sec.hidden = true; sec.innerHTML = ""; return; }
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

    const pinta = () => {
      const ord = filas.slice().sort((a, b) => {
        const va = a[orden.k], vb = b[orden.k];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const r = typeof va === "string" ? va.localeCompare(vb, "es") : va - vb;
        return orden.asc ? r : -r;
      });
      sec.innerHTML = `
        <header><h2>Tus acciones en cifras</h2>
          <span class="subt">Según Yahoo Finance · pulsa una columna para ordenar</span></header>
        <div class="tablaEnv alto"><table class="dt">
          <thead><tr>${COLS.map(c => `<th data-k="${c.k}" style="cursor:pointer" title="${escH(QUE_ES[c.q] || "")}">${c.t}${orden.k === c.k ? (orden.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
          <tbody>${ord.map(x => `<tr>${COLS.map(c => {
            if (c.k === "nombre") return `<td><i class="pt" style="background:${color ? color(x.p) : "var(--s1)"}"></i>${escH(x.nombre)}</td>`;
            const v = c.f ? c.f(x[c.k]) : (x[c.k] != null ? escH(x[c.k]) : null);
            return `<td>${v == null ? "—" : v}</td>`;
          }).join("")}</tr>`).join("")}</tbody>
          <tfoot><tr>${COLS.map(c => c.k === "nombre" ? "<td>Media de lo que tienes</td>"
            : `<td>${medias[c.k] != null ? c.f(medias[c.k]) : ""}</td>`).join("")}</tr></tfoot></table></div>
        <p class="subt" style="margin:10px 0 0">La media pesa cada empresa según lo que tienes en ella (PER y P/VC con media
          armónica, que es la correcta para un cociente). Pasa el ratón por el título de cada columna para ver qué significa.
          Información para analizar, no una recomendación.</p>`;
      sec.querySelectorAll("th[data-k]").forEach(th => th.addEventListener("click", () => {
        const k = th.dataset.k;
        if (orden.k === k) orden.asc = !orden.asc; else { orden.k = k; orden.asc = k === "nombre" || k === "sector"; }
        pinta();
      }));
    };
    pinta();
  }

  window.EmpresaMod = { ficha, resumen };

  // app.js puede haber pintado antes de que llegara este archivo: se pinta ahora lo pendiente.
  const fp = window.EMPRESA_MOD_FICHA, rp = window.EMPRESA_MOD_RESUMEN;
  if (fp && $("#tab-fondos") && !$("#tab-fondos").hidden) ficha(fp[0], fp[1]);
  if (rp && $("#tab-rendimiento") && !$("#tab-rendimiento").hidden) resumen(rp[0], rp[1]);
  // Se piden ya los datos, para que estén listos al abrir un producto.
  if (D.productos && D.productos.some(aplica)) trae();
  if (D.productos && D.productos.some(p => aplica(p) && p.tipoClave === "accion")) traeCifras();
})();
