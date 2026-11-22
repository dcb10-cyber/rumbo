/* ============================================================
   mods/empresa/comun.js  ·  [mod] Lo común de los apartados de empresa
   ============================================================
   Estilos (clases emod…), a qué productos se aplica y los formatos de números
   que usan dividendos.js, cifras.js y analistas.js. Queda en Mods.empresa.
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M) return;
  const G = window.G;
  const { escH } = M.util;

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
      .emodRejilla{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin:0 0 16px}
      .emodLeyenda i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    `;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------- productos */
  // Acciones y ETF con precio de Yahoo (lo mismo que app/mods/empresa/comun.py).
  const aplica = p => p && p.fuente === "yahoo" && (p.tipoClave === "accion" || p.tipoClave === "etf");
  const esAccion = p => aplica(p) && p.tipoClave === "accion";
  const titulosDe = p => p.titulos != null ? p.titulos : (p.participaciones || 0);
  // Los que tienes hoy (con títulos y valor): los que salen en «Rendimiento».
  const enCartera = todos => (todos || []).filter(p => aplica(p) && titulosDe(p) > 0 && (p.valor || 0) > 0);

  // De la moneda de cotización a euros: con el precio de hoy del propio producto
  // (Rumbo ya lo tiene en euros), así sirve también para peniques, dólares, francos...
  function factorEur(p, e) {
    if ((e.moneda || "").toUpperCase() === "EUR") return 1;
    const nav = p.nav != null ? p.nav : p.precioActual;
    return nav && e.precio ? nav / e.precio : null;
  }

  /* ---------------------------------------------- formatos */
  const SIMBOLOS = { EUR: "€", USD: "$", GBP: "£", GBp: "p", CHF: "CHF", JPY: "¥", CAD: "C$", DKK: "kr", SEK: "kr", NOK: "kr" };
  const nf = (v, d) => v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

  // Importe en su moneda («12,50 $»).
  function fmtNat(v, moneda, dec) {
    if (v == null) return "—";
    const n = v.toLocaleString("es-ES", { minimumFractionDigits: dec == null ? 2 : dec, maximumFractionDigits: dec == null ? 4 : dec });
    return `${n} ${SIMBOLOS[moneda] || moneda || ""}`.trim();
  }

  // Cifras grandes («1,9 mil M $»).
  function fmtGrande(v, moneda) {
    if (v == null) return null;
    const a = Math.abs(v), m = moneda ? " " + (SIMBOLOS[moneda] || moneda) : "";
    if (a >= 1e12) return nf(v / 1e12, 2) + " billones" + m;
    if (a >= 1e9) return nf(v / 1e9, 1) + " mil M" + m;
    if (a >= 1e6) return nf(v / 1e6, 0) + " M" + m;
    return nf(v, 0) + m;
  }

  // Porcentajes: pct/pctS dan «—» si no hay dato; pctC/pctSC dan null (para quitar la casilla).
  // Los «S» llevan signo y color (verde si sube, rojo si baja).
  const pctSigno = (v, d) => `<span class="${v >= 0 ? "pos" : "neg"}">${G.fmtPctSigno(v, d == null ? 1 : d)}</span>`;
  const pct = (v, d) => v == null ? "—" : G.fmtPct(v, d == null ? 2 : d);
  const pctS = (v, d) => v == null ? "—" : pctSigno(v, d);
  const pctC = (v, d) => v == null ? null : G.fmtPct(v, d == null ? 1 : d);
  const pctSC = (v, d) => v == null ? null : pctSigno(v, d);
  const veces = v => v == null ? null : nf(v, v >= 100 ? 0 : 1);
  const anos = n => n ? `${n} ${n === 1 ? "año" : "años"}` : "—";

  /* ---------------------------------------------- trozos de HTML */
  const cargando = (titulo, texto) => `<header><h2>${titulo}</h2></header><p class="emodCargando">${texto}</p>`;
  const kpis = (lista, margen) => `<div class="kpis" style="margin:${margen}">${lista.map(k =>
    `<div class="kpi"><div class="e">${k.e}</div><div class="v">${k.v}</div><div class="n">${k.n}</div></div>`).join("")}</div>`;
  // Primera columna de las tablas: el punto de color del producto y su nombre (extra: HTML detrás).
  const celdaNombre = (color, p, nombre, extra = "") =>
    `<td><i class="pt" style="background:${color ? color(p) : "var(--s1)"}"></i>${escH(nombre)}${extra}</td>`;

  M.empresa = {
    aplica, esAccion, titulosDe, enCartera, factorEur,
    SIMBOLOS, nf, fmtNat, fmtGrande, pct, pctS, pctC, pctSC, veces, anos,
    cargando, kpis, celdaNombre,
  };
})();
