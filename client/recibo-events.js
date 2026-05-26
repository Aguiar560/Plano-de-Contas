'use strict';
(function () {
  function fmt(v) {
    return v > 0 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  }

  function rcCalc() {
    var params   = document.getElementById('rc-params');
    var total    = parseFloat(params.dataset.total)    || 0;
    var inssBase = parseFloat(params.dataset.inss)     || 0;

    var dep     = parseInt(document.getElementById('rc_dep').value, 10) || 0;
    var DEP     = 189.59;
    var dedDep  = +(dep * DEP).toFixed(2);
    var inssVal = parseFloat((document.getElementById('rc_inss_desc').textContent || '')
                    .replace(/\./g, '').replace(',', '.')) || inssBase;

    var totalDed = +(dedDep + inssVal).toFixed(2);
    var base     = +(total - totalDed).toFixed(2);
    var aliq = 0, ded = 0;
    if      (base <= 2428.80) { aliq = 0;    ded = 0;      }
    else if (base <= 2826.65) { aliq = 7.5;  ded = 182.16; }
    else if (base <= 3751.05) { aliq = 15;   ded = 394.16; }
    else if (base <= 4664.68) { aliq = 22.5; ded = 675.49; }
    else                      { aliq = 27.5; ded = 908.74; }
    var irrf = aliq > 0 ? +(base * aliq / 100 - ded).toFixed(2) : 0;
    var liq  = +(total - irrf - inssVal).toFixed(2);

    var s = function(id) { return document.getElementById(id); };
    if (s('rc_ded_dep'))   s('rc_ded_dep').textContent   = fmt(dedDep);
    if (s('rc_total_ded')) s('rc_total_ded').innerHTML   = '<strong>' + fmt(totalDed) + '</strong>';
    if (s('rc_base_irrf')) s('rc_base_irrf').textContent = fmt(base);
    if (s('rc_aliq_irrf')) s('rc_aliq_irrf').textContent = aliq > 0 ? aliq.toFixed(2) : '';
    if (s('rc_irrf_rec'))  s('rc_irrf_rec').textContent  = fmt(irrf);
    if (s('rc_val_liq'))   s('rc_val_liq').innerHTML     = '<strong>' + fmt(liq) + '</strong>';
  }

  window.addEventListener('load', function () {
    var btnPrint = document.getElementById('rc-btn-print');
    var btnClose = document.getElementById('rc-btn-close');
    var depInput = document.getElementById('rc_dep');

    if (btnPrint) btnPrint.addEventListener('click', function () { window.print(); });
    if (btnClose) btnClose.addEventListener('click', function () { window.close(); });
    if (depInput) depInput.addEventListener('input', rcCalc);

    setTimeout(function () { window.print(); }, 500);
  });
})();
