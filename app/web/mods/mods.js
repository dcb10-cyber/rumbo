/* ============================================================
   mods/mods.js  ·  [mod] Núcleo de mis apartados extra
   ============================================================
   Archivo propio (no es del autor original). El código del autor solo tiene:
     - index.html: "mods/mods.js" en la lista de scripts del cargador,
     - app.js: una línea al pintar la pestaña de un producto, que llama a
       Mods.ficha(producto, color), otra al pintar «Rendimiento», que llama a
       Mods.resumen(productos, color), otra al pintar «Mes», que llama a Mods.mes(meses), y otra al
       pintar las tarjetas de «Componentes de la cartera», que llama a Mods.componentes(lista),
     - editor.js: una línea al abrir el formulario de un movimiento: Mods.formMovimiento(...).
   Todas marcadas con [mod]. Este archivo:
     1. carga los scripts de cada apartado (lista ARCHIVOS, en ese orden),
     2. reparte esas llamadas entre los apartados,
     3. da utilidades comunes en Mods.util.

   Para añadir un apartado nuevo: crea su .js en esta carpeta, que llame a
   Mods.registra({ ficha(p, color) {...}, resumen(todos, color) {...}, mes(meses) {...},
   componentes(lista) {...} }) (todas opcionales), y añádelo a ARCHIVOS.

   En la web exportada («Compartir») no se carga: allí no hay servidor.
   ============================================================ */
(function () {
  "use strict";

  if (!window.G || !window.DATOS) return;

  const ARCHIVOS = [
    "empresa/comun.js",        // lo común de los apartados de empresa (estilos, formatos)
    "empresa/dividendos.js",   // nivel 1: dividendos, splits y 52 semanas
    "empresa/cifras.js",       // nivel 2: la empresa en cifras
    "empresa/analistas.js",    // nivel 3: analistas
    "filtro_esfuerzo.js",      // filtro de años en «Tu esfuerzo y el del mercado» (pestaña Mes)
    "filtro_componentes.js",   // filtro por tipo y orden en «Componentes de la cartera» (pestaña Patrimonio)
    "fiscal_dividendos.js",    // retenciones en el formulario de «Dividendo» (y sus cuentas)
    "pestana_dividendos.js",   // pestaña «Ingr. Pasivos» (crea su propio botón y panel)
    "pestana_irpf.js",         // pestaña «IRPF»: retenciones e impuestos de esos cobros
    "caudal.js",               // Caudal → Rumbo: pastilla, candados 🔒 y pestaña «Caudal»
  ];

  /* ---------------------------------------------- utilidades comunes */
  const $ = s => document.querySelector(s);
  const escH = s => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ¿Se está viendo esa pestaña? ("fondos" es la de los productos)
  const visible = tab => { const t = $("#tab-" + tab); return !!t && !t.hidden; };

  // La tarjeta de un apartado, justo después de otra (se crea la primera vez).
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
  const oculta = sec => { sec.hidden = true; sec.innerHTML = ""; };

  // Datos de una ruta del servidor ({ok, productos}), pedidos una sola vez.
  // f.datos es null mientras no han llegado; luego, {id del producto: ...} (vacío si falla).
  function fuente(url) {
    const f = { datos: null, promesa: null };
    f.trae = () => {
      if (location.protocol === "file:") return Promise.resolve((f.datos = {}));
      if (!f.promesa) {
        f.promesa = fetch(url, { headers: { Accept: "application/json" } })
          .then(r => (r.ok ? r.json() : null))
          .then(j => (f.datos = (j && j.ok && j.productos) || {}))
          .catch(() => (f.datos = {}));
      }
      return f.promesa;
    };
    return f;
  }

  // Tabla que se ordena pulsando la cabecera. cols: [{ k, t, titulo?, celda(fila) }].
  // celda devuelve el HTML de la celda o null («—»). orden: { k, asc } (se recuerda entre repintados).
  // ascAlCambiar(k): si al cambiar a esa columna se empieza en ascendente.
  function tablaOrdenable(sec, { cabecera, cols, filas, orden, comparar, ascAlCambiar, pie, nota }) {
    const pinta = () => {
      const ord = filas.slice().sort((a, b) => {
        const va = a[orden.k], vb = b[orden.k];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const r = comparar(va, vb);
        return orden.asc ? r : -r;
      });
      sec.innerHTML = `
        ${cabecera}
        <div class="tablaEnv alto"><table class="dt">
          <thead><tr>${cols.map(c => `<th data-k="${c.k}" style="cursor:pointer"${c.titulo != null ? ` title="${escH(c.titulo)}"` : ""}>${c.t}${orden.k === c.k ? (orden.asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
          <tbody>${ord.map(x => `<tr>${cols.map(c => {
            const v = c.celda(x);
            return c.k === "nombre" ? v : `<td>${v == null ? "—" : v}</td>`;
          }).join("")}</tr>`).join("")}</tbody>${pie ? `
          ${pie}` : ""}</table></div>
        ${nota}`;
      sec.querySelectorAll("th[data-k]").forEach(th => th.addEventListener("click", () => {
        const k = th.dataset.k;
        if (orden.k === k) orden.asc = !orden.asc; else { orden.k = k; orden.asc = ascAlCambiar(k); }
        pinta();
      }));
    };
    pinta();
  }

  /* ---------------------------------------------- pestañas propias */
  // Crea una pestaña nueva (botón + panel) justo después de otra, y se comporta como las del
  // autor: recuerda cuál estaba abierta, ?tab=<id>, recarga si cambiaste algo en «Mis datos» y
  // repinta al cambiar el tamaño, el tema, la moneda o el modo vídeo.
  // cfg: { id, texto, titulo?, despuesDe: id de la pestaña anterior, pinta(panel) }
  const recuerda = {
    lee(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    guarda(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* da igual */ } },
  };
  function pestana(cfg) {
    const antes = document.querySelector(`#tabs button[data-tab="${cfg.despuesDe}"]`);
    const panelAntes = document.getElementById("tab-" + cfg.despuesDe);
    if (!antes || !panelAntes) return null;
    const b = document.createElement("button");
    b.dataset.tab = cfg.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", "false");
    b.textContent = cfg.texto;
    if (cfg.titulo) b.title = cfg.titulo;
    antes.insertAdjacentElement("afterend", b);
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "tab-" + cfg.id;
    panel.setAttribute("role", "tabpanel");
    panel.hidden = true;
    panelAntes.insertAdjacentElement("afterend", panel);

    const abierta = () => !panel.hidden;
    const pinta = () => {
      if (!abierta()) return;
      try { cfg.pinta(panel); } catch (e) {
        console.error("[mod]", cfg.id, e);
        panel.innerHTML = `<div class="av" style="margin:24px 0"><span>⚠</span><span>Algo ha fallado al pintar
          esta pestaña: ${escH(e && e.message || e)}</span></div>`;
      }
    };
    // Lo mismo que hace irA() de app.js con sus pestañas.
    const abre = subir => {
      recuerda.guarda("patrimonio.tab", cfg.id);
      if (window.EDITOR_SUCIO) { location.reload(); return; }
      document.querySelectorAll("#tabs button").forEach(x => x.setAttribute("aria-selected", String(x.dataset.tab === cfg.id)));
      document.querySelectorAll(".panel").forEach(p => { p.hidden = p !== panel; });
      pinta();
      if (subir) window.scrollTo({ top: 0, behavior: "smooth" });
    };
    b.addEventListener("click", () => abre(true));
    let t = null;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(pinta, 160); });
    const tema = $("#btnTema"); if (tema) tema.addEventListener("click", () => setTimeout(pinta, 0));
    const mon = $("#selMoneda"); if (mon) mon.addEventListener("change", () => setTimeout(pinta, 0));
    const vid = $("#btnVideo"); if (vid) vid.addEventListener("click", () => setTimeout(pinta, 80));
    // Las pestañas se crean una detrás de otra: se abre la guardada cuando ya existen todas.
    setTimeout(() => { if (recuerda.lee("patrimonio.tab") === cfg.id) abre(false); }, 0);
    return { panel, abierta, pinta, abre };
  }

  // Todos los dividendos, intereses… uno a uno (app/mods/pestana_dividendos.py), pedidos una sola vez.
  // cobros.datos: null mientras no han llegado; luego {cobros, productos}. cobros.error: texto o null.
  const cobros = { datos: null, error: null, promesa: null };
  cobros.trae = () => {
    if (location.protocol === "file:") {
      cobros.datos = { cobros: [], productos: {} };
      cobros.error = "Esta pestaña solo funciona con la app abierta (Iniciar.bat).";
      return Promise.resolve(cobros.datos);
    }
    if (!cobros.promesa) {
      cobros.promesa = fetch("api/dividendos-mod", { headers: { Accept: "application/json" } })
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          if (!j || !j.ok) cobros.error = "No he podido leer tus cobros" + (j && j.error ? `: ${j.error}` : ".");
          cobros.datos = { cobros: (j && j.cobros) || [], productos: (j && j.productos) || {} };
        })
        .catch(() => {
          cobros.error = "No he podido leer tus cobros. ¿Está abierta la ventana de Rumbo?";
          cobros.datos = { cobros: [], productos: {} };
        });
    }
    return cobros.promesa;
  };

  // La fecha de hoy (AAAA-MM-DD, hora de tu ordenador), o la de los datos si fuera posterior.
  function hoy() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    const h = d.toISOString().slice(0, 10), ext = (window.DATOS && window.DATOS.fechaExtracto) || "";
    return ext > h ? ext : h;
  }

  /* ---------------------------------------------- reparto de las llamadas de app.js */
  const apartados = [];
  let fichaActual = null;

  // Un fallo en un apartado no puede romper los demás ni el panel del autor.
  function llama(ap, que, args) {
    if (!ap[que]) return;
    try { ap[que](...args); } catch (e) { console.error("[mod]", e); }
  }

  function registra(ap) {
    apartados.push(ap);
    // app.js puede haber pintado antes de que llegara este apartado: se pinta ahora lo pendiente.
    const f = window.MODS_FICHA, r = window.MODS_RESUMEN, m = window.MODS_MES, c = window.MODS_COMPONENTES;
    if (f && visible("fondos")) llama(ap, "ficha", f);
    if (r && visible("rendimiento")) llama(ap, "resumen", r);
    if (m && visible("mes")) llama(ap, "mes", m);
    if (c && visible("patrimonio")) llama(ap, "componentes", c);
  }

  function ficha(p, color) {
    fichaActual = p && p.id;
    apartados.forEach(ap => llama(ap, "ficha", [p, color]));
  }

  function resumen(todos, color) {
    apartados.forEach(ap => llama(ap, "resumen", [todos, color]));
  }

  function mes(meses) {
    apartados.forEach(ap => llama(ap, "mes", [meses]));
  }

  function componentes(lista) {
    apartados.forEach(ap => llama(ap, "componentes", [lista]));
  }

  // Lo llama editor.js (una línea [mod]) al abrir el formulario de un movimiento.
  function formMovimiento(f, m, nuevo, cfg) {
    apartados.forEach(ap => llama(ap, "formMovimiento", [f, m, nuevo, cfg]));
  }

  window.Mods = {
    registra, ficha, resumen, mes, componentes, formMovimiento,
    util: { $, escH, visible, seccion, oculta, fuente, tablaOrdenable, pestana, cobros, hoy, fichaActual: () => fichaActual },
  };
  const pend = window.MODS_FICHA;
  if (pend) fichaActual = pend[0] && pend[0].id;

  /* ---------------------------------------------- carga de los apartados */
  // Misma carpeta y mismo «?v=» que este archivo, para que el navegador no use una copia vieja.
  const yo = document.currentScript && document.currentScript.src;
  const base = yo ? yo.replace(/mods\.js(\?.*)?$/, "") : "mods/";
  const sello = yo && yo.includes("?") ? "?" + yo.split("?")[1] : "";
  ARCHIVOS.forEach(archivo => {
    const s = document.createElement("script");
    s.src = base + archivo + sello;
    s.async = false;
    document.head.appendChild(s);
  });
})();
