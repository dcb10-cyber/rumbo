/* ============================================================
   mods/caudal.js  ·  [mod] Caudal → Rumbo (la parte del navegador)
   ============================================================
   Archivo propio. No toca app.js ni editor.js: usa los ganchos de Mods y un
   MutationObserver (como fiscal_dividendos.js).
     - Pastilla en la cabecera: «Caudal ✓ 27/11 10:40», «Caudal sin conexión» o
       «N pendientes de enlazar», con el botón «Sincronizar ahora».
     - Sincroniza al cargar la página y al volver a la pestaña (si han pasado más de 60 s).
       Si hay datos nuevos y no tienes ningún formulario abierto, recarga; si lo tienes,
       avisa: «Hay datos nuevos de Caudal · Recargar».
     - Mis datos: los movimientos y saldos que vienen de Caudal salen con 🔒 Caudal, sin
       Editar ni Borrar.
     - Pestaña «Caudal» (después de «Mis datos»): enlaces con Caudal (lo pendiente se enlaza
       aquí), errores de validación y lo que no cuadra.
   Solo aparece con la sincronización activa (mis_datos/caudal.json con "activo": true).
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M || location.protocol === "file:") return;
  const { escH } = M.util;
  const ESPERA = 60 * 1000;
  let est = null;            // lo último de /api/caudal-mod/estado
  let ultima = 0;            // cuándo se sincronizó por última vez (ms)
  let ocupado = false;
  let pest = null;           // la pestaña «Caudal»
  let ultimoResultado = null;

  /* ---------------------------------------------- estilos (mismos colores del autor, claro y oscuro) */
  const css = document.createElement("style");
  css.id = "cmodEstilos";
  css.textContent = `
    .cmodPill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--tinta2);
      border:1px solid var(--borde);border-radius:999px;padding:3px 3px 3px 10px;white-space:nowrap;background:var(--sup)}
    .cmodPill .cmodPunto{width:8px;height:8px;border-radius:50%;background:var(--tinta3);flex:none}
    .cmodPill.ok .cmodPunto{background:var(--bien)} .cmodPill.mal .cmodPunto{background:var(--mal)}
    .cmodPill.pend .cmodPunto{background:var(--aviso)}
    .cmodPill .cmodTexto{cursor:pointer} .cmodPill .cmodTexto:hover{color:var(--tinta)}
    .cmodPill button{font:inherit;font-size:12px;border:0;border-radius:999px;padding:3px 9px;
      background:var(--sup2);color:var(--tinta);cursor:pointer}
    .cmodPill button:hover{background:var(--sup3)} .cmodPill button:disabled{opacity:.55;cursor:default}
    @media(max-width:720px){.cmodPill button{display:none}}
    .cmodBanner{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
    .cmodBanner button{font:inherit}
    .cmodLock{display:inline-block;font-size:12px;color:var(--tinta3);white-space:nowrap;padding:3px 6px}
    .cmodDatos{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin:6px 0 4px}
    .cmodDato{background:var(--sup2);border-radius:10px;padding:9px 12px}
    .cmodDato small{display:block;color:var(--tinta3);font-size:11.5px;margin-bottom:2px}
    .cmodDato b{font-weight:650}
    .cmodOk{color:var(--bien)} .cmodMal{color:var(--mal)} .cmodAv{color:var(--aviso)}
    .cmodEnlace{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
    .cmodEnlace select{max-width:240px;font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;
      border:1px solid var(--borde);background:var(--sup2);color:var(--tinta)}
    #tab-caudal .dt td{vertical-align:middle}
    #tab-caudal .dt td.izq,#tab-caudal .dt th.izq{text-align:left}
    #tab-caudal .tarjeta{margin-top:18px}`;
  document.head.appendChild(css);

  /* ---------------------------------------------- ayudas */
  const hora = iso => (iso && iso.length >= 16 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : "");
  const fecha = iso => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
  const num = (v, d = 2) => Number(v || 0).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: d });
  const obligatorios = () => ((est && est.pendientes) || []).filter(p => p.obligatorio);
  // ¿Estás a medias con algo? (un formulario abierto o escribiendo en Mis datos): entonces no se recarga sola.
  function formAbierto() {
    if (document.querySelector("dialog[open]")) return true;
    const a = document.activeElement;
    return !!(a && a.closest && a.closest("#tab-datos") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  async function pide(metodo, url, cuerpo) {
    const r = await fetch(url, {
      method: metodo, cache: "no-store",
      headers: { Accept: "application/json", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!j) throw new Error("No he podido hablar con Rumbo. ¿Sigue abierta su ventana?");
    return j;
  }

  /* ---------------------------------------------- pastilla de la cabecera */
  function pastilla() {
    let p = document.getElementById("cmodPill");
    if (p) return p;
    const fila = document.querySelector(".topFila");
    if (!fila) return null;
    p = document.createElement("span");
    p.id = "cmodPill";
    p.className = "cmodPill";
    p.innerHTML = '<span class="cmodPunto"></span><span class="cmodTexto"></span><button type="button">Sincronizar ahora</button>';
    const ref = document.getElementById("btnPrecios");
    if (ref) ref.insertAdjacentElement("beforebegin", p); else fila.appendChild(p);
    p.querySelector("button").addEventListener("click", () => sincroniza(true));
    p.querySelector(".cmodTexto").addEventListener("click", () => { if (pest) pest.abre(true); });
    return p;
  }

  function pintaPastilla() {
    const p = pastilla();
    if (!p) return;
    p.hidden = !(est && est.activo);
    if (p.hidden) return;
    const n = obligatorios().length;
    let clase = "ok", texto = `Caudal ✓ ${hora(est.comprobado || est.sincronizado)}`.trim();
    if (ocupado) { clase = ""; texto = "Caudal · sincronizando…"; }
    else if (est.conexion === false) { clase = "mal"; texto = "Caudal sin conexión"; }
    else if ((est.errores || []).length && est.ultimoOk === false) { clase = "mal"; texto = "Caudal ⚠ revisa los errores"; }
    else if (n) { clase = "pend"; texto = `${n} pendiente${n === 1 ? "" : "s"} de enlazar`; }
    else if (!est.sincronizado) { clase = ""; texto = "Caudal · sin datos todavía"; }
    p.className = "cmodPill " + clase;
    p.querySelector(".cmodTexto").textContent = texto;
    p.title = [`Datos de Caudal del ${hora(est.sincronizado) || "—"}`, ...(est.avisos || [])].join("\n");
    p.querySelector("button").disabled = ocupado;
  }

  function avisoDatosNuevos() {
    if (document.getElementById("cmodBanner")) return;
    const ref = document.getElementById("bannerVersion");
    if (!ref) return;
    const b = document.createElement("div");
    b.id = "cmodBanner";
    b.className = "banner cmodBanner";
    b.innerHTML = '<span>Hay datos nuevos de Caudal</span><button type="button" class="btn">Recargar</button>';
    ref.insertAdjacentElement("beforebegin", b);
    b.querySelector("button").addEventListener("click", () => location.reload());
  }

  /* ---------------------------------------------- estado y sincronización */
  async function cargaEstado() {
    try { est = await pide("GET", "api/caudal-mod/estado"); } catch (e) { est = null; }
    if (est && est.activo && !pest) creaPestana();
    pintaPastilla();
    candados();
    if (pest) pest.pinta();
  }

  async function sincroniza(aMano) {
    if (ocupado || !est || !est.activo) return;
    ocupado = true;
    pintaPastilla();
    try {
      ultimoResultado = await pide("POST", "api/caudal-mod/sincronizar");
    } catch (e) {
      ultimoResultado = { ok: false, errores: [{ motivo: e.message }] };
    }
    ultima = Date.now();
    ocupado = false;
    await cargaEstado();
    if (ultimoResultado && ultimoResultado.cambiado) {
      if (formAbierto()) avisoDatosNuevos(); else location.reload();
    } else if (aMano && pest && !pest.abierta() && ultimoResultado && !ultimoResultado.ok) {
      pest.abre(true);   // pulsaste «Sincronizar ahora» y algo ha ido mal: se enseña por qué
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && est && est.activo && Date.now() - ultima > ESPERA) sincroniza(false);
  });

  /* ---------------------------------------------- Mis datos: candados */
  const DE_CAUDAL = /^c\d+(\.\d+)?$/;
  function candados() {
    const sel = '#editor button[data-acc="editarMov"][data-id], #editor button[data-acc="editarValor"][data-id]';
    document.querySelectorAll(sel).forEach(b => {
      const id = b.dataset.id;
      const mov = b.dataset.acc === "editarMov";
      if (!(mov ? DE_CAUDAL.test(id) : id.startsWith("cv"))) return;
      const td = b.closest("td");
      if (!td || td.dataset.cmod) return;
      td.dataset.cmod = "1";
      // Se esconden (no se quitan): así fiscal_dividendos.js sigue encontrando la fila para sus etiquetas.
      td.querySelectorAll("button").forEach(x => { x.hidden = true; x.disabled = true; });
      td.insertAdjacentHTML("beforeend", `<span class="cmodLock" title="${mov ? "Este movimiento" : "Este saldo"} viene de Caudal: ${mov ? "edítalo" : "cámbialo"} allí">🔒 Caudal</span>`);
    });
  }
  const editor = document.getElementById("editor");
  if (editor && window.MutationObserver) {
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(candados, 30); })
      .observe(editor, { childList: true, subtree: true });
  }
  // Si la página se abre directamente en «Mis datos», la tabla ya está pintada antes de que llegue este archivo.
  setTimeout(candados, 0);

  /* ---------------------------------------------- pestaña «Caudal» */
  function creaPestana() {
    pest = M.util.pestana({ id: "caudal", texto: "Caudal", titulo: "Lo que viene de Caudal: enlaces, errores y conciliación",
      despuesDe: "datos", pinta: pintaPestana });
  }

  function opciones(clase, actual) {
    const vale = p => (clase === "cuenta" ? p.tipo === "efectivo" || p.tipo === "deuda" : p.tipo !== "efectivo" && p.tipo !== "deuda");
    const lista = ((est && est.productos) || []).filter(vale);
    if (!lista.length) return '<option value="">(no tienes productos de ese tipo)</option>';
    return '<option value="">Elige un producto…</option>' + lista.map(p =>
      `<option value="${escH(p.id)}"${p.id === actual ? " selected" : ""}>${escH(p.nombre)}</option>`).join("");
  }

  function tablaPendientes(lista, titulo, explica) {
    if (!lista.length) return "";
    return `<section class="tarjeta"><header><h2>${titulo}</h2><span class="subt">${explica}</span></header>
      <div class="tablaEnv"><table class="dt"><thead><tr><th class="izq">En Caudal</th><th class="izq">Qué es</th>
        <th>Operaciones</th><th>Enlazar con</th></tr></thead><tbody>
      ${lista.map(p => `<tr><td class="izq"><b>${escH(p.nombre)}</b></td>
        <td class="izq">${p.clase === "cuenta" ? "Cuenta" : "Activo"} · ${escH(p.detalle || "")}</td>
        <td>${p.operaciones || "—"}</td>
        <td><span class="cmodEnlace"><select data-clase="${p.clase}" data-id="${escH(p.caudal_id)}">${opciones(p.clase)}</select>
          <button type="button" class="btn prim" data-enlazar>Enlazar</button></span></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  function pintaPestana(panel) {
    if (!est || !est.activo) {
      panel.innerHTML = '<p class="subt" style="margin:24px 0">La sincronización con Caudal está desactivada (mis_datos/caudal.json).</p>';
      return;
    }
    const r = ultimoResultado;
    const errores = (r && r.errores && r.errores.length ? r.errores : est.errores) || [];
    const pend = est.pendientes || [];
    const otroPerfil = est.perfilActivo !== est.perfil;
    const estadoTxt = est.conexion === false ? '<b class="cmodMal">Sin conexión</b>'
      : est.ultimoOk === false ? '<b class="cmodMal">Con errores</b>' : '<b class="cmodOk">Conectado</b>';
    panel.innerHTML = `
      <section class="tarjeta"><header><h2>Sincronización con Caudal</h2>
        <span class="subt">Caudal manda: aquí solo se lee. Lo que anotas en Caudal aparece en Rumbo.</span><span class="sp"></span>
        <button type="button" class="btn prim" data-sync ${ocupado ? "disabled" : ""}>${ocupado ? "Sincronizando…" : "Sincronizar ahora"}</button></header>
        <div class="cmodDatos">
          <div class="cmodDato"><small>Estado</small>${estadoTxt}</div>
          <div class="cmodDato"><small>Datos de Caudal del</small><b>${escH(hora(est.sincronizado) || "—")}</b></div>
          <div class="cmodDato"><small>Última comprobación</small><b>${escH(hora(est.comprobado) || "—")}</b></div>
          <div class="cmodDato"><small>Perfil que se sincroniza</small><b>${escH(est.perfil)}</b></div>
          <div class="cmodDato"><small>Entra lo que tenga fecha desde</small><b>${escH(fecha(est.desde))}</b></div>
          <div class="cmodDato"><small>Traído de Caudal</small><b>${est.movimientos} movimientos · ${est.valoraciones} saldos</b></div>
        </div>
        ${otroPerfil ? `<div class="av"><span>ⓘ</span><span>Ahora estás viendo otro perfil: lo de Caudal solo sale en «${escH(est.perfil)}» (y en «Todos juntos»).</span></div>` : ""}
        ${(est.avisos || []).map(a => `<div class="av"><span>⚠</span><span>${escH(a)}</span></div>`).join("")}
        <p class="subt" style="margin-top:8px">${[escH(est.url || ""), est.antesDeDesde ? `${est.antesDeDesde} operaciones de Caudal son anteriores a «desde» y no entran (eso sigue como lo tengas en Rumbo).` : ""].filter(Boolean).join(" · ")}</p>
      </section>
      ${errores.length ? `<section class="tarjeta"><header><h2 class="cmodMal">No se ha podido guardar lo nuevo de Caudal</h2>
        <span class="subt">Si falla una sola operación no entra ninguna: el panel sigue con los datos anteriores. Corrígelo en Caudal (o en Rumbo) y vuelve a sincronizar.</span></header>
        <div class="tablaEnv"><table class="dt"><thead><tr><th>Fecha</th><th class="izq">Activo</th><th class="izq">Motivo</th></tr></thead><tbody>
        ${errores.map(e => `<tr><td>${escH(fecha(e.fecha))}</td><td class="izq">${escH(e.activo || "—")}</td><td class="izq">${escH(e.motivo || "")}</td></tr>`).join("")}
        </tbody></table></div></section>` : ""}
      ${tablaPendientes(pend.filter(p => p.obligatorio), "Pendiente de enlazar",
        "Estas operaciones de Caudal no entran hasta que digas a qué producto de Rumbo van (crea el producto en Mis datos si no lo tienes).")}
      ${tablaPendientes(pend.filter(p => !p.obligatorio), "Cuentas sin enlazar (opcional)",
        "Enlázalas con un producto de tipo cuenta o deuda para traer su saldo a fin de cada mes.")}
      <section class="tarjeta"><header><h2>Enlaces con Caudal</h2><span class="subt">Automáticos por ISIN o ticker, o hechos a mano</span></header>
        ${(est.enlazados || []).length ? `<div class="tablaEnv"><table class="dt"><thead><tr><th class="izq">En Caudal</th>
          <th class="izq">Producto de Rumbo</th><th class="izq">Cómo</th><th></th></tr></thead><tbody>
          ${est.enlazados.map(e => `<tr><td class="izq">${escH(e.nombre)} <small class="subt">(${e.clase})</small></td>
            <td class="izq">${escH(e.productoNombre)}</td><td class="izq">${escH(e.como || "")}</td>
            <td>${e.como === "a mano" ? `<button type="button" class="btn" data-quitar data-clase="${e.clase}" data-id="${escH(e.caudal_id)}">Quitar</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div>` : '<p class="subt">Todavía no hay nada enlazado.</p>'}
      </section>
      <section class="tarjeta"><header><h2>¿Cuadran las unidades?</h2><span class="subt">Rumbo (lo tuyo + lo de Caudal) frente a las posiciones de Caudal</span></header>
        ${(est.conciliacion || []).length ? `<div class="tablaEnv"><table class="dt"><thead><tr><th class="izq">Producto</th>
          <th>Rumbo</th><th>Caudal</th><th>Diferencia</th></tr></thead><tbody>
          ${est.conciliacion.map(c => `<tr><td class="izq">${escH(c.nombre)}</td><td>${num(c.rumbo, 8)}</td><td>${num(c.caudal, 8)}</td>
            <td class="cmodAv">${num(c.diferencia, 8)}</td></tr>`).join("")}</tbody></table></div>
          <p class="subt" style="margin-top:8px">Suele ser algo anotado antes de «desde» en un sitio y no en el otro, o un split sin ajustar.</p>`
          : '<p class="cmodOk">✓ Las unidades de todo lo enlazado cuadran con Caudal.</p>'}
      </section>`;

    panel.querySelectorAll("[data-sync]").forEach(b => b.addEventListener("click", () => sincroniza(true)));
    panel.querySelectorAll("[data-enlazar]").forEach(b => b.addEventListener("click", () => {
      const sel = b.parentElement.querySelector("select");
      if (!sel.value) { sel.focus(); return; }
      enlaza(sel.dataset.clase, sel.dataset.id, sel.value, b);
    }));
    panel.querySelectorAll("[data-quitar]").forEach(b => b.addEventListener("click", () => {
      if (confirm("¿Quitar este enlace? Sus operaciones de Caudal dejarán de entrar en Rumbo.")) enlaza(b.dataset.clase, b.dataset.id, "", b);
    }));
  }

  async function enlaza(clase, id, producto, boton) {
    boton.disabled = true;
    try {
      const j = await pide("POST", "api/caudal-mod/enlazar", { clase, caudal_id: id, producto });
      if (j.ok === false && !(j.errores && j.errores.length && typeof j.errores[0] === "object")) {
        alert((j.errores || ["No se ha podido enlazar."]).join("\n"));
      }
      ultimoResultado = j;
      await cargaEstado();
      if (j.cambiado) { if (formAbierto()) avisoDatosNuevos(); else location.reload(); }
    } catch (e) { alert(e.message); } finally { boton.disabled = false; }
  }

  /* ---------------------------------------------- arranque */
  cargaEstado().then(() => { if (est && est.activo) sincroniza(false); });
  M.registra({});
})();
