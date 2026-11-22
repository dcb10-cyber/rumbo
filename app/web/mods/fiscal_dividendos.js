/* ============================================================
   mods/fiscal_dividendos.js  ·  [mod] Retenciones de cada dividendo
   ============================================================
   Archivo propio. En el formulario de «Dividendo» (Mis datos → Movimientos) añade:
     País del que viene · Dividendo bruto · Retenido en origen · Retenido en España ·
     Máximo del convenio
   y, debajo, lo que puedes deducir en la Renta, lo que puedes reclamar al otro país,
   lo que se pierde y lo que te quedaría por pagar. El «Importe total» del autor se
   rellena solo con lo que te ingresan (bruto − retenciones) mientras no lo toques.

   Se engancha con una línea [mod] de editor.js (Mods.formMovimiento). Los campos se
   llaman fis_* y el servidor los guarda en el movimiento como «fiscal» (en euros):
   ver app/mods/fiscal_dividendos.py.

   Las cuentas (Mods.fiscal.calcula) las usa también la pestaña «Ingr. Pasivos».

   Cómo funciona la doble imposición para un residente en España (resumen):
     - En la Renta deduces lo MENOR de: lo que te retuvieron fuera (como mucho, el % del
       convenio sobre el bruto) y lo que pagarías en España por ese dividendo (≈19 %).
     - Lo retenido por encima del convenio no se deduce: se reclama al país de origen.
     - Sin convenio (p. ej. Dinamarca desde 2009) no hay tope del convenio ni nada que
       reclamar: deduces lo retenido con el límite de lo que pagarías en España.
     - Un bróker español te retiene además el 19 % de lo que llega (bruto − origen).
   ============================================================ */
(function () {
  "use strict";

  const M = window.Mods;
  if (!M) return;
  const { escH } = M.util;

  const TIPO_ES = 0.19;   // primer tramo del ahorro: el que se usa para las estimaciones de cada cobro

  // País: [nombre, retención habitual para un residente en España (%), máximo del convenio (%) o null].
  // Retención «habitual» = la que suelen aplicar los brókers con la documentación en regla (W-8BEN...).
  // Fuentes: AEAT, «Límites de imposición en los convenios»; y la práctica habitual de cada país.
  const PAISES = {
    ES: ["España", 0, null],
    US: ["Estados Unidos", 15, 15],
    DE: ["Alemania", 26.375, 15],
    FR: ["Francia", 12.8, 15],
    NL: ["Países Bajos", 15, 15],
    GB: ["Reino Unido", 0, 10],
    IE: ["Irlanda", 25, 15],
    CH: ["Suiza", 35, 15],
    IT: ["Italia", 26, 15],
    PT: ["Portugal", 28, 15],
    BE: ["Bélgica", 30, 15],
    LU: ["Luxemburgo", 15, 15],
    AT: ["Austria", 27.5, 15],
    DK: ["Dinamarca", 27, null],
    SE: ["Suecia", 30, 15],
    NO: ["Noruega", 25, 15],
    FI: ["Finlandia", 30, 15],
    CA: ["Canadá", 25, 15],
    AU: ["Australia", 30, 15],
    JP: ["Japón", 15.315, 10],
    CN: ["China", 10, 10],
    HK: ["Hong Kong", 0, 10],
    SG: ["Singapur", 0, 5],
    BR: ["Brasil", 0, 15],
    MX: ["México", 10, 10],
    KR: ["Corea del Sur", 22, 15],
    IL: ["Israel", 25, 10],
    IN: ["India", 20, 15],
    TW: ["Taiwán", 21, null],
    XX: ["Otro país", 0, null],
  };
  const NOTAS = {
    US: "Con el W-8BEN firmado te retienen el 15 %; sin él, el 30 % (y el 15 % de más se reclama con el 1040-NR).",
    DK: "España y Dinamarca no tienen convenio desde 2009: no hay nada que reclamar allí, y en la Renta deduces como mucho lo que pagarías en España (≈19 %). El resto se pierde.",
    TW: "Sin convenio con España: deduces como mucho lo que pagarías en España (≈19 %).",
    IE: "Los ETF irlandeses no tienen retención (0 %). Las acciones de empresas irlandesas, el 25 %.",
    GB: "El Reino Unido no retiene en los dividendos normales.",
    AU: "La parte «franked» del dividendo no tiene retención; la «unfranked», el 30 %.",
    JP: "Revisa el máximo del convenio en tu certificado: el convenio nuevo tiene tipos reducidos.",
    FR: "Si tu bróker no te identificó, puede que te hayan retenido el 25 %: el exceso sobre el 15 % se reclama (formularios 5000 y 5001).",
    CH: "El 20 % de más se reclama a Suiza con el formulario 90 de la ESTV.",
    DE: "El 11,375 % de más se reclama a Alemania (portal del BZSt).",
    ES: "Dividendo español: no hay retención en origen; la empresa o el bróker te retiene el 19 %.",
  };
  // Sufijo de Yahoo → país (si el ISIN no lo dice).
  const SUFIJOS = { MC: "ES", PA: "FR", DE: "DE", F: "DE", AS: "NL", L: "GB", IR: "IE", SW: "CH", MI: "IT",
    LS: "PT", BR: "BE", VI: "AT", CO: "DK", ST: "SE", OL: "NO", HE: "FI", TO: "CA", V: "CA", AX: "AU",
    T: "JP", HK: "HK", SS: "CN", SZ: "CN", SI: "SG", SA: "BR", MX: "MX", KS: "KR", TA: "IL", NS: "IN", TW: "TW" };
  // Brókers y bancos que retienen el 19 % en España (los extranjeros, como IBKR o Degiro, no).
  const RETIENEN_ES = /myinvestor|caixa|ing\b|openbank|bbva|santander|bankinter|renta ?4|self ?bank|sabadell|kutxa|unicaja|abanca|ibercaja|cajamar|evo|inversis|imagin|indexa|r4|andbank|deutsche bank/i;

  const LS = "patrimonio.fiscalBroker";   // lo que elegiste para cada bróker (retiene o no)
  const lsLee = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } };
  const lsGuarda = o => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* da igual */ } };

  /** País probable de un producto: por el ISIN, por el sufijo del ticker o, en Yahoo sin sufijo, EE. UU. */
  function paisDe(p) {
    if (!p) return "US";
    if (p.tipo === "efectivo") return "ES";
    const isin = String(p.identificador || "").toUpperCase();
    if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
      const c = isin.slice(0, 2);
      return PAISES[c] ? c : "XX";
    }
    const cod = String(p.codigo || "").toUpperCase();
    const suf = cod.includes(".") ? cod.split(".").pop() : "";
    if (suf && SUFIJOS[suf]) return SUFIJOS[suf];
    return p.fuente === "yahoo" && !suf ? "US" : "XX";
  }
  /** Retención habitual en origen para ese producto (los ETF irlandeses y luxemburgueses no retienen). */
  function tipoOrigen(pais, p) {
    if ((pais === "IE" || pais === "LU") && p && (p.tipo === "etf" || p.tipo === "fondo")) return 0;
    return (PAISES[pais] || PAISES.XX)[1];
  }
  // Clave con la que se recuerda si ese banco o bróker retiene: «int:» delante para los intereses.
  const claveBroker = p => {
    const ent = String((p && p.entidad) || "").trim().toLowerCase();
    return ent && (p.tipo === "efectivo" || p.tipo === "p2p" ? "int:" : "") + ent;
  };
  function retieneEspana(p) {
    const elegido = lsLee()[claveBroker(p)];
    if (elegido != null) return elegido;
    return RETIENEN_ES.test(String((p && p.entidad) || ""));
  }

  /**
   * Las cuentas de un cobro. Recibe {bruto, origen, espana, convenio (0-1 o null), pais} y, opcional,
   * el tipo español a usar (por defecto 19 %). Devuelve:
   *   deducible  lo que restas en la Renta por doble imposición
   *   reclamable lo retenido por encima del convenio (se pide al otro país)
   *   perdido    lo retenido fuera que ni se deduce ni se reclama
   *   cuotaEs    lo que pagarías en España por ese dividendo (bruto × tipo)
   *   pendiente  lo que te queda por pagar en la Renta (negativo: te lo devuelven)
   *   limpio     lo que te queda de verdad, sin contar lo que reclames fuera
   */
  function calcula(x, tipo) {
    const t = tipo == null ? TIPO_ES : tipo;
    const B = +x.bruto || 0, O = +x.origen || 0, R = +x.espana || 0;
    const conv = x.convenio == null || x.convenio === "" ? null : +x.convenio;
    const espanol = x.pais === "ES";
    const cuotaEs = B * t;
    const topeConv = conv == null ? Infinity : B * conv;
    const deducible = espanol ? 0 : Math.max(0, Math.min(O, topeConv, cuotaEs));
    // Unos céntimos por encima del convenio son redondeo del bróker, no algo que reclamar.
    const exceso = espanol || conv == null ? 0 : O - topeConv;
    const reclamable = exceso > Math.max(0.05, B * 0.002) ? exceso : 0;
    const perdido = conv == null && !espanol ? Math.max(0, O - deducible) : 0;
    const pendiente = cuotaEs - deducible - R;
    const limpio = B - O - (cuotaEs - deducible);
    return { bruto: B, origen: O, espana: R, convenio: conv, deducible, reclamable, perdido, cuotaEs, pendiente, limpio };
  }

  /* ================================================================
     FORMULARIO
     ================================================================ */
  if (!document.getElementById("fiscalModCss")) {
    const st = document.createElement("style");
    st.id = "fiscalModCss";
    st.textContent = `
      .fmod{grid-column:1/-1;border:1px solid var(--borde);border-radius:12px;padding:14px 14px 12px;margin-top:4px}
      .fmod > .fmodTit{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta3)}
      .fmod > .fmodTit label{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--tinta2);cursor:pointer}
      .fmod .rejilla{gap:12px 14px}
      .fmodNota{font-size:12px;color:var(--tinta3);line-height:1.45;margin:10px 0 0}
      .fmodCuentas{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px}
      .fmodCuentas > div{background:var(--sup2);border-radius:10px;padding:9px 11px;min-width:0}
      .fmodCuentas .e{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--tinta3)}
      .fmodCuentas .v{font-size:16px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:3px}
      .fmodCuentas .n{font-size:11.5px;color:var(--tinta3);margin-top:2px}
      .fmodAviso{font-size:12.5px;color:var(--aviso);margin:10px 0 0}
      .fmod[data-off] .fmodCuerpo{display:none}
      .fmodChip{display:inline-block;margin-top:4px;font-size:11.5px;font-weight:500;line-height:1.35;padding:2px 7px;border-radius:6px;white-space:normal}
      .fmodChip.si{color:var(--bien);background:color-mix(in srgb,var(--bien) 12%,transparent)}
      .fmodChip.no{color:var(--aviso);background:color-mix(in srgb,var(--aviso) 12%,transparent)}
      .fmodChip b{font-weight:650}
    `;
    document.head.appendChild(st);
  }

  const leeNum = t => {
    t = String(t == null ? "" : t).replace(/[€\s]/g, "");
    if (!t) return null;
    if (t.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    const v = parseFloat(t);
    return isNaN(v) ? null : v;
  };
  const dec = (v, d = 2) => v == null || !isFinite(v) ? "" : (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",");
  const nf = (v, d = 2) => Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pctTxt = v => (v == null ? "—" : Number(v).toLocaleString("es-ES", { maximumFractionDigits: 3 }) + " %");

  function formMovimiento(f, m, nuevo, cfg) {
    if (!f || !f.elements.importe || f.querySelector(".fmod")) return;
    const prodDe = id => ((cfg && cfg.productos) || []).find(p => p.id === id);
    const ultimoFiscal = pid => ((cfg && cfg.movimientos) || [])
      .filter(x => x.producto === pid && x.tipo === "dividendo" && x.fiscal && x.fiscal.bruto).pop();
    const fis = (m && m.fiscal) || null;

    const opciones = Object.entries(PAISES).map(([c, [n]]) => `<option value="${c}">${escH(n)}</option>`).join("");
    const caja = document.createElement("div");
    caja.className = "fmod";
    caja.innerHTML = `
      <div class="fmodTit"><span>Retenciones e impuestos</span>
        <label><input type="checkbox" class="fmodUsar"> <span class="fmodTxtUsar">Anotar el bruto y las retenciones</span></label></div>
      <div class="fmodCuerpo">
        <div class="rejilla">
          <label class="campo fmodSoloDiv"><span class="et">País del que viene</span><select name="fis_pais">${opciones}</select></label>
          <label class="campo"><span class="et"><span class="fmodTxtBruto">Dividendo bruto</span> <em class="fmodTxtAntes">antes de retenciones</em></span>
            <div class="conSufijo"><input name="fis_bruto" inputmode="decimal" placeholder="0,00"><span class="fmodSim">€</span></div></label>
          <label class="campo fmodSoloDiv"><span class="et">Retenido en origen <em class="fmodPctO"></em></span>
            <div class="conSufijo"><input name="fis_origen" inputmode="decimal" placeholder="0,00"><span class="fmodSim">€</span></div></label>
          <label class="campo fmodSoloInt"><span class="et">¿Te retienen?</span>
            <select class="fmodRetieneInt"><option value="1">Sí, el 19 %</option><option value="0">No, me los pagan sin retención</option></select></label>
          <label class="campo"><span class="et"><span class="fmodTxtEsp">Retenido en España</span> <em class="fmodPctE"></em></span>
            <div class="conSufijo"><input name="fis_espana" inputmode="decimal" placeholder="0,00"><span class="fmodSim">€</span></div></label>
          <label class="campo fmodSoloDiv"><span class="et">Máximo del convenio <em>vacío = sin convenio</em></span>
            <div class="conSufijo"><input name="fis_convenio" inputmode="decimal" placeholder="sin convenio"><span>%</span></div></label>
          <label class="campo fmodSoloDiv"><span class="et">¿Tu bróker retiene en España?</span>
            <select class="fmodRetiene"><option value="1">Sí, el 19 % de lo que llega</option><option value="0">No (IBKR, Degiro…)</option></select></label>
        </div>
        <input type="hidden" name="fis_neto">
        <p class="fmodNota"></p>
        <div class="fmodCuentas"></div>
        <p class="fmodAviso" hidden></p>
      </div>`;
    const nota = f.elements.nota && f.elements.nota.closest(".campo");
    (nota || f.querySelector(".rejilla")).insertAdjacentElement(nota ? "afterend" : "beforeend", caja);

    const E_ = n => f.elements[n];
    const producto = () => prodDe(E_("producto").value);
    const usar = caja.querySelector(".fmodUsar");
    const selRetDiv = caja.querySelector(".fmodRetiene"), selRetInt = caja.querySelector(".fmodRetieneInt");
    // Cuentas remuneradas y P2P: intereses (sin país ni convenio); el resto, dividendos y cupones.
    const esInteres = () => { const p = producto(); return !!p && (p.tipo === "efectivo" || p.tipo === "p2p"); };
    const selRetActivo = () => (esInteres() ? selRetInt : selRetDiv);
    // Lo que el usuario ha escrito a mano no se pisa con lo automático.
    // Las retenciones automáticas no pisan lo que escribas a mano en ellas.
    // El importe se recalcula (bruto − retenciones) cada vez que cambias algo de este bloque;
    // si lo escribes tú, se queda así hasta que vuelvas a cambiar el bruto o las retenciones.
    const tocado = { origen: !!fis, espana: !!fis, convenio: !!fis };
    let escribiendoYo = false;
    ["origen", "espana", "convenio"].forEach(k => E_("fis_" + k).addEventListener("input", () => { tocado[k] = true; }));

    const esDividendo = () => {
      const t = f.elements.tipo && f.elements.tipo.value;
      const p = producto();
      return t === "dividendo" && !(p && p.tipo === "inmueble");
    };

    function ponDefectos(cambioProducto) {
      const p = producto();
      const ult = ultimoFiscal(p && p.id);
      const pais = (ult && ult.fiscal.pais) || paisDe(p);
      E_("fis_pais").value = PAISES[pais] ? pais : "XX";
      if (cambioProducto || !tocado.convenio) {
        const c = ult && "convenio" in ult.fiscal ? ult.fiscal.convenio : (PAISES[E_("fis_pais").value] || PAISES.XX)[2] / 100;
        E_("fis_convenio").value = c == null || isNaN(c) ? "" : dec(c * 100, 3).replace(/,?0+$/, "");
        tocado.convenio = false;
      }
      // ¿Te retienen? Como en el último cobro de ese producto; si no hay, lo que elegiste para ese banco o bróker.
      const ret = ult ? ult.fiscal.espana > 0 : retieneEspana(p);
      selRetDiv.value = selRetInt.value = ret ? "1" : "0";
      if (cambioProducto) { tocado.origen = false; tocado.espana = false; }
    }

    function recalcula(ponImporte) {
      const on = esDividendo();
      caja.hidden = !on;
      if (usar.checked) caja.removeAttribute("data-off"); else caja.setAttribute("data-off", "");
      // Sin marcar, los campos no se envían (FormData se salta los desactivados).
      caja.querySelectorAll("input[name], select[name]").forEach(el => { el.disabled = !usar.checked || !on; });
      if (!on || !usar.checked) return;

      const p = producto();
      // Intereses: lo de los dividendos (país, origen, convenio) no se ve y va fijo.
      const int = esInteres();
      caja.querySelectorAll(".fmodSoloDiv").forEach(el => { el.hidden = int; });
      caja.querySelectorAll(".fmodSoloInt").forEach(el => { el.hidden = !int; });
      caja.querySelector(".fmodTxtUsar").textContent = int ? "Anotar el bruto y la retención" : "Anotar el bruto y las retenciones";
      caja.querySelector(".fmodTxtBruto").textContent = int ? "Intereses brutos" : "Dividendo bruto";
      caja.querySelector(".fmodTxtEsp").textContent = int ? "Retenido" : "Retenido en España";
      caja.querySelector(".fmodTxtAntes").textContent = int ? "antes de la retención" : "antes de retenciones";
      if (int) { E_("fis_pais").value = "ES"; E_("fis_origen").value = "0"; E_("fis_convenio").value = ""; }
      const pais = E_("fis_pais").value;
      const mon = (f.elements.moneda && f.elements.moneda.value) || "EUR";
      const sim = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF", GBp: "p", GBX: "p" }[mon] || mon;
      caja.querySelectorAll(".fmodSim").forEach(s => { s.textContent = sim; });
      const B = leeNum(E_("fis_bruto").value);
      const pO = tipoOrigen(pais, p);
      if (!tocado.origen) E_("fis_origen").value = B ? dec(B * pO / 100) : "";
      const O = leeNum(E_("fis_origen").value) || 0;
      const retiene = selRetActivo().value === "1";
      // Intereses: según te retengan o no. Dividendo de empresa española: siempre el 19 %. Lo demás, según el bróker.
      const pE = int ? (retiene ? 19 : 0) : pais === "ES" ? 19 : retiene ? 19 : 0;
      const baseE = pais === "ES" ? B : (B || 0) - O;
      if (!tocado.espana) E_("fis_espana").value = B ? dec(Math.max(0, baseE) * pE / 100) : "";
      const R = leeNum(E_("fis_espana").value) || 0;
      caja.querySelector(".fmodPctO").textContent = B ? pctTxt(Math.round(O / B * 1e5) / 1e3) : `habitual ${pctTxt(pO)}`;
      caja.querySelector(".fmodPctE").textContent = B ? pctTxt(Math.round(R / B * 1e5) / 1e3) + " del bruto" : "";

      // El importe del autor = lo que te ingresan.
      const neto = B ? B - O - R : null;
      if (neto != null && ponImporte) {
        escribiendoYo = true;
        E_("importe").value = dec(neto);
        E_("importe").dispatchEvent(new Event("input", { bubbles: true }));
        escribiendoYo = false;
      }
      E_("fis_neto").value = E_("importe").value;

      const convTxt = E_("fis_convenio").value.trim();
      const conv = convTxt === "" ? null : (leeNum(convTxt) || 0) / 100;
      caja.querySelector(".fmodNota").textContent = int
        ? "Los intereses van a la base del ahorro (19 % hasta 6.000 €, 21 % hasta 50.000 €…). Lo que te retiene el banco es un pago a cuenta: si no te retienen nada, lo pagas entero en la Renta."
        : NOTAS[pais] || (conv == null
        ? "Sin convenio: en la Renta deduces lo retenido fuera, como mucho lo que pagarías en España (≈19 %)."
        : `Convenio con ${PAISES[pais] ? PAISES[pais][0] : "ese país"}: deduces como mucho el ${nf(conv * 100, conv * 100 % 1 ? 1 : 0)} % del bruto; lo retenido de más se reclama allí.`);

      const cuentas = caja.querySelector(".fmodCuentas");
      const aviso = caja.querySelector(".fmodAviso");
      if (!B) { cuentas.innerHTML = ""; aviso.hidden = true; return; }
      const c = calcula({ bruto: B, origen: O, espana: R, convenio: conv, pais });
      const v = x => `${nf(x)} ${sim}`;
      const ks = int ? [
        { e: "Te retienen", v: v(R), n: R ? `${nf(R / B * 100, 1)} % del bruto` : "nada: lo pagas en la Renta" },
      ] : [
        { e: "Deduces en la Renta", v: v(c.deducible), n: "por doble imposición" },
        { e: "Reclamable en origen", v: v(c.reclamable), n: c.reclamable ? "lo retenido de más" : "nada de más" },
      ];
      if (c.perdido > 0.004) ks.push({ e: "Se pierde", v: v(c.perdido), n: "ni se deduce ni se reclama" });
      ks.push({ e: c.pendiente >= 0 ? "Te falta pagar" : "Te devuelven", v: v(Math.abs(c.pendiente)), n: "en la Renta, estimado al 19 %" });
      ks.push({ e: "Te queda limpio", v: v(c.limpio), n: `${nf(c.limpio / B * 100, 1)} % del bruto${c.reclamable ? ", más lo que reclames" : ""}` });
      cuentas.innerHTML = ks.map(k => `<div><div class="e">${k.e}</div><div class="v">${k.v}</div><div class="n">${k.n}</div></div>`).join("");
      const imp = leeNum(E_("importe").value);
      const dif = imp != null ? imp - neto : 0;
      aviso.hidden = !(Math.abs(dif) > 0.02);
      aviso.textContent = `Ojo: bruto − ${int ? "retención" : "retenciones"} = ${nf(neto)} ${sim}, pero el importe dice ${nf(imp || 0)} ${sim} (${dif > 0 ? "+" : ""}${nf(dif)}). ` +
        "Puede ser una comisión del bróker o el redondeo del cambio; si no, revisa las cifras.";
    }

    // ---- valores iniciales
    if (fis) {
      usar.checked = true;
      E_("fis_pais").value = PAISES[fis.pais] ? fis.pais : "XX";
      E_("fis_bruto").value = dec(fis.bruto);
      E_("fis_origen").value = dec(fis.origen);
      E_("fis_espana").value = dec(fis.espana);
      E_("fis_convenio").value = fis.convenio == null ? "" : dec(fis.convenio * 100, 3).replace(/,?0+$/, "");
      selRetDiv.value = selRetInt.value = fis.espana > 0 ? "1" : "0";
    } else {
      ponDefectos(false);
      usar.checked = true;   // siempre marcada: basta con escribir el bruto
    }

    usar.addEventListener("change", () => { if (usar.checked && !fis && !E_("fis_bruto").value) ponDefectos(false); recalcula(usar.checked); });
    E_("producto").addEventListener("change", () => { ponDefectos(true); recalcula(true); });
    E_("fis_pais").addEventListener("change", () => {
      tocado.origen = false;
      if (!tocado.convenio) {
        const c = (PAISES[E_("fis_pais").value] || PAISES.XX)[2];
        E_("fis_convenio").value = c == null ? "" : String(c).replace(".", ",");
      }
      recalcula(true);
    });
    // Lo que elijas se recuerda para ese banco o bróker (aparte para intereses y para dividendos).
    [selRetDiv, selRetInt].forEach(sel => sel.addEventListener("change", () => {
      const ent = claveBroker(producto());
      if (ent) { const o = lsLee(); o[ent] = sel.value === "1"; lsGuarda(o); }
      tocado.espana = false;
      recalcula(true);
    }));
    E_("fis_convenio").addEventListener("change", () => { tocado.convenio = true; });
    // Cualquier cambio en el formulario recalcula; si es del bloque de retenciones, también el importe.
    const delBloque = e => !!(e && e.target && caja.contains(e.target));
    f.addEventListener("input", e => { if (!escribiendoYo) recalcula(delBloque(e)); });
    f.addEventListener("change", e => { if (!escribiendoYo) recalcula(delBloque(e)); });
    recalcula(false);
  }

  /* ================================================================
     TABLA DE MOVIMIENTOS (Mis datos → Movimientos)
     ================================================================ */
  // La tabla es del autor (editor.js): no la toco, la completo cuando aparece. En cada dividendo
  // pongo una etiqueta: en verde lo anotado (bruto, país, retenciones) o «sin retenciones» en naranja.
  // Los datos salen de /api/dividendos-mod, pedidos de nuevo cada vez que se pinta la tabla.
  const nf2 = v => Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let pidiendo = 0, programado = null;
  function etiqueta(c, tipoProd) {
    const x = c.fiscal;
    const int = tipoProd === "efectivo" || tipoProd === "p2p";
    if (!(x && x.bruto > 0)) return `<span class="fmodChip no" title="Edítalo y escribe el bruto para que cuente en la pestaña IRPF">sin ${int ? "retención" : "retenciones"}</span>`;
    if (int) return `<span class="fmodChip si" title="Retención anotada">✓ bruto <b>${nf2(x.bruto)} €</b> · ${x.espana ? `retenido ${nf2(x.espana)} €` : "sin retención"}</span>`;
    const pais = (PAISES[x.pais] || [x.pais || "?"])[0];
    const partes = [`bruto <b>${nf2(x.bruto)} €</b>`, escH(pais)];
    partes.push(`origen ${nf2(x.origen)} €`);
    if (x.espana) partes.push(`España ${nf2(x.espana)} €`);
    return `<span class="fmodChip si" title="Retenciones anotadas">✓ ${partes.join(" · ")}</span>`;
  }
  async function marcaTabla() {
    const botones = [...document.querySelectorAll('#editor button[data-acc="editarMov"][data-id]')]
      .filter(b => !b.closest("tr").dataset.fmod);
    if (!botones.length || location.protocol === "file:") return;
    const yo = ++pidiendo;
    let j = null;
    try {
      const r = await fetch("api/dividendos-mod", { cache: "no-store", headers: { Accept: "application/json" } });
      j = r.ok ? await r.json() : null;
    } catch (e) { return; }
    if (yo !== pidiendo || !j || !j.ok) return;
    const porId = new Map((j.cobros || []).filter(c => c.id).map(c => [c.id, c]));
    const info = j.productos || {};
    let con = 0, total = 0;
    document.querySelectorAll('#editor button[data-acc="editarMov"][data-id]').forEach(b => {
      const tr = b.closest("tr");
      const c = porId.get(b.dataset.id);
      const esCobro = c && !(info[c.producto] && info[c.producto].tipo === "inmueble");
      if (esCobro) { total++; if (c.fiscal && c.fiscal.bruto > 0) con++; }
      if (tr.dataset.fmod) return;
      tr.dataset.fmod = "1";
      if (!esCobro) return;
      const celda = tr.children[2];
      if (celda) celda.insertAdjacentHTML("beforeend", "<br>" + etiqueta(c, info[c.producto] && info[c.producto].tipo));
    });
    // Recuento al pie («9 movimientos.»)
    const tabla = document.querySelector('#editor button[data-acc="editarMov"]').closest(".tarjeta");
    const pie = tabla && [...tabla.querySelectorAll("p.subt")].find(p => /movimientos\.$/.test(p.textContent.trim()) || p.dataset.fmod);
    if (pie && total) {
      let span = pie.querySelector(".fmodCuenta");
      if (!span) { span = document.createElement("span"); span.className = "fmodCuenta"; pie.appendChild(span); }
      span.innerHTML = ` · ${con} de ${total} dividendos o intereses con retenciones anotadas` +
        (total - con ? ` (<span style="color:var(--aviso)">faltan ${total - con}</span>)` : " ✓");
      pie.dataset.fmod = "1";
    }
  }
  const editor = document.getElementById("editor");
  if (editor && window.MutationObserver) {
    new MutationObserver(() => {
      clearTimeout(programado);
      programado = setTimeout(marcaTabla, 60);
    }).observe(editor, { childList: true, subtree: true });
  }

  M.fiscal = { PAISES, NOTAS, paisDe, calcula, TIPO_ES };
  M.registra({ formMovimiento });
})();
