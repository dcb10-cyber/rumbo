/* ============================================================
   mods/filtro_esfuerzo.js  ·  [mod] Filtro de años en «Tu esfuerzo y el del mercado»
   ============================================================
   Archivo propio (no es del autor original). Añade, arriba a la derecha de la tarjeta
   «Tu esfuerzo y el del mercado, mes a mes» (pestaña «Mes»), un selector para ver:
     - los últimos 18 meses (lo de siempre, es lo que se ve por defecto),
     - los últimos 12 meses,
     - un año concreto (uno por cada año que tenga datos).
   El gráfico es el mismo del autor (G.barrasAgrupadas) con los mismos colores y textos;
   solo cambia qué meses se le dan. La elección se mantiene mientras la página siga abierta.

   Se engancha con Mods.registra({ mes(rm) }); app.js llama a Mods.mes(rm) al terminar
   de pintar la pestaña «Mes» (una línea marcada con [mod]).
   ============================================================ */
(function () {
  "use strict";
  if (!window.Mods || !window.G) return;

  const G = window.G;
  const $ = window.Mods.util.$;

  let eleccion = "18m";   // "18m", "12m" o un año ("2026")
  let meses = [];         // los datos de la última vez que se pintó

  function opciones(rm) {
    const anos = [...new Set(rm.map(x => String(x.mes).slice(0, 4)))].sort();
    const o = [];
    if (rm.length > 12) o.push({ k: "18m", t: "Últimos 18 meses" });
    o.push({ k: "12m", t: "Últimos 12 meses" });
    anos.forEach(a => o.push({ k: a, t: a }));
    return o;
  }

  function seleccion(rm, ops) {
    if (!ops.some(o => o.k === eleccion)) eleccion = ops[0].k;   // el año ya no existe, o no hay 18 meses
    if (eleccion === "18m") return rm.slice(-18);
    if (eleccion === "12m") return rm.slice(-12);
    return rm.filter(x => String(x.mes).startsWith(eleccion));
  }

  function dibuja(cont, datos) {
    G.barrasAgrupadas(cont, {
      categorias: datos.map(x => x.mes), alto: 250,
      formatoCat: G.fmtMes,
      series: [
        { nombre: "Lo pusiste tú", color: G.css("--s1"), valores: datos.map(x => x.aportado) },
        { nombre: "Lo puso el mercado", color: G.css("--s3"), valores: datos.map(x => x.mercado) },
      ],
    });
  }

  function pinta(rm) {
    const cont = $("#grafMesHist");
    if (!cont || !rm || !rm.length) return;
    const cab = cont.closest("section") && cont.closest("section").querySelector("header");
    if (!cab) return;
    meses = rm;

    let seg = document.getElementById("segMesHist");
    if (!seg) {
      const sp = document.createElement("span");
      sp.className = "sp";
      seg = document.createElement("div");
      seg.className = "segm";
      seg.id = "segMesHist";
      cab.appendChild(sp);
      cab.appendChild(seg);
    }

    const ops = opciones(rm);
    const datos = seleccion(rm, ops);
    seg.innerHTML = "";
    ops.forEach(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.t;
      b.setAttribute("aria-pressed", String(o.k === eleccion));
      b.onclick = () => { eleccion = o.k; pinta(meses); };
      seg.appendChild(b);
    });

    // El autor ya ha dibujado los últimos 18 meses: solo se repinta si se pide otra cosa.
    if (eleccion !== "18m" || cont.dataset.modEsfuerzo) {
      dibuja(cont, datos);
      cont.dataset.modEsfuerzo = eleccion === "18m" ? "" : "1";
    }
  }

  window.Mods.registra({ mes: pinta });
})();
