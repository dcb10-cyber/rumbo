/* ============================================================
   mods/pestana_irpf.js  ·  [mod] Pestaña «IRPF»
   ============================================================
   Archivo propio. Todo lo de la Renta de tus inversiones, en un sitio:
     - Resumen del año: base del ahorro, impuesto, deducción por doble imposición,
       retenciones y lo que te falta pagar (o te devuelven).
     - Cómo sale la base del ahorro, paso a paso: dividendos e intereses (brutos) menos
       gastos de custodia, ganancias y pérdidas por ventas, compensación entre ellas
       (máx. 25 %) y pérdidas de años anteriores (hasta 4 años).
     - Ganancias y pérdidas patrimoniales: cada venta (FIFO), como «Para la Renta» del
       autor, que ya no sale en «Rendimiento» (se oculta desde aquí, ver CSS).
     - Dividendos e intereses: retenciones por país, cobro a cobro y los que no tienen
       las retenciones anotadas.
     - Pérdidas pendientes y año a año.
   Datos: /api/dividendos-mod (cobros y retenciones) y /api/irpf-mod (ventas de cada
   año, con el cálculo de app/fiscal.py). Cuentas de cada cobro: Mods.fiscal.calcula.
   Es una estimación para llevar el control, no asesoramiento fiscal.
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || !M.fiscal || !window.G || !window.DATOS) return;
  const G = window.G, D = window.DATOS, F = M.fiscal;
  const { $, escH, tablaOrdenable } = M.util;
  const fuente = M.util.cobros;

  /* ---------------------------------------------- estilos (prefijo imod) */
  if (!document.getElementById("irpfModCss")) {
    const st = document.createElement("style");
    st.id = "irpfModCss";
    st.textContent = `
      /* «Para la Renta» del autor (Rendimiento) se ve ahora aquí, en IRPF */
      #seccionFiscal{display:none !important}
      .imodFiltros{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:24px 0 0}
      #tab-irpf .kpis{margin:18px 0 22px}
      .imodVacio{color:var(--tinta3);font-size:13.5px;line-height:1.6;margin:8px 0}
      .imodNota{margin:12px 0 0;line-height:1.55}
      .imodReclama{display:grid;gap:10px;margin-top:14px}
      .imodReclama > div{border:1px solid var(--borde);border-radius:10px;padding:10px 13px;font-size:13px;line-height:1.5}
      .imodReclama b.v{color:var(--bien);font-variant-numeric:tabular-nums}
      #tab-irpf h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta3);margin:22px 0 10px;font-weight:600}
      #imodTablaCobros th[data-k="nombre"],#imodTablaCobros th[data-k="paisN"]{text-align:left}
      #imodTablaCobros td:has(> .izq){text-align:left}
      table.imodLiq td{white-space:normal}
      table.imodLiq td:first-child{width:70%}
      table.imodLiq tr.sub td{font-weight:650;border-top:1px solid var(--eje)}
      table.imodLiq tr.fin td{font-weight:700;font-size:14px;border-top:2px solid var(--eje)}
      table.imodLiq td small{display:block;color:var(--tinta3);font-weight:400;font-size:11.5px;margin-top:2px}
      table.imodLiq tr.hijo td:first-child{padding-left:30px;color:var(--tinta2)}
    `;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------- ventas de todos los años */
  const ventas = { datos: null, error: null, promesa: null };
  ventas.trae = () => {
    if (location.protocol === "file:") {
      ventas.datos = { anos: [], porAno: {} };
      return Promise.resolve();
    }
    if (!ventas.promesa) {
      ventas.promesa = fetch("api/irpf-mod", { headers: { Accept: "application/json" } })
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          if (!j || !j.ok) ventas.error = (j && j.error) || "No he podido calcular tus ventas.";
          ventas.datos = { anos: (j && j.anos) || [], porAno: (j && j.porAno) || {} };
        })
        .catch(() => { ventas.error = "No he podido calcular tus ventas."; ventas.datos = { anos: [], porAno: {} }; });
    }
    return ventas.promesa;
  };

  /* ---------------------------------------------- utilidades */
  const sum = a => a.reduce((s, x) => s + x, 0);
  const kpisHtml = ks => `<div class="kpis">${ks.map(k =>
    `<div class="kpi"><div class="e">${k.e}</div><div class="v${k.c ? " " + k.c : ""}">${k.v}</div><div class="n">${k.n}</div></div>`).join("")}</div>`;
  const comparar = (a, b) => (typeof a === "string" ? a.localeCompare(b, "es") : a - b);
  const pais = k => (k === "INT" ? "Intereses (cuentas y P2P)" : (F.PAISES[k] || F.PAISES.XX)[0]);
  // País del cobro para agrupar: los intereses, aparte.
  const paisCobro = c => (c.int ? "INT" : c.fiscal.pais || "XX");
  const todosD = () => (D.productos || []).concat(D.otrosActivos || [], D.pasivos || []);
  const colorDe = id => {
    const p = todosD().find(x => x.id === id), c = p && (p.slotColor || p.color);
    return c ? (document.documentElement.dataset.tema !== "claro" ? c[1] : c[0]) : G.css("--tinta3");
  };
  const segm = (cont, opciones, activo, alPulsar) => {
    cont.innerHTML = "";
    opciones.forEach(o => {
      const b = document.createElement("button");
      b.textContent = o.t;
      b.setAttribute("aria-pressed", String(o.k === activo));
      b.addEventListener("click", () => alPulsar(o.k));
      cont.appendChild(b);
    });
  };
  const signo = v => `<span class="${v >= 0 ? "pos" : "neg"}">${G.fmtEurSigno(v)}</span>`;
  const eur0 = v => (Math.abs(v) > 0.005 ? G.fmtEur(v) : "—");
  const nVentas = n => `${n} ${n === 1 ? "venta" : "ventas"}`;

  // Escala del ahorro (estatal + autonómica, régimen común), vigente para 2025 y 2026.
  const TRAMOS = [[6000, 0.19], [50000, 0.21], [200000, 0.23], [300000, 0.27], [Infinity, 0.30]];
  function cuotaAhorro(base) {
    let resto = Math.max(0, base), desde = 0, cuota = 0;
    for (const [hasta, t] of TRAMOS) {
      const tramo = Math.min(resto, hasta - desde);
      cuota += tramo * t; resto -= tramo; desde = hasta;
      if (resto <= 0) break;
    }
    return cuota;
  }

  /* ================================================================
     LIQUIDACIÓN DE CADA AÑO (base del ahorro)
     ================================================================
     Artículo 49 de la Ley del IRPF, simplificado:
       1. Saldo de rendimientos del capital mobiliario (RCM) = dividendos, intereses y cupones
          brutos − gastos de administración y custodia.
       2. Saldo de ganancias y pérdidas patrimoniales (GP) = lo ganado − lo perdido en ventas.
       3. Si uno sale negativo, se compensa con el otro positivo, como mucho el 25 % de ese otro.
       4. Lo negativo que sobra se compensa en los 4 años siguientes: primero con el mismo tipo de
          renta (sin límite) y luego con el otro, con el mismo límite del 25 % (compartido con el paso 3).
       5. Base del ahorro = lo positivo que queda; se le aplica la escala del ahorro.
  */
  function liquida(anos, datosAno) {
    const res = {};
    let pendGP = [], pendRCM = [];   // [{ano, importe}] pérdidas por compensar (importe > 0)
    anos.forEach(Y => {
      const d = datosAno(Y);
      const pasos = { rcmBruto: d.rcmBruto, gastos: d.gastos, ganancias: d.ganancias, perdidas: d.perdidas };
      let rcm = d.rcmBruto - d.gastos, gp = d.ganancias + d.perdidas;   // pérdidas en negativo
      pasos.saldoRCM = rcm; pasos.saldoGP = gp;
      // límite del 25 % de cada saldo positivo para compensar con el otro tipo de renta
      let lim25conRCM = 0.25 * Math.max(0, rcm);   // para pérdidas de GP
      let lim25conGP = 0.25 * Math.max(0, gp);     // para RCM negativos
      pasos.compAno = 0; pasos.compAnoRCM = 0;
      const vigentes = l => l.filter(x => +Y - +x.ano <= 4 && x.importe > 0.005);
      pendGP = vigentes(pendGP); pendRCM = vigentes(pendRCM);
      const nuevasGP = [], nuevasRCM = [];
      // 3. Compensación dentro del año
      if (gp < 0) {
        const c = Math.min(-gp, lim25conRCM);
        rcm -= c; lim25conRCM -= c; gp += c; pasos.compAno = c;
        if (gp < 0) nuevasGP.push({ ano: Y, importe: -gp });
        gp = 0;
      }
      if (rcm < 0) {
        const c = Math.min(-rcm, lim25conGP);
        gp -= c; lim25conGP -= c; rcm += c; pasos.compAnoRCM = c;
        if (rcm < 0) nuevasRCM.push({ ano: Y, importe: -rcm });
        rcm = 0;
      }
      // 4. Pérdidas de años anteriores (las más antiguas primero)
      const aplicadas = [];
      const usa = (lista, tipo, contra) => {
        lista.forEach(x => {
          let quedaCon = contra === "gp" ? gp : contra === "rcm" ? rcm : 0;
          if (contra === "gp-25") quedaCon = Math.min(gp, lim25conGP);
          if (contra === "rcm-25") quedaCon = Math.min(rcm, lim25conRCM);
          const c = Math.min(x.importe, Math.max(0, quedaCon));
          if (c <= 0.005) return;
          x.importe -= c;
          if (contra === "gp" || contra === "gp-25") gp -= c;
          if (contra === "rcm" || contra === "rcm-25") rcm -= c;
          if (contra === "gp-25") lim25conGP -= c;
          if (contra === "rcm-25") lim25conRCM -= c;
          aplicadas.push({ ano: x.ano, tipo, contra: contra.startsWith("gp") ? "ventas" : "dividendos e intereses", importe: c });
        });
      };
      usa(pendGP, "pérdidas por ventas", "gp");
      usa(pendRCM, "rendimientos negativos", "rcm");
      usa(pendGP, "pérdidas por ventas", "rcm-25");
      usa(pendRCM, "rendimientos negativos", "gp-25");
      pendGP = vigentes(pendGP.concat(nuevasGP));
      pendRCM = vigentes(pendRCM.concat(nuevasRCM));
      pasos.aplicadas = aplicadas;
      pasos.baseRCM = Math.max(0, rcm); pasos.baseGP = Math.max(0, gp);
      pasos.base = pasos.baseRCM + pasos.baseGP;
      pasos.cuota = cuotaAhorro(pasos.base);
      pasos.tm = pasos.base ? pasos.cuota / pasos.base : F.TIPO_ES;
      // Deducción por doble imposición y retenciones de cada cobro (con el tipo medio del año)
      pasos.cs = d.con.map(c => ({ ...c, r: F.calcula(c.fiscal, pasos.tm) }));
      const tot = k => sum(pasos.cs.map(x => x.r[k]));
      // La deducción nunca puede pasar del impuesto que te corresponde.
      pasos.origen = tot("origen"); pasos.espana = tot("espana"); pasos.deducible = Math.min(tot("deducible"), pasos.cuota);
      pasos.reclamable = tot("reclamable"); pasos.perdido = tot("perdido");
      pasos.resultado = pasos.cuota - pasos.deducible - pasos.espana;
      pasos.pendientes = pendGP.map(x => ({ ...x, tipo: "pérdidas por ventas" }))
        .concat(pendRCM.map(x => ({ ...x, tipo: "rendimientos negativos" })));
      pasos.d = d;
      res[Y] = pasos;
    });
    return res;
  }

  /* ---------------------------------------------- estado */
  const estado = { ano: null, orden: { k: "fecha", asc: false } };

  /* ================================================================
     PINTAR
     ================================================================ */
  function pinta(panel) {
    if (fuente.datos === null || ventas.datos === null) {
      panel.innerHTML = `<section class="tarjeta" style="margin-top:24px"><p class="imodVacio">Preparando tus datos de la Renta…</p></section>`;
      Promise.all([fuente.trae(), ventas.trae()]).then(() => tab.pinta());
      return;
    }
    // Hoy de verdad (no la fecha de los últimos precios): un cobro de hoy no es «futuro».
    const hoy = M.util.hoy();
    const info = fuente.datos.productos;
    // Base del ahorro: dividendos, intereses y cupones (los alquileres van a la base general).
    const cobros = fuente.datos.cobros
      .filter(c => c.fecha <= hoy && !(info[c.producto] && info[c.producto].tipo === "inmueble"))
      .map(c => ({ ...c, nombre: (info[c.producto] && info[c.producto].corto) || c.producto,
        conFis: !!(c.fiscal && c.fiscal.bruto > 0),
        int: !!(info[c.producto] && ["efectivo", "p2p"].includes(info[c.producto].tipo)) }));
    const V = ventas.datos.porAno;

    const setAnos = new Set(cobros.map(c => c.fecha.slice(0, 4)).concat(ventas.datos.anos));
    if (!setAnos.size) {
      panel.innerHTML = `<section class="tarjeta" style="margin-top:24px"><header><h2>IRPF</h2></header>
        <p class="imodVacio">${escH(fuente.error || ventas.error || "Todavía no tienes ventas, dividendos ni intereses anotados.")}</p></section>`;
      return;
    }
    const min = Math.min(...[...setAnos].map(Number)), max = Math.max(+hoy.slice(0, 4), ...[...setAnos].map(Number));
    const anos = [];
    for (let a = min; a <= max; a++) anos.push(String(a));
    if (!estado.ano || !anos.includes(estado.ano)) estado.ano = hoy.slice(0, 4);
    const ano = estado.ano;

    const datosAno = Y => {
      const delA = cobros.filter(c => c.fecha.startsWith(Y));
      const con = delA.filter(c => c.conFis), sin = delA.filter(c => !c.conFis);
      const v = V[Y] || { ventas: [], rescates: [], comisiones: [], totales: {}, avisos: [], csv: "" };
      return {
        con, sin, v,
        rcmBruto: sum(con.map(c => c.fiscal.bruto)),
        gastos: sum((v.comisiones || []).map(x => x.importe)),
        ganancias: (v.totales && v.totales.ganancias) || 0,
        perdidas: (v.totales && v.totales.perdidas) || 0,
      };
    };
    const L = liquida(anos, datosAno);
    const l = L[ano];

    panel.innerHTML = `
      <div class="imodFiltros"><span class="subt">Año de la Renta</span><div class="segm" id="imodAno"></div></div>
      ${ventas.error ? `<div class="av" style="margin-top:14px"><span>⚠</span><span>${escH(ventas.error)}</span></div>` : ""}
      <div id="imodResumen"></div>
      <section class="tarjeta" id="imodLiq">
        <header><h2>Cómo sale tu base del ahorro ${ano}</h2><span class="subt">Dividendos, intereses y ventas, todo junto</span></header>
        <div id="imodLiqCuerpo"></div>
      </section>
      <section class="tarjeta" id="imodVentas">
        <header><h2>Ganancias y pérdidas por ventas</h2><span class="subt">Acciones, ETF, fondos, cripto… con FIFO, como Hacienda</span></header>
        <div id="imodVentasCuerpo"></div>
      </section>
      <section class="tarjeta" id="imodPais">
        <header><h2>Dividendos e intereses: retenciones</h2><span class="subt">Lo que te retienen fuera y qué pasa con ello</span></header>
        <div id="imodPaisCuerpo"></div>
      </section>
      <section class="tarjeta" id="imodCobros">
        <header><h2>Cobro a cobro</h2><span class="subt" id="imodCobrosNota"></span></header>
        <div id="imodTablaCobros"></div>
      </section>
      <section class="tarjeta" id="imodSin">
        <header><h2>Cobros sin retenciones anotadas</h2><span class="subt" id="imodSinNota"></span></header>
        <div id="imodSinCuerpo"></div>
      </section>
      <section class="tarjeta" id="imodAnos">
        <header><h2>Año a año</h2><span class="subt">Con los cobros que tienen las retenciones anotadas y todas las ventas</span></header>
        <div class="tablaEnv"><table class="dt" id="imodTablaAnos"></table></div>
      </section>
      <section class="tarjeta">
        <header><h2>Cómo se calcula</h2></header>
        <p class="subt imodNota" style="margin:0"><b>Base del ahorro.</b> Se suman, por un lado, los dividendos, intereses y
          cupones <b>brutos</b> menos los gastos de custodia y administración (las comisiones que anotaste aparte) y, por otro,
          las ganancias y pérdidas de tus ventas (FIFO; los traspasos entre fondos conservan coste y fecha). Si uno de los dos
          sale negativo, se compensa con el otro hasta el 25 % de ese otro; lo que sobra se puede compensar en los 4 años
          siguientes. Al total se le aplica la escala del ahorro (19 % hasta 6.000 €, 21 % hasta 50.000 €, 23 % hasta 200.000 €,
          27 % hasta 300.000 € y 30 % por encima).</p>
        <p class="subt imodNota"><b>Doble imposición.</b> Por cada dividendo extranjero deduces lo menor entre lo que te
          retuvieron fuera (como mucho, el % del convenio) y lo que pagarías aquí por él (con el tipo medio del año). Lo
          retenido por encima del convenio se reclama al país de origen; sin convenio (por ejemplo, Dinamarca), lo que pase de
          lo que pagarías en España se pierde. Lo que te retiene un bróker español es un pago a cuenta.</p>
        <p class="subt imodNota"><b>Lo que no está.</b> Los dividendos sin el bruto anotado no entran (aparecen aparte). Las
          retenciones que te hacen los fondos españoles al venderlos, las ganancias de otros sitios (un piso, una
          herencia…), los alquileres (van a la base general) y los rescates de planes de pensiones (son rendimientos del
          trabajo) tampoco. Es una estimación para llevar el control, no asesoramiento fiscal: compárala con los datos
          fiscales de tu banco y con el borrador.</p>
      </section>`;
    segm($("#imodAno"), anos.slice().reverse().map(a => ({ k: a, t: a })), ano, k => { estado.ano = k; tab.pinta(); });

    pintaResumen(l, ano, +hoy.slice(0, 4));
    pintaLiquidacion(l, ano);
    pintaVentas(l.d.v, ano);
    pintaPais(l);
    pintaCobros(l, ano);
    pintaSin(l.d.sin, ano);
    pintaAnos(L, anos);
  }

  /* ---------------------------------------------- resumen del año */
  function pintaResumen(l, ano, anoHoy) {
    const hay = l.base > 0.005 || l.d.con.length || l.d.v.ventas.length || l.pendientes.length;
    if (!hay) {
      $("#imodResumen").innerHTML = `<section class="tarjeta" style="margin-top:18px"><p class="imodVacio">En ${ano} no hay
        ventas ni cobros con el bruto y las retenciones anotados.${l.d.sin.length ? ` Tienes ${l.d.sin.length} cobros sin
        retenciones: complétalos (Mis datos → Movimientos → Editar) para que cuenten.` : ""}</p></section>`;
      return;
    }
    const pend = sum(l.pendientes.map(x => x.importe));
    const ks = [
      { e: "Base del ahorro", v: G.fmtEur(l.base), n: `${G.fmtEur(l.baseRCM, 0)} de cobros + ${G.fmtEur(l.baseGP, 0)} de ventas` },
      { e: "Impuesto", v: G.fmtEur(l.cuota), n: `tipo medio ${G.fmtPct(l.tm, 2)} (escala del ahorro)` },
      { e: "Doble imposición", v: G.fmtEur(l.deducible), n: "lo que deduces por lo retenido fuera" },
      { e: "Retenido en España", v: G.fmtEur(l.espana), n: "pagos a cuenta de tus brókers" },
      { e: l.resultado >= 0 ? "Te falta pagar" : "Te devuelven", v: G.fmtEur(Math.abs(l.resultado)),
        c: l.resultado >= 0 ? "neg" : "pos", n: `en la Renta ${ano}, estimado${+ano === anoHoy ? " (año en curso)" : ""}` },
    ];
    if (l.reclamable > 0.005) ks.push({ e: "Reclamable en origen", v: G.fmtEur(l.reclamable), c: "pos", n: "retenido de más fuera" });
    if (l.perdido > 0.005) ks.push({ e: "Se pierde", v: G.fmtEur(l.perdido), c: "neg", n: "retenido en países sin convenio" });
    if (pend > 0.005) ks.push({ e: "Pérdidas para después", v: G.fmtEur(pend), n: "pendientes de compensar (4 años)" });
    $("#imodResumen").innerHTML = kpisHtml(ks) + (l.d.sin.length ? `<p class="subt" style="margin:-10px 0 18px">⚠ ${l.d.sin.length}
      cobros de ${ano} (${G.fmtEur(sum(l.d.sin.map(c => c.importe)))} netos) no tienen el bruto ni las retenciones anotados y
      <b>no entran en estas cuentas</b>: los tienes más abajo, en «Cobros sin retenciones anotadas».</p>` : "");
  }

  /* ---------------------------------------------- liquidación paso a paso */
  function pintaLiquidacion(l, ano) {
    const fila = (t, v, cls, nota) => `<tr class="${cls || ""}"><td>${t}${nota ? `<small>${nota}</small>` : ""}</td><td>${v}</td></tr>`;
    const menos = v => (v > 0.005 ? "−" + G.fmtEur(v) : "—");
    let h = "";
    h += fila("Dividendos, intereses y cupones (bruto)", G.fmtEur(l.rcmBruto), "", `${l.d.con.length} cobros con el bruto anotado`);
    if (l.gastos) h += fila("Gastos de custodia y administración", menos(l.gastos), "hijo", "las comisiones que anotaste aparte de compras y ventas");
    h += fila("Rendimientos del capital mobiliario", signo(l.saldoRCM), "sub");
    h += fila("Ganancias por ventas", G.fmtEur(l.ganancias), "", `${nVentas(l.d.v.ventas.filter(v => v.ganancia > 0).length)} con ganancia`);
    h += fila("Pérdidas por ventas", l.perdidas ? signo(l.perdidas) : "—", "", `${nVentas(l.d.v.ventas.filter(v => v.ganancia < 0).length)} con pérdida`);
    h += fila("Ganancias y pérdidas patrimoniales", signo(l.saldoGP), "sub");
    if (l.compAno > 0.005) h += fila("Pérdidas de este año compensadas con dividendos e intereses", menos(l.compAno), "hijo",
      `como mucho el 25 % de los rendimientos (${G.fmtEur(0.25 * Math.max(0, l.saldoRCM))})`);
    if (l.compAnoRCM > 0.005) h += fila("Rendimientos negativos compensados con las ventas", menos(l.compAnoRCM), "hijo", "como mucho el 25 % de las ganancias");
    l.aplicadas.forEach(a => {
      h += fila(`${a.tipo.charAt(0).toUpperCase() + a.tipo.slice(1)} de ${a.ano} compensadas con ${a.contra}`, menos(a.importe), "hijo",
        a.contra === "ventas" ? "sin límite" : "dentro del límite del 25 %");
    });
    h += fila("Base liquidable del ahorro", G.fmtEur(l.base), "sub");
    h += fila("Impuesto (escala del ahorro)", G.fmtEur(l.cuota), "", `tipo medio ${G.fmtPct(l.tm, 2)}`);
    h += fila("Deducción por doble imposición internacional", menos(l.deducible), "hijo");
    h += fila("Retenciones en España", menos(l.espana), "hijo", "pagos a cuenta");
    h += fila(l.resultado >= 0 ? "Te falta pagar" : "Te devuelven", `<span class="${l.resultado >= 0 ? "neg" : "pos"}">${G.fmtEur(Math.abs(l.resultado))}</span>`, "fin");
    const pend = l.pendientes.filter(x => x.importe > 0.005);
    $("#imodLiqCuerpo").innerHTML = `<div class="tablaEnv"><table class="dt imodLiq"><tbody>${h}</tbody></table></div>` +
      (pend.length ? `<h3>Pendiente de compensar en los años siguientes</h3>
        <div class="tablaEnv"><table class="dt"><thead><tr><th>De</th><th>Qué es</th><th>Pendiente</th><th>Último año para usarlo</th></tr></thead>
        <tbody>${pend.map(x => `<tr><td>${x.ano}</td><td>${escH(x.tipo)}</td><td>${G.fmtEur(x.importe)}</td><td>${+x.ano + 4}</td></tr>`).join("")}</tbody></table></div>` : "") +
      (l.d.sin.length ? `<p class="subt imodNota">⚠ Faltan ${l.d.sin.length} cobros de ${ano} sin el bruto anotado: con ellos la base
        sería mayor.</p>` : "");
  }

  /* ---------------------------------------------- ventas (lo de «Para la Renta» del autor) */
  function pintaVentas(v, ano) {
    const cont = $("#imodVentasCuerpo");
    const t = v.totales || {};
    const nv = v.ventas.length;
    const fechasCompra = x => {
      const fs = [...new Set((x.compras || []).map(c => c.fecha))].sort();
      if (!fs.length) return "—";
      return fs.length === 1 ? G.fmtFecha(fs[0]) : `${G.fmtFecha(fs[0])} a ${G.fmtFecha(fs[fs.length - 1])} (${fs.length} compras)`;
    };
    let h = "";
    if (!nv) h += `<p class="imodVacio">En ${ano} no vendiste nada.</p>`;
    else {
      h += kpisHtml([
        { e: "Ganancias", v: G.fmtEur(t.ganancias || 0), n: nVentas(v.ventas.filter(x => x.ganancia > 0).length) },
        { e: "Pérdidas", v: t.perdidas ? signo(t.perdidas) : "—", n: nVentas(v.ventas.filter(x => x.ganancia < 0).length) },
        { e: "Saldo", v: signo(t.saldo || 0), n: `en ${nv} ${nv === 1 ? "venta" : "ventas"}` },
        { e: "Vendido", v: G.fmtEur(t.transmision || 0), n: `costó ${G.fmtEur(t.adquisicion || 0)}` },
      ]).replace('class="kpis"', 'class="kpis" style="margin:0 0 16px"');
      h += `<div class="tablaEnv"><table class="dt"><thead><tr><th>Producto</th><th>Vendido el</th><th>Comprado el</th>
          <th>Transmisión</th><th>Adquisición</th><th>Ganancia o pérdida</th></tr></thead>
        <tbody>${v.ventas.map(x => `<tr>
          <td>${escH(x.nombre)}<span class="fiscalRevisar">${x.isin ? escH(x.isin) + " · " : ""}${escH(x.tipo)}</span>
            ${(x.avisos || []).map(a => `<span class="fiscalRevisar">⚠ ${escH(a)}</span>`).join("")}</td>
          <td>${G.fmtFecha(x.fecha)}</td><td>${fechasCompra(x)}</td>
          <td>${G.fmtEur(x.transmision)}</td><td>${x.adquisicion != null ? G.fmtEur(x.adquisicion) : "—"}</td>
          <td>${signo(x.ganancia)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td></td><td></td><td>${G.fmtEur(t.transmision || 0)}</td><td>${G.fmtEur(t.adquisicion || 0)}</td>
          <td>${signo(t.saldo || 0)}</td></tr></tfoot></table></div>`;
    }
    if ((v.comisiones || []).length) {
      h += `<h3>Gastos de custodia y otras comisiones aparte</h3>
        <div class="tablaEnv"><table class="dt"><thead><tr><th>Producto</th><th>Importe</th></tr></thead>
        <tbody>${v.comisiones.map(x => `<tr><td>${escH(x.nombre)}</td><td>${G.fmtEur(x.importe)}</td></tr>`).join("")}</tbody></table></div>
        <p class="subt imodNota">Se restan de los dividendos e intereses como gastos de administración y depósito. Si alguna no
          lo es, no la cuentes en el borrador.</p>`;
    }
    if ((v.rescates || []).length) {
      h += `<h3>Rescates de planes de pensiones</h3>
        <div class="tablaEnv"><table class="dt"><thead><tr><th>Plan</th><th>Fecha</th><th>Rescatado</th></tr></thead>
        <tbody>${v.rescates.map(x => `<tr><td>${escH(x.nombre)}</td><td>${G.fmtFecha(x.fecha)}</td><td>${G.fmtEur(x.transmision)}</td></tr>`).join("")}</tbody></table></div>
        <p class="subt imodNota">No entran en la base del ahorro: tributan como rendimientos del trabajo (todo lo rescatado).</p>`;
    }
    const avisos = (v.avisos || []).filter(a => !/^Dividendos, cupones e intereses: van como los anotaste/.test(a));
    h += avisos.map(a => `<div class="av" style="margin-top:12px"><span>⚠</span><span>${escH(a)}</span></div>`).join("");
    if (v.csv) h += `<p style="margin:16px 0 0"><a class="btn" id="imodBajar">Descargar el resumen de ${ano} en Excel (CSV)</a></p>`;
    cont.innerHTML = h;
    const bajar = $("#imodBajar");
    if (bajar) {
      bajar.href = URL.createObjectURL(new Blob(["﻿" + v.csv], { type: "text/csv;charset=utf-8" }));
      bajar.download = `rumbo_renta_${ano}.csv`;
    }
  }

  /* ---------------------------------------------- dividendos por país */
  function pintaPais(l) {
    const cont = $("#imodPaisCuerpo");
    if (!l.cs.length) {
      cont.innerHTML = `<p class="imodVacio">Ningún cobro de este año tiene el bruto y las retenciones anotados.</p>`;
      return;
    }
    const porPais = new Map();
    l.cs.forEach(c => {
      const k = paisCobro(c);
      let x = porPais.get(k);
      if (!x) { x = { pais: k, n: 0, bruto: 0, origen: 0, ded: 0, rec: 0, per: 0, esp: 0, conv: new Set() }; porPais.set(k, x); }
      x.n++; x.bruto += c.r.bruto; x.origen += c.r.origen; x.ded += c.r.deducible; x.rec += c.r.reclamable;
      x.per += c.r.perdido; x.esp += c.r.espana;
      x.conv.add(k === "ES" || k === "INT" ? "—" : c.r.convenio == null ? "sin convenio" : G.fmtPct(c.r.convenio, 0));
    });
    const filas = [...porPais.values()].sort((a, b) => b.bruto - a.bruto);
    const reclamar = filas.filter(x => x.rec > 0.005);
    cont.innerHTML = `
      <div class="tablaEnv"><table class="dt">
        <thead><tr><th>País</th><th>Cobros</th><th>Bruto</th><th>Retenido en origen</th><th>Convenio</th>
          <th>Deduces</th><th>Reclamable</th><th>Se pierde</th><th>Retenido en España</th></tr></thead>
        <tbody>${filas.map(x => `<tr><td>${escH(pais(x.pais))}</td><td>${x.n}</td><td>${G.fmtEur(x.bruto)}</td>
          <td>${G.fmtEur(x.origen)} <small>${G.fmtPct(x.bruto ? x.origen / x.bruto : 0, 1)}</small></td>
          <td>${[...x.conv].join(", ")}</td><td>${G.fmtEur(x.ded)}</td>
          <td class="${x.rec > 0.005 ? "pos" : ""}">${eur0(x.rec)}</td>
          <td class="${x.per > 0.005 ? "neg" : ""}">${eur0(x.per)}</td>
          <td>${G.fmtEur(x.esp)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td>${l.cs.length}</td><td>${G.fmtEur(l.rcmBruto)}</td><td>${G.fmtEur(l.origen)}</td><td></td>
          <td>${G.fmtEur(l.deducible)}</td><td>${eur0(l.reclamable)}</td><td>${eur0(l.perdido)}</td>
          <td>${G.fmtEur(l.espana)}</td></tr></tfoot>
      </table></div>
      ${reclamar.length ? `<div class="imodReclama">${reclamar.map(x => `<div><b>${escH(pais(x.pais))}</b>: puedes reclamar
        <b class="v">${G.fmtEur(x.rec)}</b>. ${escH(F.NOTAS[x.pais] || "Pídelo a la administración de ese país con tu certificado de residencia fiscal.")}</div>`).join("")}</div>` : ""}
      ${filas.some(x => x.per > 0.005) ? `<p class="subt imodNota">${escH(F.NOTAS.DK)}</p>` : ""}`;
  }

  /* ---------------------------------------------- cobro a cobro */
  function pintaCobros(l, ano) {
    if (!l.cs.length) { $("#imodCobros").hidden = true; return; }
    $("#imodCobrosNota").textContent = `${l.cs.length} cobros de ${ano} con las retenciones anotadas`;
    const filas = l.cs.map(c => ({ ...c, paisN: pais(paisCobro(c)), bruto: c.r.bruto, origen: c.r.origen,
      conv: c.fiscal.pais === "ES" ? null : c.r.convenio, ded: c.r.deducible, rec: c.r.reclamable, per: c.r.perdido,
      esp: c.r.espana, neto: c.importe }));
    const eur = v => (v > 0.005 ? G.fmtEur(v) : null);
    tablaOrdenable($("#imodTablaCobros"), {
      cabecera: "",
      cols: [
        { k: "fecha", t: "Fecha", celda: c => G.fmtFecha(c.fecha) },
        { k: "nombre", t: "Producto", celda: c => `<td style="text-align:left"><i class="pt" style="background:${colorDe(c.producto)}"></i>${escH(c.nombre)}</td>` },
        { k: "paisN", t: "País", celda: c => `<span class="izq">${escH(c.paisN)}</span>` },
        { k: "bruto", t: "Bruto", celda: c => G.fmtEur(c.bruto) },
        { k: "origen", t: "Ret. origen", celda: c => `${G.fmtEur(c.origen)} <small>${G.fmtPct(c.bruto ? c.origen / c.bruto : 0, 1)}</small>` },
        { k: "conv", t: "Convenio", celda: c => (c.fiscal.pais === "ES" ? null : c.conv == null ? "sin convenio" : G.fmtPct(c.conv, 0)) },
        { k: "ded", t: "Deduces", celda: c => eur(c.ded) },
        { k: "rec", t: "Reclamable", celda: c => (c.rec > 0.005 ? `<span class="pos">${G.fmtEur(c.rec)}</span>` : null) },
        { k: "per", t: "Se pierde", celda: c => (c.per > 0.005 ? `<span class="neg">${G.fmtEur(c.per)}</span>` : null) },
        { k: "esp", t: "Ret. España", celda: c => eur(c.esp) },
        { k: "neto", t: "Te ingresaron", celda: c => G.fmtEur(c.neto) },
      ],
      filas, orden: estado.orden, comparar,
      ascAlCambiar: k => k === "nombre" || k === "paisN",
      nota: `<p class="subt imodNota">«Deduces» se calcula con el tipo medio del año. Para cambiar un cobro, edítalo en
        Mis datos → Movimientos.</p>`,
    });
  }

  /* ---------------------------------------------- sin datos fiscales */
  function pintaSin(sin, ano) {
    if (!sin.length) { $("#imodSin").hidden = true; return; }
    $("#imodSinNota").textContent = `${sin.length} cobros de ${ano} · ${G.fmtEur(sum(sin.map(c => c.importe)))} netos`;
    const porProd = new Map();
    sin.forEach(c => {
      let x = porProd.get(c.producto);
      if (!x) { x = { id: c.producto, nombre: c.nombre, n: 0, neto: 0, ultimo: c.fecha }; porProd.set(c.producto, x); }
      x.n++; x.neto += c.importe; x.ultimo = c.fecha;
    });
    const filas = [...porProd.values()].sort((a, b) => b.neto - a.neto);
    $("#imodSinCuerpo").innerHTML = `
      <div class="tablaEnv"><table class="dt">
        <thead><tr><th>Producto</th><th>Cobros</th><th>Te ingresaron</th><th>Último</th></tr></thead>
        <tbody>${filas.map(x => `<tr><td><i class="pt" style="background:${colorDe(x.id)}"></i>${escH(x.nombre)}</td>
          <td>${x.n}</td><td>${G.fmtEur(x.neto)}</td><td>${G.fmtFecha(x.ultimo)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="subt imodNota">Para que cuenten: Mis datos → Movimientos, edita cada uno y escribe el bruto (sale en el
        extracto del bróker). Lo demás se rellena solo y lo puedes corregir.</p>`;
  }

  /* ---------------------------------------------- año a año */
  function pintaAnos(L, anos) {
    const filas = anos.slice().reverse().map(a => ({ a, l: L[a] }))
      .filter(({ l }) => l.d.con.length || l.d.sin.length || l.d.v.ventas.length || l.pendientes.length);
    const e = v => (Math.abs(v) > 0.005 ? G.fmtEur(v) : "—");
    $("#imodTablaAnos").innerHTML = `
      <thead><tr><th>Año</th><th title="Cobros con el bruto anotado / todos">Cobros anotados</th><th>Rend. capital</th>
        <th>Ventas</th><th>Base del ahorro</th><th>Impuesto</th><th>Doble imp.</th><th>Ret. España</th>
        <th>Falta pagar / devuelven</th><th>Pérdidas para después</th></tr></thead>
      <tbody>${filas.map(({ a, l }) => {
        const pend = sum(l.pendientes.map(x => x.importe));
        return `<tr><td>${a}</td><td>${l.d.con.length} de ${l.d.con.length + l.d.sin.length}</td>
          <td>${signo(l.saldoRCM)}</td><td>${l.d.v.ventas.length ? signo(l.saldoGP) : "—"}</td>
          <td>${G.fmtEur(l.base)}</td><td>${e(l.cuota)}</td><td>${e(l.deducible)}</td><td>${e(l.espana)}</td>
          <td class="${l.resultado >= 0 ? "neg" : "pos"}">${Math.abs(l.resultado) > 0.005 ? (l.resultado >= 0 ? "" : "−") + G.fmtEur(Math.abs(l.resultado)) +
            ` <small>${l.resultado >= 0 ? "a pagar" : "a devolver"}</small>` : "—"}</td>
          <td>${e(pend)}</td></tr>`;
      }).join("")}</tbody>`;
  }

  /* ---------------------------------------------- arranque */
  const tab = M.util.pestana({ id: "irpf", texto: "IRPF", despuesDe: "dividendos", pinta,
    titulo: "La Renta de tus inversiones: ventas, dividendos, intereses y retenciones" });
})();
