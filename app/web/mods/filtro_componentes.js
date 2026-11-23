/* ============================================================
   mods/filtro_componentes.js  ·  [mod] Filtro y orden de «Componentes de la cartera»
   ============================================================
   Archivo propio (no es del autor original). En la pestaña «Patrimonio», arriba a la derecha de
   «Componentes de la cartera», añade:
     - un filtro por tipo de activo (Todos, Acciones, ETF, Fondos, Cripto…; solo salen los tipos
       que tienes), para ver solo ese tipo de tarjetas,
     - un selector de orden: valor, rentabilidad %, ganancia en € o nombre.
   No cambia las tarjetas: solo esconde las que no tocan y las reordena. No afecta a los gráficos
   ni a los totales (eso lo siguen decidiendo los botones de arriba, «Ver todo» / «Solo largo plazo»).
   La elección se mantiene mientras la página siga abierta.

   Se engancha con Mods.registra({ componentes(lista) }); app.js llama a Mods.componentes(lista)
   al terminar de pintar las tarjetas (una línea marcada con [mod]).
   ============================================================ */
(function () {
  "use strict";
  if (!window.Mods) return;

  const $ = window.Mods.util.$;

  // Orden en que salen los botones y cómo se llama cada tipo en plural.
  const TIPOS = [
    ["accion", "Acciones"], ["etf", "ETF"], ["fondo", "Fondos"], ["pension", "Pensiones"], ["bono", "Bonos"],
    ["cripto", "Cripto"], ["commodity", "Materias primas"], ["efectivo", "Efectivo"], ["inmueble", "Inmuebles"],
    ["p2p", "P2P"], ["deuda", "Deudas"], ["otro", "Otros"],
  ];

  const aportado = p => (p.aportado != null && p.aportado > 0 ? p.aportado : null);
  const ORDENES = [
    { k: "original", t: "Orden original", f: null },
    { k: "valor-desc", t: "Valor: de mayor a menor", f: p => p.valor || 0, dir: -1 },
    { k: "valor-asc", t: "Valor: de menor a mayor", f: p => p.valor || 0, dir: 1 },
    { k: "rent-desc", t: "Rentabilidad %: de mayor a menor", f: p => aportado(p) ? (p.valor || 0) / aportado(p) - 1 : null, dir: -1 },
    { k: "rent-asc", t: "Rentabilidad %: de menor a mayor", f: p => aportado(p) ? (p.valor || 0) / aportado(p) - 1 : null, dir: 1 },
    { k: "gan-desc", t: "Ganancia €: de mayor a menor", f: p => aportado(p) ? (p.valor || 0) - aportado(p) : null, dir: -1 },
    { k: "gan-asc", t: "Ganancia €: de menor a mayor", f: p => aportado(p) ? (p.valor || 0) - aportado(p) : null, dir: 1 },
    { k: "nombre", t: "Nombre (A-Z)", f: p => String(p.corto || p.nombre || "").toLowerCase(), dir: 1, texto: true },
  ];

  let tipo = "todos";
  let orden = "original";
  let ultima = [];

  if (!document.getElementById("modCompCss")) {
    const st = document.createElement("style");
    st.id = "modCompCss";
    st.textContent = `
      .modComp{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-left:auto}
      .modComp .cuenta{font-size:12px;color:var(--tinta3);white-space:nowrap}
      .modComp .segm button small{margin-left:5px;font-size:11px;opacity:.6}
      .modComp select{appearance:none;-webkit-appearance:none;font:inherit;font-size:12.5px;color:var(--tinta);cursor:pointer;
        background:var(--sup2) var(--flecha) no-repeat right 10px center;border:1px solid var(--borde);border-radius:9px;
        padding:6px 28px 6px 11px}
    `;
    document.head.appendChild(st);
  }

  function pinta(lista) {
    const cont = $("#chips");
    if (!cont || !lista) return;
    const sec = cont.closest("section");
    const cab = sec && sec.querySelector("header");
    if (!cab) return;
    ultima = lista;

    // Cada tarjeta con su producto. Las que acaba de pintar app.js salen en el mismo orden que la
    // lista; si ya las hemos movido nosotros, van marcadas.
    let chips = [...cont.children];
    if (chips.some(c => !c.dataset.modIdx)) {
      if (chips.length !== lista.length) return;
      chips.forEach((c, i) => { c.dataset.modIdx = String(i); });
    }
    const filas = chips.map(c => ({ chip: c, i: +c.dataset.modIdx, p: lista[+c.dataset.modIdx] })).filter(x => x.p)
      .sort((a, b) => a.i - b.i);

    // Los tipos que hay, en su orden.
    const cuantos = {};
    filas.forEach(x => { const k = x.p.tipoClave || "otro"; cuantos[k] = (cuantos[k] || 0) + 1; });
    const tipos = TIPOS.filter(([k]) => cuantos[k]);
    if (tipo !== "todos" && !cuantos[tipo]) tipo = "todos";
    if (!ORDENES.some(o => o.k === orden)) orden = "original";

    // Controles (se crean una vez; se rellenan cada vez).
    let ctl = document.getElementById("modCompControles");
    if (!ctl) {
      ctl = document.createElement("div");
      ctl.id = "modCompControles";
      ctl.className = "modComp";
      cab.style.flexWrap = "wrap";
      cab.appendChild(ctl);
    }
    ctl.innerHTML = "";
    const cuenta = document.createElement("span");
    cuenta.className = "cuenta";
    ctl.appendChild(cuenta);

    if (tipos.length > 1) {
      const seg = document.createElement("div");
      seg.className = "segm";
      [["todos", "Todos", filas.length], ...tipos.map(([k, t]) => [k, t, cuantos[k]])].forEach(([k, t, n]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `${t}<small>${n}</small>`;
        b.setAttribute("aria-pressed", String(k === tipo));
        b.onclick = () => { tipo = k; pinta(ultima); };
        seg.appendChild(b);
      });
      ctl.appendChild(seg);
    }

    const sel = document.createElement("select");
    sel.title = "Ordenar las tarjetas";
    sel.setAttribute("aria-label", "Ordenar las tarjetas");
    ORDENES.forEach(o => {
      const op = document.createElement("option");
      op.value = o.k; op.textContent = o.t; op.selected = o.k === orden;
      sel.appendChild(op);
    });
    sel.onchange = () => { orden = sel.value; pinta(ultima); };
    ctl.appendChild(sel);

    // Filtrar y ordenar (los que no tienen el dato —por ejemplo, sin aportaciones— van siempre al final).
    const o = ORDENES.find(x => x.k === orden);
    let vista = filas.slice();
    if (o.f) {
      const cmp = (a, b) => (o.texto ? String(a).localeCompare(String(b), "es") : a - b) * o.dir;
      vista.sort((a, b) => {
        const va = o.f(a.p), vb = o.f(b.p);
        if (va == null && vb == null) return a.i - b.i;
        if (va == null) return 1;
        if (vb == null) return -1;
        return cmp(va, vb) || a.i - b.i;
      });
    }
    let visibles = 0;
    vista.forEach(x => {
      const ok = tipo === "todos" || (x.p.tipoClave || "otro") === tipo;
      x.chip.style.display = ok ? "" : "none";
      if (ok) visibles++;
      cont.appendChild(x.chip);
    });
    cuenta.textContent = visibles === filas.length ? "" : `${visibles} de ${filas.length}`;
  }

  window.Mods.registra({ componentes: pinta });
})();
