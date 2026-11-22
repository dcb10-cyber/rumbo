/* ============================================================
   mods/mods.js  ·  [mod] Núcleo de mis apartados extra
   ============================================================
   Archivo propio (no es del autor original). El código del autor solo tiene:
     - index.html: "mods/mods.js" en la lista de scripts del cargador,
     - app.js: una línea al pintar la pestaña de un producto, que llama a
       Mods.ficha(producto, color), y otra al pintar «Rendimiento», que llama a
       Mods.resumen(productos, color).
   Todas marcadas con [mod]. Este archivo:
     1. carga los scripts de cada apartado (lista ARCHIVOS, en ese orden),
     2. reparte esas dos llamadas entre los apartados,
     3. da utilidades comunes en Mods.util.

   Para añadir un apartado nuevo: crea su .js en esta carpeta, que llame a
   Mods.registra({ ficha(p, color) {...}, resumen(todos, color) {...} })
   (las dos son opcionales), y añádelo a ARCHIVOS.

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
    const f = window.MODS_FICHA, r = window.MODS_RESUMEN;
    if (f && visible("fondos")) llama(ap, "ficha", f);
    if (r && visible("rendimiento")) llama(ap, "resumen", r);
  }

  function ficha(p, color) {
    fichaActual = p && p.id;
    apartados.forEach(ap => llama(ap, "ficha", [p, color]));
  }

  function resumen(todos, color) {
    apartados.forEach(ap => llama(ap, "resumen", [todos, color]));
  }

  window.Mods = {
    registra, ficha, resumen,
    util: { $, escH, visible, seccion, oculta, fuente, tablaOrdenable, fichaActual: () => fichaActual },
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
