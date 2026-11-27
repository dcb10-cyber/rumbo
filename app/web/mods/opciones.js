/* ============================================================
   mods/opciones.js  ·  [mod] Pestaña «Opciones» (solo lectura, lo da Caudal)
   ============================================================
   Archivo propio. Rumbo no entiende de opciones: aquí solo se enseña lo que manda Caudal
   (/api/caudal-mod/opciones, que lee la foto guardada al sincronizar):
     - abiertas con su DTE, calendario de vencimientos por semanas,
     - campañas de la rueda y resultados por año (con el criterio de Caudal).
   Sin formularios: se apuntan en Caudal. Sale después de la pestaña «Caudal» (que crea caudal.js
   solo con la sincronización activa).
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || !window.G || location.protocol === "file:") return;
  const G = window.G;
  const { escH } = M.util;
  let datos = null, tab = null;

  const css = document.createElement("style");
  css.id = "omodEstilos";
  css.textContent = `
    #tab-opciones .tarjeta{margin-top:18px}
    #tab-opciones .dt td.izq,#tab-opciones .dt th.izq{text-align:left}
    .omodDte{display:inline-block;font-size:11.5px;font-weight:650;border-radius:999px;padding:1px 8px}
    .omodDte.rojo{background:var(--mal);color:#fff} .omodDte.ambar{background:var(--aviso);color:#111}`;
  document.head.appendChild(css);

  const num = (v, d = 2) => Number(v || 0).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: d });
  const signo = v => `<span class="${v >= 0 ? "pos" : "neg"}">${G.fmtEurSigno(v)}</span>`;
  const NOMBRE = { btc: "Recompra", stc: "Venta para cerrar", vencida: "Vencida", asignada: "Asignada", ejercida: "Ejercida" };

  function lunes(iso) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }

  function pinta(panel) {
    if (!datos) {
      panel.innerHTML = '<section class="tarjeta"><p class="subt">Cargando las opciones de Caudal…</p></section>';
      return;
    }
    if (!datos.disponible) {
      panel.innerHTML = `<section class="tarjeta"><header><h2>Opciones</h2></header>
        <p class="subt">${escH(datos.aviso || "Todavía no hay opciones de Caudal. Se apuntan en Caudal y llegan al sincronizar.")}</p></section>`;
      return;
    }
    const ab = datos.abiertas || [];
    const semanas = new Map();
    ab.forEach(a => { const k = lunes(a.contrato.vencimiento); if (!semanas.has(k)) semanas.set(k, []); semanas.get(k).push(a); });
    const irpf = datos.irpf || { porAno: {} };
    const anos = Object.keys(irpf.porAno).sort().reverse();
    const crit = irpf.criterio === "broker" ? "Lo que da el bróker" : "Criterio DGT";
    panel.innerHTML = `
      <section class="tarjeta"><header><h2>Opciones abiertas</h2>
        <span class="subt">Se apuntan en Caudal · datos del ${escH((datos.comprobado || "").slice(0, 10))}</span></header>
        ${datos.aviso ? `<div class="av"><span>⚠</span><span>${escH(datos.aviso)}</span></div>` : ""}
        ${ab.length ? `<div class="tablaEnv"><table class="dt"><thead><tr><th class="izq">Contrato</th><th>Contratos</th>
          <th>Prima neta</th><th>DTE</th><th>Capital en riesgo</th><th>Campaña</th></tr></thead><tbody>
          ${ab.map(a => `<tr><td class="izq"><b>${escH(a.contrato.nombre)}</b> <small class="subt">${a.lado === "corta" ? "vendida" : "comprada"}</small></td>
            <td>${a.lado === "corta" ? "−" : "+"}${num(a.contratos, 4)}</td><td>${G.fmtEur(a.prima_neta_eur)}</td>
            <td>${a.dte <= 7 ? '<span class="omodDte rojo">' : a.dte <= 21 ? '<span class="omodDte ambar">' : "<span>"}${a.dte}</span></td>
            <td>${G.fmtEur(a.capital_riesgo_eur)}</td><td>${a.campana_id ? "nº " + a.campana_id : "—"}</td></tr>`).join("")}
          </tbody></table></div>` : '<p class="subt">No tienes opciones abiertas.</p>'}
      </section>
      <section class="tarjeta"><header><h2>Calendario de vencimientos</h2><span class="subt">Por semanas</span></header>
        ${semanas.size ? `<div class="tablaEnv"><table class="dt"><thead><tr><th class="izq">Semana del</th><th class="izq">Vencen</th>
          <th>Capital</th></tr></thead><tbody>${[...semanas.entries()].sort().map(([k, l]) => `<tr><td class="izq">${G.fmtFecha(k)}</td>
          <td class="izq">${l.map(a => escH(a.contrato.nombre)).join(" · ")}</td>
          <td>${G.fmtEur(l.reduce((s, a) => s + a.capital_riesgo_eur, 0))}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="subt">Nada que venza.</p>'}
      </section>
      <section class="tarjeta"><header><h2>Campañas (la rueda)</h2><span class="subt">La prima baja tu punto muerto, no tu coste fiscal</span></header>
        ${(datos.campanas || []).length ? `<div class="tablaEnv"><table class="dt"><thead><tr><th class="izq">Subyacente</th><th>Estado</th>
          <th>Días</th><th>P/L</th><th>Anualizada</th><th>Coste ajustado</th><th>Coste fiscal</th></tr></thead><tbody>
          ${datos.campanas.map(c => `<tr><td class="izq">${escH((c.subyacente && (c.subyacente.ticker || c.subyacente.nombre)) || "—")}
            <small class="subt">desde ${G.fmtFecha(c.inicio)}</small></td><td>${c.estado === "abierta" ? "Abierta" : "Cerrada " + G.fmtFecha(c.fin)}</td>
            <td>${c.dias}</td><td>${signo(c.pl_eur)}</td><td>${c.anualizada_pct == null ? "—" : num(c.anualizada_pct) + " %"}</td>
            <td>${c.coste_ajustado_eur == null ? "—" : G.fmtEur(c.coste_ajustado_eur)}</td>
            <td>${c.coste_fiscal_eur == null ? "—" : G.fmtEur(c.coste_fiscal_eur)}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="subt">Sin campañas.</p>'}
      </section>
      <section class="tarjeta"><header><h2>Resultados por año</h2><span class="subt">${escH(crit)} (se elige en Ajustes de Caudal) · también en la pestaña IRPF</span></header>
        ${anos.length ? `<div class="tablaEnv"><table class="dt"><thead><tr><th>Año</th><th>Ganancias</th><th>Pérdidas</th>
          <th>Saldo</th><th>Con el otro criterio</th></tr></thead><tbody>${anos.map(a => { const x = irpf.porAno[a]; return `<tr>
          <td>${a}</td><td>${G.fmtEur(x.ganancias)}</td><td>${x.perdidas ? signo(x.perdidas) : "—"}</td><td>${signo(x.saldo)}</td>
          <td>${signo(x.saldoOtro)}</td></tr>`; }).join("")}</tbody></table></div>
          ${anos.slice(0, 1).map(a => `<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--tinta3);margin:20px 0 8px">${a}, uno a uno</h3>
          <div class="tablaEnv"><table class="dt"><thead><tr><th>Fecha</th><th class="izq">Contrato</th><th class="izq">Evento</th><th>Resultado</th></tr></thead>
          <tbody>${irpf.porAno[a].resultados.map(r => `<tr><td>${G.fmtFecha(r.fecha)}</td><td class="izq">${escH(r.contrato || "")}</td>
            <td class="izq">${escH(NOMBRE[r.subtipo] || r.subtipo)}</td><td>${signo(r.resultado)}</td></tr>`).join("")}</tbody></table></div>`).join("")}`
          : '<p class="subt">Todavía no hay cierres, vencimientos ni asignaciones.</p>'}
        <p class="subt" style="margin-top:10px">Solo informativo: no es asesoramiento fiscal. Las opciones se apuntan en Caudal.</p>
      </section>`;
  }

  async function carga() {
    try {
      const r = await fetch("api/caudal-mod/opciones", { headers: { Accept: "application/json" }, cache: "no-store" });
      datos = r.ok ? await r.json() : null;
    } catch (e) { datos = null; }
    if (tab) tab.pinta();
  }

  // La pestaña va después de «Caudal», que crea caudal.js cuando la sincronización está activa.
  function crea() {
    if (tab || !document.querySelector('#tabs button[data-tab="caudal"]')) return false;
    tab = M.util.pestana({ id: "opciones", texto: "Opciones", despuesDe: "caudal", pinta,
      titulo: "Tus opciones (las apuntas en Caudal): abiertas, calendario, campañas y resultados" });
    carga();
    return true;
  }
  if (!crea()) {
    const tabs = document.getElementById("tabs");
    if (tabs && window.MutationObserver) {
      const obs = new MutationObserver(() => { if (crea()) obs.disconnect(); });
      obs.observe(tabs, { childList: true });
    }
  }
  M.registra({});
})();
