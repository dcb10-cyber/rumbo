/* ============================================================
   mods/pestana_dividendos.js  ·  [mod] Pestaña «Ingr. Pasivos» (dividendos, intereses…)
   ============================================================
   Archivo propio (no es del autor original). Añade la pestaña «Ingr. Pasivos» después de
   «Rendimiento» sin tocar index.html ni app.js (M.util.pestana, en mods.js).

   Qué enseña (todo con lo que tienes anotado como «Dividendo» en Mis datos):
     - Cifras clave: total, este año frente al anterior a estas alturas, últimos 12
       meses, media al mes, rentabilidad por dividendo y sobre lo que pusiste.
     - Año a año: gráfico, tabla año × mes (como la hoja «Div. Anuales») y la renta
       de los últimos 12 meses, mes a mes (¿crece tu renta pasiva?).
     - Un año frente al anterior, mes a mes.
     - Quién te paga: ranking por producto y reparto por producto, broker y divisa.
   Lo fiscal (retenciones, deducible, lo que falta por pagar) está en la pestaña IRPF
   (pestana_irpf.js).
     - Todos los cobros, uno a uno.
   Filtros arriba: qué se cuenta (dividendos, intereses…) y el periodo.

   Datos: /api/dividendos-mod (app/mods/pestana_dividendos.py) + DATOS (valor, coste,
   colores de cada producto).
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || !window.G || !window.DATOS) return;
  const G = window.G, D = window.DATOS;
  const { $, escH, tablaOrdenable } = M.util;

  const TAB = "dividendos";
  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const CLASES = {
    dividendos: "Dividendos", cupones: "Cupones", intereses: "Intereses", alquileres: "Alquileres",
  };

  /* ---------------------------------------------- estilos propios (prefijo dmod) */
  if (!document.getElementById("dividendosModCss")) {
    const st = document.createElement("style");
    st.id = "dividendosModCss";
    st.textContent = `
      .dmodFiltros{display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px;margin:24px 0 0}
      .dmodFiltros .dmodF{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .dmodFiltros .subt{white-space:nowrap}
      #tab-dividendos .kpis{margin:18px 0 22px}
      .dmodCalor td.m{min-width:58px}
      .dmodCalor td.cero{color:var(--tinta3)}
      .dmodCalor td.tot{font-weight:650}
      .dmodTres{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:18px}
      .dmodTres > div{border:1px solid var(--borde);border-radius:12px;padding:12px 14px;min-width:0}
      .dmodTres h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta3);margin:0 0 6px;font-weight:600}
      .dmodLeyenda{display:grid;gap:3px;font-size:12px;color:var(--tinta2);margin-top:6px}
      .dmodLeyenda div{display:flex;gap:8px;align-items:center;min-width:0}
      .dmodLeyenda span.n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dmodLeyenda i{flex:none;width:9px;height:9px;border-radius:3px}
      .dmodLeyenda b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--tinta)}
      .dmodBarra{display:inline-block;vertical-align:middle;height:6px;border-radius:3px;margin-left:8px;background:var(--s3);opacity:.75}
      .dmodNota{margin:12px 0 0;line-height:1.5}
      .dmodPrev{font-size:11px;font-weight:600;color:var(--tinta3);border:1px solid var(--borde);border-radius:6px;padding:1px 6px;margin-left:6px}
      #dmodTablaCobros th[data-k="nombre"],#dmodTablaCobros th[data-k="nota"],#dmodTablaCobros td:has(> .izq){text-align:left}
      .dmodVacio{color:var(--tinta3);font-size:13.5px;line-height:1.6;margin:8px 0}
      @media(max-width:900px){.dmodTres{grid-template-columns:minmax(0,1fr)}}
    `;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------- datos */
  const fuente = M.util.cobros;   // compartido con la pestaña IRPF (mods.js)

  // Productos del panel (con valor, coste y color de hoy).
  const todosD = () => (D.productos || []).concat(D.otrosActivos || [], D.pasivos || []);
  const prodD = id => todosD().find(p => p.id === id);
  const oscuro = () => document.documentElement.dataset.tema !== "claro";
  const PALETA = () => [1, 3, 2, 4, 7, 5, 9, 6, 8, 10, 12, 11].map(i => G.css("--s" + i));
  function colorDe(id, i) {
    const p = prodD(id);
    const c = p && (p.slotColor || p.color);
    if (c) return oscuro() ? c[1] : c[0];
    const pal = PALETA();
    return pal[i % pal.length];
  }

  function claseDe(tipo) {
    if (tipo === "efectivo" || tipo === "p2p") return "intereses";
    if (tipo === "inmueble") return "alquileres";
    if (tipo === "bono") return "cupones";
    return "dividendos";
  }

  /* ---------------------------------------------- estado de los filtros */
  const estado = { clase: null, periodo: null, ordenProd: { k: "total", asc: false }, ordenCobros: { k: "fecha", asc: false } };

  /* ---------------------------------------------- utilidades */
  const sum = a => a.reduce((s, x) => s + x, 0);
  const restaDias = (iso, n) => {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const finDeMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);   // mes 1-12
  const pct = (v, d) => (v == null || !isFinite(v) ? "—" : G.fmtPct(v, d == null ? 2 : d));
  const pctS = v => (v == null || !isFinite(v) ? "—" : G.fmtPctSigno(v, 1));
  const varia = (a, b) => (b > 0 ? a / b - 1 : null);
  const clsVar = v => (v == null ? "" : v >= 0 ? "pos" : "neg");
  const kpisHtml = ks => `<div class="kpis">${ks.map(k =>
    `<div class="kpi"><div class="e">${k.e}</div><div class="v${k.c ? " " + k.c : ""}">${k.v}</div><div class="n">${k.n}</div></div>`).join("")}</div>`;
  const comparar = (a, b) => (typeof a === "string" ? a.localeCompare(b, "es") : a - b);

  function segm(cont, opciones, activo, alPulsar) {
    cont.innerHTML = "";
    opciones.forEach(o => {
      const b = document.createElement("button");
      b.textContent = o.t;
      b.setAttribute("aria-pressed", String(o.k === activo));
      b.addEventListener("click", () => alPulsar(o.k));
      cont.appendChild(b);
    });
  }

  function frecuencia(n) {
    if (!n) return null;
    if (n >= 11) return "Mensual";
    if (n >= 5) return n + " al año";
    if (n === 4) return "Trimestral";
    if (n === 3) return "3 al año";
    if (n === 2) return "Semestral";
    return "Anual";
  }

  /* ================================================================
     PINTAR
     ================================================================ */
  function pinta(panel) {
    if (fuente.datos === null) {
      panel.innerHTML = `<section class="tarjeta" style="margin-top:24px"><p class="dmodVacio">Leyendo tus cobros…</p></section>`;
      fuente.trae().then(() => tab.pinta());
      return;
    }
    pintaTodo(panel);
  }

  function pintaTodo(panel) {
    const hoy = D.fechaExtracto;
    const info = fuente.datos.productos;
    const todos = fuente.datos.cobros.map(c => {
      const i = info[c.producto] || {};
      const p = prodD(c.producto);
      return { ...c, nombre: i.corto || (p && (p.corto || p.nombre)) || c.producto,
        entidad: i.entidad || (p && p.entidad) || "", moneda: i.moneda || (p && p.moneda) || "EUR",
        clase: claseDe(i.tipo || (p && p.tipoClave)), previsto: c.fecha > hoy };
    });

    if (!todos.length) {
      panel.innerHTML = `<section class="tarjeta" style="margin-top:24px">
        <header><h2>Ingresos pasivos</h2></header>
        <p class="dmodVacio">${fuente.error ? escH(fuente.error) : `Todavía no tienes ningún dividendo anotado. Cuando
          anotes uno (en <b>Mis datos → Movimientos</b>, tipo «Dividendo»), aquí verás cuánto te pagan tus inversiones,
          quién te paga más, cómo crece año a año y cada cobro uno a uno.`}</p></section>`;
      return;
    }

    // ---- filtro «qué se cuenta»
    const clases = Object.keys(CLASES).filter(k => todos.some(c => c.clase === k));
    if (!estado.clase || (estado.clase !== "todo" && !clases.includes(estado.clase))) {
      estado.clase = clases.includes("dividendos") ? "dividendos" : clases.length > 1 ? "todo" : clases[0];
    }
    const deClase = todos.filter(c => estado.clase === "todo" || c.clase === estado.clase);
    const reales = deClase.filter(c => !c.previsto);

    // ---- periodo
    const anoHoy = +hoy.slice(0, 4);
    const anoIni = reales.length ? +reales[0].fecha.slice(0, 4) : anoHoy;
    const anos = [];
    for (let a = anoIni; a <= anoHoy; a++) anos.push(String(a));
    if (!estado.periodo || (estado.periodo !== "todo" && !anos.includes(estado.periodo))) estado.periodo = String(anoHoy);
    const enPeriodo = c => estado.periodo === "todo" || c.fecha.startsWith(estado.periodo);
    const nomPeriodo = estado.periodo === "todo" ? "desde el principio" : "en " + estado.periodo;
    const nomClase = (estado.clase === "todo" ? "cobros" : CLASES[estado.clase]).toLowerCase();

    panel.innerHTML = `
      <div class="dmodFiltros">
        <div class="dmodF" id="dmodClaseEnv"${clases.length > 1 ? "" : " hidden"}><span class="subt">Qué cuento</span><div class="segm" id="dmodClase"></div></div>
        <div class="dmodF"><span class="subt">Periodo</span><div class="segm" id="dmodPeriodo"></div></div>
      </div>
      <div id="dmodKpis"></div>
      <section class="tarjeta" id="dmodAnual">
        <header><h2>Año a año</h2><span class="subt" id="dmodAnualNota"></span></header>
        <div class="envGraf" id="dmodGrafAnual"></div>
        <div class="tablaEnv" style="margin-top:16px"><table class="dt dmodCalor" id="dmodTablaCalor"></table></div>
      </section>
      <section class="tarjeta" id="dmodRenta">
        <header><h2>Tu renta de los últimos 12 meses</h2><span class="subt">Lo cobrado en los 12 meses anteriores a cada fecha: si la línea sube, tu renta pasiva crece</span></header>
        <div class="envGraf" id="dmodGrafRenta"></div>
      </section>
      <section class="tarjeta" id="dmodMes">
        <header><h2 id="dmodMesTit">Mes a mes</h2><span class="subt" id="dmodMesNota"></span></header>
        <div class="envGraf" id="dmodGrafMes"></div>
      </section>
      <section class="tarjeta" id="dmodQuien">
        <header><h2>Quién te paga</h2><span class="subt" id="dmodQuienNota"></span></header>
        <div id="dmodTablaProd"></div>
        <p class="subt dmodNota" id="dmodConcentra"></p>
        <div class="dmodTres">
          <div><h3>Por producto</h3><div class="envGraf" id="dmodDonaProd"></div><div class="dmodLeyenda" id="dmodLeyProd"></div></div>
          <div><h3>Por broker o banco</h3><div class="envGraf" id="dmodDonaEnt"></div><div class="dmodLeyenda" id="dmodLeyEnt"></div></div>
          <div><h3>Por divisa del producto</h3><div class="envGraf" id="dmodDonaMon"></div><div class="dmodLeyenda" id="dmodLeyMon"></div></div>
        </div>
      </section>
      <section class="tarjeta" id="dmodCobros">
        <header><h2>Todos los cobros</h2><span class="subt" id="dmodCobrosNota"></span></header>
        <div id="dmodTablaCobros"></div>
      </section>`;

    const opClase = clases.map(k => ({ k, t: CLASES[k] }));
    if (clases.length > 1) opClase.push({ k: "todo", t: "Todo junto" });
    segm($("#dmodClase"), opClase, estado.clase, k => { estado.clase = k; tab.pinta(); });
    segm($("#dmodPeriodo"), [{ k: "todo", t: "Todo" }].concat(anos.slice().reverse().map(a => ({ k: a, t: a }))),
      estado.periodo, k => { estado.periodo = k; tab.pinta(); });

    if (!reales.length) {
      $("#dmodKpis").innerHTML = `<p class="dmodVacio" style="margin-top:18px">Solo tienes ${nomClase} con fecha futura (previstos).</p>`;
    }

    const porProd = resumenPorProducto(reales, hoy);
    pintaKpis(reales, porProd, hoy, nomClase);
    pintaAnual(reales, anos, hoy);
    pintaRenta(reales, hoy, nomClase);
    pintaMes(reales, anos, hoy);
    pintaQuien(reales.filter(enPeriodo), porProd, nomPeriodo);
    pintaCobros(deClase.filter(enPeriodo), nomPeriodo);
  }

  /* ---------------------------------------------- por producto (todo el historial) */
  function resumenPorProducto(reales, hoy) {
    const hace1 = restaDias(hoy, 365);
    const m = new Map();
    reales.forEach(c => {
      let x = m.get(c.producto);
      if (!x) {
        x = { id: c.producto, nombre: c.nombre, entidad: c.entidad, moneda: c.moneda,
          total: 0, cobros: 0, ult12: 0, n12: 0, primero: c.fecha, ultimo: c.fecha };
        m.set(c.producto, x);
      }
      x.total += c.importe; x.cobros++; x.ultimo = c.fecha;
      if (c.fecha > hace1) { x.ult12 += c.importe; x.n12++; }
    });
    m.forEach(x => {
      const p = prodD(x.id);
      x.valor = p && p.valor > 0 ? p.valor : null;
      x.aportado = p && p.aportado > 0 ? p.aportado : null;
      x.sobreValor = x.valor && x.ult12 ? x.ult12 / x.valor : null;
      x.sobreCoste = x.aportado && x.ult12 ? x.ult12 / x.aportado : null;
    });
    return m;
  }

  /* ---------------------------------------------- cifras clave */
  function pintaKpis(reales, porProd, hoy, nomClase) {
    if (!reales.length) return;
    const ano = hoy.slice(0, 4), anoAnt = String(+ano - 1);
    const mismoDiaAnt = anoAnt + hoy.slice(4);
    const hace1 = restaDias(hoy, 365), hace2 = restaDias(hoy, 730);
    const total = sum(reales.map(c => c.importe));
    const ytd = sum(reales.filter(c => c.fecha.startsWith(ano)).map(c => c.importe));
    const ytdAnt = sum(reales.filter(c => c.fecha.startsWith(anoAnt) && c.fecha <= mismoDiaAnt).map(c => c.importe));
    const ult12 = sum(reales.filter(c => c.fecha > hace1).map(c => c.importe));
    const prev12 = sum(reales.filter(c => c.fecha > hace2 && c.fecha <= hace1).map(c => c.importe));
    const v12 = varia(ult12, prev12), vYtd = varia(ytd, ytdAnt);

    // Rentabilidad: lo cobrado en 12 meses por lo que aún tienes, entre lo que vale hoy y lo que pusiste.
    const pagan = [...porProd.values()].filter(x => x.ult12 > 0);
    const conValor = pagan.filter(x => x.valor);
    const conCoste = pagan.filter(x => x.aportado);
    const rVal = conValor.length ? sum(conValor.map(x => x.ult12)) / sum(conValor.map(x => x.valor)) : null;
    const rCoste = conCoste.length ? sum(conCoste.map(x => x.ult12)) / sum(conCoste.map(x => x.aportado)) : null;

    const ks = [
      { e: "Cobrado en total", v: G.fmtEur(total), n: `${reales.length} cobros desde ${G.fmtFecha(reales[0].fecha)}` },
      { e: `En ${ano}, hasta hoy`, v: G.fmtEur(ytd),
        n: ytdAnt > 0 ? `<span class="${clsVar(vYtd)}">${pctS(vYtd)}</span> frente a ${G.fmtEur(ytdAnt, 0)} en ${anoAnt} a estas alturas`
          : `en ${anoAnt} a estas alturas: nada` },
      { e: "Últimos 12 meses", v: G.fmtEur(ult12),
        n: prev12 > 0 ? `<span class="${clsVar(v12)}">${pctS(v12)}</span> frente a los 12 anteriores` : "lo que te pagan en un año" },
      { e: "Al mes, de media", v: G.fmtEur(ult12 / 12), n: "últimos 12 meses" },
      { e: "Sobre lo que vale", v: pct(rVal), n: "12 meses, de lo que sigues teniendo" },
      { e: "Sobre lo que pusiste", v: pct(rCoste), n: "yield on cost, mismos 12 meses" },
      { e: "Te pagan", v: `${pagan.length}`, n: `productos en 12 meses · ${porProd.size} alguna vez` },
    ];
    $("#dmodKpis").innerHTML = kpisHtml(ks);
  }

  /* ---------------------------------------------- año a año + tabla año × mes */
  function pintaAnual(reales, anos, hoy) {
    if (!reales.length) { $("#dmodAnual").hidden = true; return; }
    const ano = hoy.slice(0, 4);
    const tabla = {};
    anos.forEach(a => { tabla[a] = new Array(12).fill(0); });
    reales.forEach(c => { const a = c.fecha.slice(0, 4); if (tabla[a]) tabla[a][+c.fecha.slice(5, 7) - 1] += c.importe; });
    const totales = anos.map(a => sum(tabla[a]));

    $("#dmodAnualNota").textContent = `* ${ano}: hasta el ${G.fmtFecha(hoy)}`;
    G.barrasSimples($("#dmodGrafAnual"), {
      categorias: anos.map(a => a + (a === ano ? " *" : "")),
      valores: totales, alto: 220, color: G.css("--s3"),
      formatoY: G.fmtEurCorto, formatoValor: v => G.fmtEur(v, 0),
    });

    const max = Math.max(...anos.flatMap(a => tabla[a]), 0.01);
    const celda = v => {
      if (!v) return `<td class="m cero">—</td>`;
      const a = Math.round(8 + 52 * (v / max));
      return `<td class="m" style="background:color-mix(in srgb,var(--s3) ${a}%,transparent)">${G.fmtEur(v, 0)}</td>`;
    };
    const filas = anos.slice().reverse().map(a => {
      const i = anos.indexOf(a);
      const vAnt = i > 0 ? totales[i - 1] : 0;
      const v = a === ano ? null : varia(totales[i], vAnt);
      return `<tr><td>${a}${a === ano ? " *" : ""}</td>${tabla[a].map(celda).join("")}
        <td class="tot">${G.fmtEur(totales[i], 0)}</td>
        <td class="${clsVar(v)}">${pctS(v)}</td></tr>`;
    }).join("");
    const mediaMes = MESES.map((_, m) => {
      const completos = anos.filter(a => a !== ano);
      return completos.length ? sum(completos.map(a => tabla[a][m])) / completos.length : null;
    });
    $("#dmodTablaCalor").innerHTML =
      `<thead><tr><th>Año</th>${MESES.map(m => `<th>${m}</th>`).join("")}<th>Total</th>
        <th title="Frente al año anterior completo">vs año ant.</th></tr></thead>
       <tbody>${filas}</tbody>` +
      (anos.length > 2 ? `<tfoot><tr><td title="Media de los años completos">Media</td>${mediaMes.map(v =>
        `<td>${v ? G.fmtEur(v, 0) : "—"}</td>`).join("")}<td>${G.fmtEur(sum(mediaMes.map(v => v || 0)), 0)}</td><td></td></tr></tfoot>` : "");
  }

  /* ---------------------------------------------- renta de los últimos 12 meses (móvil) */
  function pintaRenta(reales, hoy, nomClase) {
    const sec = $("#dmodRenta");
    if (!reales.length) { sec.hidden = true; return; }
    const ini = reales[0].fecha;
    let a = +ini.slice(0, 4), m = +ini.slice(5, 7);
    const fechas = [];
    while (true) {
      const f = finDeMes(a, m);
      if (f >= hoy) { fechas.push(hoy); break; }
      fechas.push(f);
      if (++m > 12) { m = 1; a++; }
    }
    if (fechas.length < 3) { sec.hidden = true; return; }
    const valores = fechas.map(f => {
      const desde = restaDias(f, 365);
      return sum(reales.filter(c => c.fecha > desde && c.fecha <= f).map(c => c.importe));
    });
    G.multiLinea($("#dmodGrafRenta"), {
      fechas, alto: 240, desdeCero: true,
      series: [
        { nombre: `${nomClase.charAt(0).toUpperCase() + nomClase.slice(1)} en 12 meses`, valores, color: G.css("--s3"), destacado: true },
        { nombre: "Al mes, de media", valores: valores.map(v => v / 12), color: G.css("--s11") },
      ],
      formatoY: G.fmtEurCorto, formatoValor: v => G.fmtEur(v, 0),
    });
  }

  /* ---------------------------------------------- un año frente al anterior, mes a mes */
  function pintaMes(reales, anos, hoy) {
    if (!reales.length) { $("#dmodMes").hidden = true; return; }
    const ano = estado.periodo === "todo" ? hoy.slice(0, 4) : estado.periodo;
    const ant = String(+ano - 1);
    const porMes = a => {
      const v = new Array(12).fill(0);
      reales.forEach(c => { if (c.fecha.startsWith(a)) v[+c.fecha.slice(5, 7) - 1] += c.importe; });
      return v;
    };
    const vA = porMes(ano), vB = porMes(ant);
    const hayAnt = anos.includes(ant) && vB.some(v => v);
    $("#dmodMesTit").textContent = hayAnt ? `${ano} frente a ${ant}, mes a mes` : `${ano}, mes a mes`;
    const mejor = vA.indexOf(Math.max(...vA));
    $("#dmodMesNota").textContent = vA[mejor] > 0
      ? `El mes que más cobraste en ${ano}: ${MESES[mejor].toLowerCase()} (${G.fmtEur(vA[mejor], 0)})` : "";
    const series = [];
    if (hayAnt) series.push({ nombre: ant, color: G.css("--s11"), valores: vB });
    series.push({ nombre: ano, color: G.css("--s3"), valores: vA });
    G.barrasAgrupadas($("#dmodGrafMes"), {
      categorias: MESES.map((_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`), alto: 240,
      formatoCat: c => MESES[+c.slice(5, 7) - 1], series,
      formatoValor: v => G.fmtEur(v, 0),
    });
  }

  /* ---------------------------------------------- quién te paga */
  function pintaQuien(cobros, porProd, nomPeriodo) {
    const sec = $("#dmodQuien");
    if (!cobros.length) {
      $("#dmodQuienNota").textContent = "";
      sec.querySelector(".dmodTres").hidden = true;
      $("#dmodTablaProd").innerHTML = `<p class="dmodVacio">Sin cobros ${escH(nomPeriodo)}.</p>`;
      return;
    }
    const m = new Map();
    cobros.forEach(c => {
      let x = m.get(c.producto);
      if (!x) { x = { id: c.producto, nombre: c.nombre, entidad: c.entidad, moneda: c.moneda, periodo: 0, nP: 0 }; m.set(c.producto, x); }
      x.periodo += c.importe; x.nP++;
    });
    const total = sum([...m.values()].map(x => x.periodo));
    const filas = [...m.values()].map((x, i) => {
      const h = porProd.get(x.id) || {};
      return { ...x, i, peso: total ? x.periodo / total : 0, ult12: h.ult12 || 0, n12: h.n12 || 0,
        sobreValor: h.sobreValor, sobreCoste: h.sobreCoste, ultimo: h.ultimo, frec: frecuencia(h.n12) };
    }).sort((a, b) => b.periodo - a.periodo);
    filas.forEach((x, i) => { x.color = colorDe(x.id, i); });
    $("#dmodQuienNota").textContent = `${filas.length} ${filas.length === 1 ? "producto" : "productos"} ${nomPeriodo} · las columnas «12 meses» miran siempre al último año`;

    const maxPeso = Math.max(...filas.map(x => x.peso));
    tablaOrdenable($("#dmodTablaProd"), {
      cabecera: "",
      cols: [
        { k: "nombre", t: "Producto", celda: x => `<td><i class="pt" style="background:${x.color}"></i>${escH(x.nombre)}${x.entidad ? ` <small>· ${escH(x.entidad)}</small>` : ""}</td>` },
        { k: "nP", t: "Cobros", celda: x => String(x.nP) },
        { k: "periodo", t: "Cobrado", celda: x => G.fmtEur(x.periodo) },
        { k: "peso", t: "% del total", celda: x => `${G.fmtPct(x.peso, 1)}<span class="dmodBarra" style="width:${Math.max(2, Math.round(60 * x.peso / maxPeso))}px"></span>` },
        { k: "ult12", t: "12 meses", titulo: "Lo cobrado en los últimos 12 meses", celda: x => (x.ult12 ? G.fmtEur(x.ult12) : null) },
        { k: "frec", t: "Paga", titulo: "Cuántas veces te ha pagado en los últimos 12 meses", celda: x => x.frec },
        { k: "sobreValor", t: "Sobre lo que vale", titulo: "12 meses entre lo que vale hoy", celda: x => (x.sobreValor == null ? null : pct(x.sobreValor)) },
        { k: "sobreCoste", t: "Sobre lo que pusiste", titulo: "12 meses entre lo que te costó (yield on cost)", celda: x => (x.sobreCoste == null ? null : pct(x.sobreCoste)) },
        { k: "ultimo", t: "Último cobro", celda: x => (x.ultimo ? G.fmtFecha(x.ultimo) : null) },
      ],
      filas, orden: estado.ordenProd, comparar,
      ascAlCambiar: k => k === "nombre" || k === "frec",
      pie: `<tfoot><tr><td>Total</td><td>${cobros.length}</td><td>${G.fmtEur(total)}</td><td>100 %</td><td colspan="5"></td></tr></tfoot>`,
      nota: "",
    });

    // Concentración
    const top = n => sum(filas.slice(0, n).map(x => x.peso));
    $("#dmodConcentra").innerHTML = filas.length > 3
      ? `<b>Concentración:</b> ${escH(filas[0].nombre)} es el ${G.fmtPct(filas[0].peso, 1)} de lo cobrado ${escH(nomPeriodo)};
         los 3 primeros suman el ${G.fmtPct(top(3), 1)}${filas.length > 10 ? ` y los 10 primeros, el ${G.fmtPct(top(10), 1)}` : ""}.`
      : "";

    // Tres donuts
    const pal = PALETA();
    const agrupa = (clave, nombreVacio) => {
      const g = new Map();
      filas.forEach(x => { const k = x[clave] || nombreVacio; g.set(k, (g.get(k) || 0) + x.periodo); });
      return [...g.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, valor], i) => ({ nombre, valor, color: pal[i % pal.length] }));
    };
    const corta = (lista, n) => {
      if (lista.length <= n) return lista;
      const resto = sum(lista.slice(n - 1).map(d => d.valor));
      return lista.slice(0, n - 1).concat([{ nombre: `Otros (${lista.length - n + 1})`, valor: resto, color: G.css("--tinta3") }]);
    };
    const dona = (idG, idL, datos) => {
      G.donut($("#" + idG), { datos, alto: 190, tituloCentro: "", valorCentro: G.fmtEurCorto(total) });
      $("#" + idL).innerHTML = datos.map(d => `<div><i style="background:${d.color}"></i><span class="n">${escH(d.nombre)}</span>
        <b>${G.fmtPct(d.valor / total, 1)}</b></div>`).join("");
    };
    dona("dmodDonaProd", "dmodLeyProd", corta(filas.map(x => ({ nombre: x.nombre, valor: x.periodo, color: x.color })), 8));
    dona("dmodDonaEnt", "dmodLeyEnt", corta(agrupa("entidad", "Sin broker"), 8));
    dona("dmodDonaMon", "dmodLeyMon", corta(agrupa("moneda", "EUR"), 8));
  }

  /* ---------------------------------------------- todos los cobros */
  function pintaCobros(cobros, nomPeriodo) {
    if (!cobros.length) {
      $("#dmodCobrosNota").textContent = "";
      $("#dmodTablaCobros").innerHTML = `<p class="dmodVacio">Sin cobros ${escH(nomPeriodo)}.</p>`;
      return;
    }
    const reales = cobros.filter(c => !c.previsto);
    const prev = cobros.length - reales.length;
    $("#dmodCobrosNota").textContent = `${reales.length} cobros ${nomPeriodo} · ${G.fmtEur(sum(reales.map(c => c.importe)))}` +
      (prev ? ` · ${prev} con fecha futura (previstos, no cuentan en las cifras)` : "");
    const conCom = cobros.some(c => c.comision);
    const conUds = cobros.some(c => c.unidades);
    const conNota = cobros.some(c => c.nota);
    const filas = cobros.map((c, i) => ({ ...c, i, porTitulo: c.unidades ? c.importe / c.unidades : null }));
    const colores = new Map();
    filas.forEach(c => { if (!colores.has(c.producto)) colores.set(c.producto, colorDe(c.producto, colores.size)); });
    const cols = [
      { k: "fecha", t: "Fecha", celda: c => G.fmtFecha(c.fecha) + (c.previsto ? `<span class="dmodPrev">previsto</span>` : "") },
      { k: "nombre", t: "Producto", celda: c => `<td style="text-align:left"><i class="pt" style="background:${colores.get(c.producto)}"></i>${escH(c.nombre)}</td>` },
      { k: "entidad", t: "Broker", celda: c => (c.entidad ? escH(c.entidad) : null) },
      { k: "importe", t: "Importe", celda: c => G.fmtEur(c.importe) },
    ];
    if (conCom) cols.push({ k: "comision", t: "Comisión", celda: c => (c.comision ? G.fmtEur(c.comision) : null) });
    if (conUds) cols.push({ k: "porTitulo", t: "Por título", titulo: "Importe entre los títulos anotados en el cobro", celda: c => (c.porTitulo == null ? null : G.fmtEur(c.porTitulo, 4)) });
    if (conNota) cols.push({ k: "nota", t: "Nota", celda: c => (c.nota ? `<span class="izq" title="${escH(c.nota)}">${escH(c.nota.length > 60 ? c.nota.slice(0, 58) + "…" : c.nota)}</span>` : null) });
    // La primera columna (fecha) sale alineada a la izquierda por el CSS del autor; el producto, también.
    tablaOrdenable($("#dmodTablaCobros"), {
      cabecera: "", cols, filas, orden: estado.ordenCobros, comparar,
      ascAlCambiar: k => k === "nombre" || k === "entidad" || k === "nota",
      nota: `<p class="subt dmodNota">Los importes son los que anotaste (lo que te ingresaron). Pulsa en una cabecera para ordenar.</p>`,
    });
  }

  /* ---------------------------------------------- arranque */
  const tab = M.util.pestana({ id: TAB, texto: "Ingr. Pasivos", despuesDe: "rendimiento", pinta,
    titulo: "Ingresos pasivos: dividendos, intereses, cupones y alquileres" });
})();
