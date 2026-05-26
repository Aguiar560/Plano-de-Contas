'use strict';

const _RECIBO_SEQ_KEY = 'plano_recibo_seq';


function _reciboNextNum() {
  const ano = new Date().getFullYear();
  let stored = { ano: 0, seq: 0 };
  try { stored = JSON.parse(localStorage.getItem(_RECIBO_SEQ_KEY) || '{}'); } catch {}
  const seq = (stored.ano === ano ? (stored.seq || 0) : 0) + 1;
  localStorage.setItem(_RECIBO_SEQ_KEY, JSON.stringify({ ano, seq }));
  return { seq, ano, num: String(seq).padStart(4, '0'), formatted: String(seq).padStart(4, '0') + '/' + ano };
}

function _reciboFmt(v) {
  return (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _reciboFmtData(iso) {
  if (!iso) return '';
  const p = (iso || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function _extensoBRL(valor) {
  valor = Math.round(parseFloat(valor) * 100) / 100;
  if (isNaN(valor) || valor < 0) return '';
  const inteiro = Math.floor(valor);
  const cents   = Math.round((valor - inteiro) * 100);

  const un = ['','um','dois','três','quatro','cinco','seis','sete','oito','nove',
              'dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const dz = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  const ct = ['','cento','duzentos','trezentos','quatrocentos','quinhentos',
              'seiscentos','setecentos','oitocentos','novecentos'];

  function centenas(x) {
    if (x === 100) return 'cem';
    let s = '';
    if (x >= 100) { s = ct[Math.floor(x / 100)]; x %= 100; if (x > 0) s += ' e '; }
    if (x >= 20)  { s += dz[Math.floor(x / 10)]; if (x % 10) s += ' e ' + un[x % 10]; }
    else if (x > 0) s += un[x];
    return s;
  }

  function numPT(n) {
    if (n === 0) return 'zero';
    if (n < 1000) return centenas(n);
    const mil = Math.floor(n / 1000);
    const resto = n % 1000;
    let s = mil === 1 ? 'mil' : centenas(mil) + ' mil';
    if (resto > 0) s += (resto < 100 ? ' e ' : ' ') + centenas(resto);
    return s;
  }

  const partes = [];
  if (inteiro > 0) partes.push(numPT(inteiro) + (inteiro === 1 ? ' real' : ' reais'));
  if (cents   > 0) partes.push(numPT(cents)   + (cents   === 1 ? ' centavo' : ' centavos'));
  return partes.join(' e ') || 'zero reais';
}

function _reciboEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _getOrgData() {
  const b = (typeof BRANDING !== 'undefined') ? BRANDING : {};
  const ls = k => localStorage.getItem(k) || '';
  return {
    nome:         ls('plano_branding_company')    || b.company      || '',
    razaoSocial:  ls('plano_recibo_razao')         || b.razaoSocial  || (ls('plano_branding_company') || b.company || '').toUpperCase(),
    cnpj:         ls('plano_recibo_cnpj')          || b.cnpj         || '',
    endereco:     ls('plano_recibo_endereco')       || b.endereco     || '',
    bairroCidade: ls('plano_recibo_bairroCidade')   || b.bairroCidade || '',
    cepCidade:    ls('plano_recibo_cepCidade')      || b.cepCidade    || '',
    email:        ls('plano_recibo_email')          || b.email        || '',
    site:         ls('plano_recibo_site')           || b.site         || '',
    responsavel:  ls('plano_recibo_responsavel')    || b.responsavel  || 'Responsável pela Associação',
  };
}

function _htmlRecibo({ org, recibo, forn, itens, total, totalExtenso, serverOrigin }) {
  const logoSrc = serverOrigin + '/logo-pmb.png';
  // Pad items to 3
  while (itens.length < 3) itens.push({ descricao: '', valor: 0 });
  const fmtV = v => v > 0 ? _reciboFmt(v) : '';
  const esc  = _reciboEsc;

  // INSS: 11% of total
  const inssBase  = total;
  const inssAliq  = 11;
  const inssValor = +(inssBase * inssAliq / 100).toFixed(2);

  // IRRF (tabela progressiva 2026)
  const baseIrrf = +(total - inssValor).toFixed(2);
  let irrfAliq = 0, irrfDeducao = 0;
  if      (baseIrrf <= 2428.80) { irrfAliq = 0;    irrfDeducao = 0;      }
  else if (baseIrrf <= 2826.65) { irrfAliq = 7.5;  irrfDeducao = 182.16; }
  else if (baseIrrf <= 3751.05) { irrfAliq = 15;   irrfDeducao = 394.16; }
  else if (baseIrrf <= 4664.68) { irrfAliq = 22.5; irrfDeducao = 675.49; }
  else                          { irrfAliq = 27.5; irrfDeducao = 908.74; }
  const irrfValor    = irrfAliq > 0 ? +(baseIrrf * irrfAliq / 100 - irrfDeducao).toFixed(2) : 0;
  const totalDed     = +(inssValor + (irrfAliq > 0 ? inssValor : 0)).toFixed(2); // dep ded + INSS
  const valorLiquido = +(total - irrfValor - inssValor).toFixed(2);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Recibo de Autônomo Nº ${esc(recibo.formatted)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;background:#f0f0f0;color:#000}
.page-wrap{background:#fff;width:247mm;min-height:170mm;margin:4mm auto;padding:5mm 7mm;border:1px solid #ccc}
.no-print{text-align:center;padding:7px;background:#374151;display:flex;gap:8px;align-items:center;justify-content:center;position:sticky;top:0;z-index:99}
/* Header */
.hdr{display:flex;align-items:flex-start;gap:8px;border-bottom:2px solid #1a4d2e;padding-bottom:4px}
.hdr-logo{flex-shrink:0;width:90px;height:90px;border-radius:50%;border:3px solid #1a4d2e;display:flex;align-items:center;justify-content:center;text-align:center;font-size:7.5px;font-weight:800;color:#1a4d2e;line-height:1.3;padding:4px}
.hdr-info{flex:1;text-align:center}
.hdr-info .h1{font-size:18px;font-weight:900;color:#1a4d2e;letter-spacing:.5px}
.hdr-info .h2{font-size:11.5px;font-weight:700;color:#1a4d2e}
.hdr-info .h3{font-size:10.5px;font-weight:700}
.hdr-info .h4{font-size:10px;line-height:1.5}
.hdr-boxes{display:flex;flex-direction:column;gap:5px;flex-shrink:0;min-width:150px}
.hdr-box{border:1.5px solid #000;padding:5px 8px;font-size:11.5px;font-weight:700;white-space:nowrap}
.hdr-box span{font-weight:400;font-size:11px}
/* Title bar */
.title-bar{background:#1a4d2e;color:#fff;text-align:center;font-size:14px;font-weight:900;padding:5px 0;margin:5px 0;letter-spacing:2px;text-transform:uppercase}
/* Text fields row */
.tf-row{display:flex;gap:16px;margin:4px 0;font-size:10.5px;align-items:flex-end}
.tf-label{white-space:nowrap;font-weight:700}
.tf-val{flex:1;border-bottom:1px solid #000;min-height:15px;padding-bottom:1px;outline:none}
.tf-val[contenteditable]:focus{background:#ffffcc}
.recebi-block{margin:5px 0;font-size:10.5px;line-height:1.7}
.recebi-block strong{font-weight:700}
.ul{display:inline-block;min-width:100px;border-bottom:1px solid #000;vertical-align:bottom;outline:none;padding:0 2px}
.ul[contenteditable]:focus{background:#ffffcc}
/* Two-column table */
.cols{display:flex;border:1.5px solid #aaa;margin:5px 0}
.col-l{width:50%;border-right:1.5px solid #aaa}
.col-r{width:50%}
.sec-hdr{background:#c5d8b8;text-align:center;font-size:10px;font-weight:800;padding:3px 4px;border-bottom:1px solid #aaa;letter-spacing:.3px;text-transform:uppercase}
.sr{display:flex;align-items:center;border-bottom:1px solid #ddd;padding:2px 6px;min-height:19px;gap:3px}
.sr:last-child{border-bottom:none}
.sr .lbl{flex:1;font-size:9.5px}
.sr .unit{font-size:9.5px;white-space:nowrap}
.sr .val{font-size:9.5px;min-width:82px;border-bottom:1px solid #000;text-align:right;padding:0 3px;outline:none;min-height:13px}
.sr .val[contenteditable]:focus,.sr input:focus{background:#ffffcc}
.sr input[type=number]{width:38px;border:1px solid #888;font-size:9.5px;text-align:center;padding:1px 2px;font-family:inherit}
.sr.bold{background:#f5f5cc;font-weight:700}
.sr.hilight{background:#fff0b3;font-weight:700}
/* Identificação */
.id-hdr{background:#c5d8b8;text-align:center;font-size:10px;font-weight:800;padding:3px 4px;border:1.5px solid #aaa;border-bottom:none;margin-top:5px;letter-spacing:.3px;text-transform:uppercase}
.id-body{border:1.5px solid #aaa;border-top:none;padding:4px 6px}
.id-row{display:flex;align-items:flex-end;gap:6px;margin:3px 0;font-size:10px}
.id-lbl{white-space:nowrap;font-weight:700}
.id-val{flex:1;border-bottom:1px solid #000;min-height:15px;outline:none;padding:0 2px}
.id-val[contenteditable]:focus{background:#ffffcc}
.decl{font-size:9.5px;margin:5px 0}
.assin{display:flex;justify-content:space-between;margin-top:14px}
.assin-blk{text-align:center;font-size:10px}
.assin-line{border-top:1.5px solid #000;width:190px;margin:0 auto 3px}
@media print{
  body{background:#fff}
  .no-print{display:none!important}
  .page-wrap{border:none;margin:0;padding:4mm 6mm;width:100%;min-height:auto}
  @page{size:A4 landscape;margin:8mm 8mm 6mm}
  [contenteditable]{outline:none!important;background:transparent!important}
}
</style>
</head>
<body>

<div class="no-print">
  <span style="color:#d1d5db;font-size:12px">Recibo Nº ${esc(recibo.formatted)} — verifique os dados antes de imprimir</span>
  <button id="rc-btn-print" style="padding:5px 20px;background:#16a34a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700">&#128438; Imprimir</button>
  <button id="rc-btn-close" style="padding:5px 14px;background:#6b7280;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">Fechar</button>
</div>

<div class="page-wrap">

  <!-- Header -->
  <div class="hdr">
    <div class="hdr-logo" style="padding:0;overflow:hidden">
      <img src="${esc(logoSrc)}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">
    </div>
    <div class="hdr-info">
      <div class="h1">${esc(org.nome)}</div>
      <div class="h2">${esc(org.razaoSocial)}</div>
      ${org.cnpj        ? `<div class="h3">CNPJ: ${esc(org.cnpj)}</div>`           : ''}
      ${org.endereco    ? `<div class="h4">${esc(org.endereco)}</div>`              : ''}
      ${org.bairroCidade? `<div class="h4">${esc(org.bairroCidade)}</div>`          : ''}
      ${org.cepCidade   ? `<div class="h4">${esc(org.cepCidade)}</div>`             : ''}
      ${org.email       ? `<div class="h4">E-mail: ${esc(org.email)}</div>`         : ''}
      ${org.site        ? `<div class="h4">Site: ${esc(org.site)}</div>`            : ''}
    </div>
    <div class="hdr-boxes">
      <div class="hdr-box">RECIBO N°&nbsp;&nbsp;<span contenteditable="true">${esc(recibo.formatted)}</span></div>
      <div class="hdr-box">DATA:&nbsp;&nbsp;<span contenteditable="true">${esc(recibo.data)}</span></div>
    </div>
  </div>

  <!-- Title -->
  <div class="title-bar">Recibo de Pagamento a Autônomo</div>

  <!-- Obra / Projeto -->
  <div class="tf-row">
    <span class="tf-label">Obra / Projeto:</span>
    <span class="tf-val" contenteditable="true">${esc(recibo.projeto)}</span>
    <span class="tf-label" style="margin-left:12px">Recibo Nº/Ano:</span>
    <span contenteditable="true" style="min-width:110px;border-bottom:1px solid #000;padding-bottom:1px;outline:none">${esc(recibo.formatted)}</span>
  </div>

  <!-- Recebi da -->
  <div class="recebi-block">
    Recebi da <strong>${esc(org.razaoSocial)}</strong>, a importância de R$&nbsp;<span class="ul" contenteditable="true">${_reciboFmt(total)}</span>
  </div>
  <div class="recebi-block">
    (<span class="ul" contenteditable="true" style="min-width:220px">${esc(totalExtenso)}</span>&nbsp;reais), referente ao serviço de
    <span class="ul" contenteditable="true" style="min-width:160px">${esc(recibo.servico)}</span>.
  </div>

  <!-- Two-column section -->
  <div class="cols">

    <!-- LEFT -->
    <div class="col-l">
      <div class="sec-hdr">Informações e Dedução do IRRF</div>

      <div class="sr">
        <span class="lbl">Dependentes (QTDE.) ............................................</span>
        <input type="number" id="rc_dep" min="0" max="20" value="0"
          style="width:40px;border:1px solid #999;font-size:9.5px;text-align:center;padding:1px;font-family:inherit">
      </div>
      <div class="sr">
        <span class="lbl">Dedução de dependentes .........................................</span>
        <span class="unit">R$</span>
        <span class="val" id="rc_ded_dep" contenteditable="true"></span>
      </div>
      <div class="sr">
        <span class="lbl">Desconto de INSS ...................................................</span>
        <span class="unit">R$</span>
        <span class="val" id="rc_inss_desc" contenteditable="true">${_reciboFmt(inssValor)}</span>
      </div>
      <div class="sr bold">
        <span class="lbl"><strong>Total de deduções IRRF ...................................</strong></span>
        <span class="unit"><strong>R$</strong></span>
        <span class="val" id="rc_total_ded" contenteditable="true"><strong>${_reciboFmt(inssValor)}</strong></span>
      </div>
      <div class="sr">
        <span class="lbl">Base de Cálculo IRRF .............................................</span>
        <span class="unit">R$</span>
        <span class="val" id="rc_base_irrf" contenteditable="true">${_reciboFmt(baseIrrf)}</span>
      </div>
      <div class="sr">
        <span class="lbl">Alíquota IRRF (%) ...................................................</span>
        <span class="val" id="rc_aliq_irrf" contenteditable="true">${irrfAliq > 0 ? irrfAliq.toFixed(2) : ''}</span>
        <span class="unit">%</span>
      </div>
      <div class="sr">
        <span class="lbl">Valor a Recolher .......................................................</span>
        <span class="unit">R$</span>
        <span class="val" id="rc_irrf_rec" contenteditable="true">${irrfValor > 0 ? _reciboFmt(irrfValor) : ''}</span>
      </div>

      <div class="sec-hdr">Cálculo do INSS</div>

      <div class="sr">
        <span class="lbl">Base de Cálculo .......................................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true">${_reciboFmt(inssBase)}</span>
      </div>
      <div class="sr">
        <span class="lbl">Alíquota INSS (contribuição mínima) .....................</span>
        <span class="val">11,00</span>
        <span class="unit">%</span>
      </div>
      <div class="sr">
        <span class="lbl">Valor a Recolher .......................................................</span>
        <span class="unit">R$</span>
        <span class="val" id="rc_inss_rec" contenteditable="true">${_reciboFmt(inssValor)}</span>
      </div>
    </div>

    <!-- RIGHT -->
    <div class="col-r">
      <div class="sec-hdr">Especificações do Serviço</div>

      <div class="sr">
        <span class="lbl">Valor do Serviço - 01 ............................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true">${fmtV(itens[0].valor)}</span>
      </div>
      <div class="sr">
        <span class="lbl">Valor do Serviço - 02 ............................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true">${fmtV(itens[1].valor)}</span>
      </div>
      <div class="sr">
        <span class="lbl">Valor do Serviço - 03 ............................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true">${fmtV(itens[2].valor)}</span>
      </div>
      <div class="sr bold">
        <span class="lbl"><strong>Total do Serviço .............................................</strong></span>
        <span class="unit"><strong>R$</strong></span>
        <span class="val" contenteditable="true"><strong>${_reciboFmt(total)}</strong></span>
      </div>

      <div class="sec-hdr">Descontos</div>

      <div class="sr">
        <span class="lbl">IRRF ........................................................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true">${irrfValor > 0 ? _reciboFmt(irrfValor) : ''}</span>
      </div>
      <div class="sr">
        <span class="lbl">ISS Retido ..............................................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true"></span>
      </div>
      <div class="sr">
        <span class="lbl">INSS .........................................................................</span>
        <span class="unit">R$</span>
        <span class="val" contenteditable="true">${_reciboFmt(inssValor)}</span>
      </div>
      <div class="sr hilight">
        <span class="lbl"><strong>Valor Líquido do Serviço .................................</strong></span>
        <span class="unit"><strong>R$</strong></span>
        <span class="val" id="rc_val_liq" contenteditable="true"><strong>${_reciboFmt(valorLiquido)}</strong></span>
      </div>
    </div>
  </div>

  <!-- Identificação do Autônomo -->
  <div class="id-hdr">Identificação do Autônomo</div>
  <div class="id-body">
    <div class="id-row">
      <span class="id-lbl">Nome:</span>
      <span class="id-val" contenteditable="true">${esc(forn.nome)}</span>
    </div>
    <div class="id-row">
      <span class="id-lbl">Endereço:</span>
      <span class="id-val" contenteditable="true">${esc(forn.endereco)}</span>
    </div>
    <div class="id-row">
      <span class="id-lbl">Nº INSS/PIS:</span>
      <span class="id-val" contenteditable="true" style="max-width:160px">${esc(forn.inssPis)}</span>
      <span class="id-lbl" style="margin-left:6px">CPF:</span>
      <span class="id-val" contenteditable="true" style="max-width:130px">${esc(forn.cpf)}</span>
      <span class="id-lbl" style="margin-left:6px">Identidade (RG):</span>
      <span class="id-val" contenteditable="true">${esc(forn.rg)}</span>
    </div>
    <div class="id-row">
      <span class="id-lbl">Título de Eleitor:</span>
      <span class="id-val" contenteditable="true" style="max-width:210px">${esc(forn.tituloEleitor)}</span>
      <span class="id-lbl" style="margin-left:20px">Data de Nascimento:</span>
      <span contenteditable="true" style="min-width:80px;border-bottom:1px solid #000;text-align:center;outline:none;padding:0 2px">${esc(forn.dataNascimento)}</span>
    </div>
  </div>

  <!-- Declaration -->
  <div class="decl">
    Declaro que o serviço acima descrito foi executado e recebi a importância líquida discriminada neste recibo.
  </div>

  <!-- Signatures -->
  <div class="assin">
    <div class="assin-blk">
      <div class="assin-line"></div>
      <div>Assinatura do Autônomo</div>
    </div>
    <div class="assin-blk">
      <div class="assin-line"></div>
      <div>${esc(org.responsavel)}</div>
      <div style="font-weight:700">${esc(org.razaoSocial || org.nome)}</div>
    </div>
  </div>

</div>

<div id="rc-params" data-total="${total}" data-inss="${inssValor}" style="display:none"></div>
<script src="${esc(serverOrigin)}/client/recibo-events.js"></script>
</body>
</html>`;
}

async function abrirReciboAutonomo({ lancamento, conta, fornecedor, reciboFormatted }) {
  if (!fornecedor) {
    if (typeof showToast === 'function') showToast('Selecione um fornecedor para gerar o recibo.', 'warning');
    return;
  }

  const itens = (lancamento.itens && lancamento.itens.length)
    ? lancamento.itens.slice(0, 3)
    : [{ descricao: lancamento.descricao || (conta ? conta.nome : ''), valor: lancamento.valor }];
  const total = itens.reduce((s, i) => s + (parseFloat(i.valor) || 0), 0);

  // Reimpressão: usa número já existente sem criar novo registro
  let formatted = reciboFormatted || null;
  if (!formatted) {
    try {
      const dataISO = lancamento.data || new Date().toISOString().slice(0, 10);
      const resp = await fetch('/api/recibos', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lancamento_id:   lancamento.id    || undefined,
          conta_codigo:    conta ? conta.codigo : undefined,
          fornecedor_nome: fornecedor.razaoSocial || '',
          fornecedor_cpf:  fornecedor.cpf || undefined,
          data:            dataISO,
          valor:           total,
          descricao:       lancamento.descricao || (conta ? conta.nome : '') || undefined,
        }),
      });
      const j = await resp.json();
      if (j && j.ok && j.formatted) formatted = j.formatted;
    } catch (e) {
      if (typeof log !== 'undefined') log.warn('Recibo: falha ao registrar no servidor, usando sequência local', e);
    }
    if (!formatted) formatted = _reciboNextNum().formatted;
  }

  const endParts = [
    fornecedor.logradouro,
    fornecedor.numero,
    fornecedor.complemento,
    fornecedor.bairro,
    (fornecedor.cidade && fornecedor.uf)
      ? fornecedor.cidade + '/' + fornecedor.uf
      : (fornecedor.cidade || fornecedor.uf || ''),
  ].filter(Boolean);

  const org = _getOrgData();
  const serverOrigin = window.location.origin;

  const html = _htmlRecibo({
    org,
    recibo: {
      formatted,
      data:    _reciboFmtData(lancamento.data),
      projeto: 'FUNDAÇÃO CASA',
      servico: lancamento.descricao || (conta ? conta.nome : '') || '',
    },
    forn: {
      nome:           fornecedor.razaoSocial || '',
      endereco:       endParts.join(', '),
      cpf:            fornecedor.cpf           || '',
      rg:             fornecedor.rg            || '',
      inssPis:        fornecedor.inssPis       || '',
      tituloEleitor:  fornecedor.tituloEleitor || '',
      dataNascimento: fornecedor.dataNascimento || '',
    },
    itens,
    total,
    totalExtenso: _extensoBRL(total),
    serverOrigin,
  });

  const blob    = new Blob([html], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank', 'width=1180,height=860,scrollbars=yes,menubar=yes,toolbar=yes');
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    if (typeof showToast === 'function') showToast('Permita popups neste site para gerar o recibo.', 'warning');
    return;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

window.abrirReciboAutonomo = abrirReciboAutonomo;
