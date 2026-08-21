// =============================================================================
// app.js — Painel Vigia (Advocacia Escalável)
//
// v3 — evolução de UI/UX. A lógica de dados, os endpoints, os parâmetros e as
// permissões por departamento são os mesmos da versão anterior. O que mudou:
//
//  - Navegação em 3 seções: Visão geral (operação) → Qualidade da IA →
//    Atendimentos. A operação vem antes da IA.
//  - Uma chamada por combinação de filtros, com cache em estado.dados: trocar
//    de seção não refaz a requisição (antes, cada troca de aba refazia).
//  - Filtro Colaborador/IA virou <select> no mesmo padrão dos outros filtros.
//  - Gráficos com eixo de valores, linhas de grade e tooltip no hover.
//  - Estados de carregando/vazio/erro (com "Tentar de novo") em todas as áreas.
//  - Feedback: hora da última atualização, spinner no botão, toast de erro.
// =============================================================================

// ---------- Configuração ----------
const API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook';

const API_KEY = 'vigia-ae-k7x9mP2qL8wZ4nR1';

// PLACEHOLDER: mapeamento de ID de departamento do Bitrix24 para setor do
// painel. Preencha com os IDs reais (Bitrix24 → Empresa → Estrutura da
// empresa). Enquanto estiver vazio, o painel libera os dois setores e avisa
// no topo, em vez de bloquear silenciosamente o acesso de todo mundo.
const DEPARTAMENTOS_SETOR = {
  // 'ID_DEPARTAMENTO_COMERCIAL': 'comercial',
  // 'ID_DEPARTAMENTO_SUPORTE': 'suporte',
};

const TEMA_STORAGE_KEY = 'ae-tema:painel-vigia-ae';
const nf = new Intl.NumberFormat('pt-BR');
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const hf = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const $ = (id) => document.getElementById(id);

function escapeHtml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(v) { return Number(v) || 0; }
function pct(parte, total) { return total > 0 ? (parte / total) * 100 : 0; }

// ---------- Estado ----------
const estado = {
  tipologia: 'comercial',
  secao: 'visao',
  colaborador: null,      // null | 'ia' | 'colaboradores'  (mesma semântica da API)
  status: 'todos',
  periodos: [],
  periodoRotulo: 'Hoje',
  periodoPreset: 'hoje',
  pagina: 1,
  limite: 25,
  dados: null,            // payload de métricas em cache para os filtros atuais
  carregando: false
};

// =============================================================================
// Períodos
// =============================================================================
function periodoDia(data) {
  return {
    desde: new Date(data.getFullYear(), data.getMonth(), data.getDate(), 0, 0, 0, 0).toISOString(),
    ate: new Date(data.getFullYear(), data.getMonth(), data.getDate(), 23, 59, 59, 999).toISOString()
  };
}
function periodoMes(ano, mes) {
  return {
    desde: new Date(ano, mes, 1, 0, 0, 0, 0).toISOString(),
    ate: new Date(ano, mes + 1, 0, 23, 59, 59, 999).toISOString()
  };
}
function periodoAno(ano) {
  return {
    desde: new Date(ano, 0, 1, 0, 0, 0, 0).toISOString(),
    ate: new Date(ano, 11, 31, 23, 59, 59, 999).toISOString()
  };
}
function periodoTrimestreAtual() {
  const agora = new Date();
  const inicio = Math.floor(agora.getMonth() / 3) * 3;
  return {
    desde: new Date(agora.getFullYear(), inicio, 1, 0, 0, 0, 0).toISOString(),
    ate: new Date(agora.getFullYear(), inicio + 3, 0, 23, 59, 59, 999).toISOString()
  };
}
function periodoSemestreAtual() {
  const agora = new Date();
  const inicio = agora.getMonth() < 6 ? 0 : 6;
  return {
    desde: new Date(agora.getFullYear(), inicio, 1, 0, 0, 0, 0).toISOString(),
    ate: new Date(agora.getFullYear(), inicio + 6, 0, 23, 59, 59, 999).toISOString()
  };
}
function segundaDaSemana(d) {
  const dia = d.getDay();
  const diff = (dia === 0 ? -6 : 1) - dia;
  const seg = new Date(d);
  seg.setDate(d.getDate() + diff);
  seg.setHours(0, 0, 0, 0);
  return seg;
}
function periodoSemana(dataReferencia) {
  const seg = segundaDaSemana(dataReferencia);
  const dom = new Date(seg);
  dom.setDate(seg.getDate() + 6);
  dom.setHours(23, 59, 59, 999);
  return { desde: seg.toISOString(), ate: dom.toISOString() };
}

const PRESETS = {
  'hoje': { rotulo: 'Hoje', calcular: () => periodoDia(new Date()) },
  'semana-atual': { rotulo: 'Semana atual', calcular: () => periodoSemana(new Date()) },
  'semana-anterior': { rotulo: 'Semana anterior', calcular: () => periodoSemana(new Date(Date.now() - 7 * 86400000)) },
  'mes-atual': { rotulo: 'Mês atual', calcular: () => { const a = new Date(); return periodoMes(a.getFullYear(), a.getMonth()); } },
  'mes-anterior': {
    rotulo: 'Mês anterior',
    calcular: () => { const a = new Date(); const m = a.getMonth() - 1; return m < 0 ? periodoMes(a.getFullYear() - 1, 11) : periodoMes(a.getFullYear(), m); }
  },
  'trimestre-atual': { rotulo: 'Trimestre atual', calcular: periodoTrimestreAtual },
  'semestre-atual': { rotulo: 'Semestre atual', calcular: periodoSemestreAtual },
  'ano-atual': { rotulo: 'Ano atual', calcular: () => periodoAno(new Date().getFullYear()) }
};

function formatarBucket(bucket, granularidade) {
  if (!bucket) return '';
  if (granularidade === 'mes') {
    const [ano, mes] = String(bucket).split('-');
    return NOMES_MES[Number(mes) - 1] + '/' + String(ano).slice(2);
  }
  const partes = String(bucket).split('-');
  return partes[2] + '/' + partes[1];
}

// =============================================================================
// Tooltip compartilhado
// =============================================================================
function mostrarTip(html, evento) {
  const tip = $('vg-tip');
  tip.hidden = false;
  tip.innerHTML = html;
  posicionarTip(evento);
  requestAnimationFrame(() => tip.classList.add('is-visivel'));
}
function posicionarTip(evento) {
  const tip = $('vg-tip');
  const caixa = tip.getBoundingClientRect();
  let x = evento.clientX + 14;
  let y = evento.clientY - caixa.height - 12;
  if (x + caixa.width > window.innerWidth - 8) x = evento.clientX - caixa.width - 14;
  if (y < 8) y = evento.clientY + 18;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = y + 'px';
}
function esconderTip() {
  const tip = $('vg-tip');
  tip.classList.remove('is-visivel');
  tip.hidden = true;
}

// =============================================================================
// Toast
// =============================================================================
let toastTimer = null;
function mostrarToast(mensagem) {
  const el = $('vg-toast');
  el.hidden = false;
  el.innerHTML = '<span class="vg-toast__ponto"></span><span>' + escapeHtml(mensagem) + '</span>';
  requestAnimationFrame(() => el.classList.add('is-visivel'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visivel');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 5000);
}

// =============================================================================
// Blocos de estado (carregando / vazio / erro)
// =============================================================================
function blocoVazio(titulo, texto) {
  return `<div class="vg-estado">
    <span class="vg-estado__icone" aria-hidden="true">—</span>
    <p class="vg-estado__titulo">${escapeHtml(titulo)}</p>
    <p class="vg-estado__texto">${escapeHtml(texto || '')}</p>
  </div>`;
}
function blocoErro(texto, comCard) {
  return `<div class="vg-estado vg-estado--erro${comCard ? ' vg-estado--card' : ''}">
    <span class="vg-estado__icone" aria-hidden="true">!</span>
    <p class="vg-estado__titulo">Não foi possível carregar os dados</p>
    <p class="vg-estado__texto">${escapeHtml(texto || 'Tente novamente em alguns instantes.')}</p>
    <button class="ae-btn" type="button" data-acao="recarregar">↻ Tentar de novo</button>
  </div>`;
}
function skeletonKpis(quantos) {
  let html = '';
  for (let i = 0; i < quantos; i++) {
    html += `<div class="vg-kpi"><div class="vg-skel vg-skel--rotulo"></div><div class="vg-skel vg-skel--valor"></div></div>`;
  }
  return html;
}
function skeletonGraficos(quantos) {
  let html = '';
  for (let i = 0; i < quantos; i++) {
    html += `<div class="vg-card${i === 0 ? ' vg-card--largo' : ''}"><div class="vg-skel vg-skel--titulo"></div><div class="vg-skel vg-skel--plot"></div></div>`;
  }
  return html;
}
function pintarCarregandoMetricas() {
  const secao = estado.secao === 'qualidade' ? 'qualidade' : 'visao';
  $('kpis-' + secao).innerHTML = skeletonKpis(secao === 'visao' ? 4 : 3);
  $('graficos-' + secao).innerHTML = skeletonGraficos(3);
}

// =============================================================================
// KPI
// =============================================================================
function cardKpi({ rotulo, valor, apoio, tag, alerta, medidorPct }) {
  return `<div class="vg-kpi${alerta ? ' vg-kpi--alerta' : ''}">
    <div class="vg-kpi__topo">
      <span class="vg-kpi__rotulo" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span>
      ${tag ? `<span class="vg-kpi__tag">${escapeHtml(tag)}</span>` : ''}
    </div>
    <span class="vg-kpi__valor">${valor}</span>
    ${medidorPct != null ? `<span class="vg-kpi__medidor"><i style="width:${Math.max(0, Math.min(100, medidorPct))}%"></i></span>` : ''}
    ${apoio ? `<span class="vg-kpi__apoio">${apoio}</span>` : ''}
  </div>`;
}

// =============================================================================
// Gráficos
// =============================================================================
function ticksEixo(max) {
  const passos = 4;
  const bruto = max / passos;
  const magnitude = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const passo = Math.max(1, Math.ceil(bruto / magnitude) * magnitude);
  const ticks = [];
  for (let v = 0; v <= passo * passos; v += passo) ticks.push(v);
  return { ticks, topo: passo * passos };
}

/**
 * Barras verticais empilhadas com eixo de valores, grade e tooltip.
 * series: [{ chave, rotulo, cor }]
 */
function graficoBarras(container, dados, series, granularidade, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const cfg = opcoes || {};
  if (!dados || !dados.length) {
    el.innerHTML = blocoVazio('Sem dados nesse período', 'Amplie o período ou revise os filtros.');
    return;
  }

  const totais = dados.map(d => series.reduce((acc, s) => acc + num(d[s.chave]), 0));
  const maxReal = Math.max(...totais, 1);
  const { ticks, topo } = ticksEixo(maxReal);

  const legenda = series.map(s => {
    const soma = dados.reduce((acc, d) => acc + num(d[s.chave]), 0);
    return `<span class="vg-legenda__item"><span class="vg-legenda__cor" style="background:${s.cor}"></span>${escapeHtml(s.rotulo)} <b>${nf.format(soma)}</b></span>`;
  }).join('');

  const linhas = ticks.map(v => {
    const base = pct(v, topo);
    return `<div class="vg-plot__linha${v === 0 ? ' vg-plot__linha--base' : ''}" style="bottom:${base}%">
      <span class="vg-plot__tick">${nf.format(v)}</span>
    </div>`;
  }).join('');

  const trilhas = dados.map((d, i) => {
    const total = totais[i];
    const segs = series.map(s => {
      const valor = num(d[s.chave]);
      if (!valor || !total) return '';
      return `<span class="vg-coluna__seg" style="height:${pct(valor, total)}%;background:${s.cor}"></span>`;
    }).join('');
    return `<div class="vg-trilha" data-i="${i}">
      ${cfg.semTotal ? '' : `<span class="vg-trilha__total">${total ? nf.format(total) : ''}</span>`}
      <span class="vg-coluna" style="height:${pct(total, topo)}%">${segs}</span>
    </div>`;
  }).join('');

  const rotulos = dados.map(d => `<span class="vg-xlab">${escapeHtml(formatarBucket(d.bucket, granularidade))}</span>`).join('');

  el.innerHTML = `<div class="vg-legenda">${legenda}</div>
    <div class="vg-plot">
      <div class="vg-plot__area">
        ${linhas}
        <div class="vg-trilhas">${trilhas}</div>
      </div>
    </div>
    <div class="vg-xrow">${rotulos}</div>`;

  el.querySelectorAll('.vg-trilha').forEach(trilha => {
    const d = dados[Number(trilha.dataset.i)];
    const total = totais[Number(trilha.dataset.i)];
    const conteudo = () => {
      const linhasTip = series
        .filter(s => num(d[s.chave]) > 0)
        .map(s => `<span class="vg-tip__linha"><span class="vg-tip__ponto" style="background:${s.cor}"></span><span>${escapeHtml(s.rotulo)}</span><b>${nf.format(num(d[s.chave]))}</b></span>`)
        .join('');
      return `<div class="vg-tip__titulo">${escapeHtml(formatarBucket(d.bucket, granularidade))}</div>
        ${linhasTip || '<span class="vg-tip__linha"><span></span><span>Sem registros</span><b>0</b></span>'}
        <div class="vg-tip__total"><span>Total</span><b>${nf.format(total)}</b></div>`;
    };
    trilha.addEventListener('mouseenter', (e) => mostrarTip(conteudo(), e));
    trilha.addEventListener('mousemove', posicionarTip);
    trilha.addEventListener('mouseleave', esconderTip);
  });
}

/** Barra única 100% + legenda com valor e participação. */
function graficoComposicao(container, partes, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const total = partes.reduce((acc, p) => acc + num(p.valor), 0);
  if (!total) {
    el.innerHTML = blocoVazio('Sem dados nesse período', 'Amplie o período ou revise os filtros.');
    return;
  }
  const segs = partes.filter(p => num(p.valor) > 0).map(p =>
    `<span class="vg-comp__seg" style="width:${pct(num(p.valor), total)}%;background:${p.cor}" title="${escapeHtml(p.rotulo)}: ${nf.format(num(p.valor))}"></span>`
  ).join('');
  const linhas = partes.map(p =>
    `<span class="vg-comp__linha">
      <span class="vg-comp__ponto" style="background:${p.cor}"></span>
      <span class="vg-comp__nome">${escapeHtml(p.rotulo)}</span>
      <span class="vg-comp__valor">${nf.format(num(p.valor))}</span>
      <span class="vg-comp__pct">${nf1.format(pct(num(p.valor), total))}%</span>
    </span>`
  ).join('');
  el.innerHTML = `<div class="vg-comp">${segs}</div>
    <div class="vg-comp__legenda">${linhas}</div>
    ${(opcoes && opcoes.rodape) ? `<p class="vg-card__apoio" style="margin-top:12px">${escapeHtml(opcoes.rodape)}</p>` : ''}`;
}

/** Barras horizontais — melhor que colunas quando o rótulo é texto longo. */
function graficoBarrasH(container, dados, campoRotulo, campoValor, opcoes) {
  const el = typeof container === 'string' ? $(container) : container;
  if (!el) return;
  const cfg = opcoes || {};
  if (!dados || !dados.length) {
    el.innerHTML = blocoVazio('Sem dados nesse período', 'Amplie o período ou revise os filtros.');
    return;
  }
  const itens = dados.slice().sort((a, b) => num(b[campoValor]) - num(a[campoValor]));
  const max = cfg.max || Math.max(...itens.map(d => num(d[campoValor])), 1);
  const linhas = itens.map(d => {
    const valor = num(d[campoValor]);
    const rotulo = String(d[campoRotulo] == null ? '—' : d[campoRotulo]);
    return `<div class="vg-barras__linha">
      <span class="vg-barras__rotulo" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span>
      <span class="vg-barras__trilha"><i class="vg-barras__preenchido" style="width:${pct(valor, max)}%;${cfg.cor ? 'background:' + cfg.cor : ''}"></i></span>
      <span class="vg-barras__valor">${cfg.formatador ? cfg.formatador(valor) : nf.format(valor)}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="vg-barras">${linhas}</div>`;
}

const CORES_FAIXA_SCORE = ['var(--ae-serie-7)', 'var(--ae-serie-1)', 'var(--ae-serie-3)', 'var(--ae-serie-2)', 'var(--ae-serie-5)'];
function seriesFaixasScore(faixas) {
  return (faixas || []).map((f, i) => ({ chave: f.chave, rotulo: f.rotulo, cor: CORES_FAIXA_SCORE[i % CORES_FAIXA_SCORE.length] }));
}

function somarSerie(serie, chave) {
  return (serie || []).reduce((acc, d) => acc + num(d[chave]), 0);
}

function cardGrafico(id, titulo, apoio, largo, nota) {
  return `<div class="vg-card${largo ? ' vg-card--largo' : ''}">
    <div class="vg-card__cabecalho">
      <div>
        <h2 class="vg-card__titulo">${escapeHtml(titulo)}</h2>
        ${apoio ? `<p class="vg-card__apoio">${escapeHtml(apoio)}</p>` : ''}
      </div>
      ${nota ? `<span class="vg-card__nota">${escapeHtml(nota)}</span>` : ''}
    </div>
    <div id="${id}"></div>
  </div>`;
}

// =============================================================================
// Seção: Visão geral
// =============================================================================
function pintarVisaoComercial(dados) {
  const k = dados.kpis || {};
  const serie = dados.serie_desfecho || [];
  const soSofia = somarSerie(serie, 'sofia');
  const transferido = somarSerie(serie, 'humano');
  const automatico = somarSerie(serie, 'automatico');
  const totalSerie = soSofia + transferido + automatico;

  $('kpis-visao').innerHTML = [
    cardKpi({
      rotulo: 'Atendimentos criados',
      valor: nf.format(num(k.total_criados)),
      apoio: 'No período selecionado'
    }),
    cardKpi({
      rotulo: 'Transferidos para humano',
      valor: nf.format(num(k.total_transferido_ia)),
      apoio: num(k.total_criados) ? nf1.format(pct(num(k.total_transferido_ia), num(k.total_criados))) + '% dos criados' : '—',
      medidorPct: pct(num(k.total_transferido_ia), num(k.total_criados))
    }),
    cardKpi({
      rotulo: 'Sem resposta > 1h',
      valor: nf.format(num(k.sem_resposta_60min_agora)),
      tag: 'agora',
      alerta: num(k.sem_resposta_60min_agora) > 0,
      apoio: 'Independe do período'
    }),
    cardKpi({
      rotulo: 'Efetividade da IA',
      valor: k.efetividade_media_pct != null ? nf.format(k.efetividade_media_pct) + '%' : '—',
      apoio: 'Média do score do Vigia',
      medidorPct: k.efetividade_media_pct != null ? num(k.efetividade_media_pct) : null
    })
  ].join('');

  const temColaborador = (dados.por_colaborador || []).length > 0;
  $('graficos-visao').innerHTML =
    cardGrafico('g-serie', 'Atendimentos ao longo do tempo', 'por desfecho do atendimento', true,
      dados.granularidade === 'mes' ? 'por mês' : 'por dia') +
    cardGrafico('g-composicao', 'Composição dos desfechos', 'participação de cada desfecho no período') +
    (temColaborador
      ? cardGrafico('g-colaborador', 'Volume transferido por colaborador', 'o Vigia avalia a IA, não o colaborador humano')
      : cardGrafico('g-colaborador-vazio', 'Volume por colaborador', 'nenhum volume atribuído a colaborador no período'));

  graficoBarras('g-serie', serie, [
    { chave: 'sofia', rotulo: 'Só IA', cor: 'var(--ae-serie-2)' },
    { chave: 'humano', rotulo: 'Transferido', cor: 'var(--ae-serie-1)' },
    { chave: 'automatico', rotulo: 'Automático', cor: 'var(--ae-serie-4)' }
  ], dados.granularidade);

  graficoComposicao('g-composicao', [
    { rotulo: 'Só IA', valor: soSofia, cor: 'var(--ae-serie-2)' },
    { rotulo: 'Transferido para humano', valor: transferido, cor: 'var(--ae-serie-1)' },
    { rotulo: 'Automático', valor: automatico, cor: 'var(--ae-serie-4)' }
  ], { rodape: totalSerie ? nf.format(totalSerie) + ' atendimentos no período' : '' });

  if (temColaborador) {
    graficoBarrasH('g-colaborador', dados.por_colaborador, 'operador', 'quantidade');
  } else {
    $('g-colaborador-vazio').innerHTML = blocoVazio('Sem volume por colaborador', 'Nenhum atendimento com atribuição a colaborador nesse período.');
  }
}

function pintarVisaoSuporte(dados) {
  const k = dados.kpis || {};
  const serie = dados.serie_resolucao || [];
  const soIa = somarSerie(serie, 'ia');
  const comHumano = somarSerie(serie, 'humano');
  const totalSerie = soIa + comHumano;

  $('kpis-visao').innerHTML = [
    cardKpi({ rotulo: 'Atendimentos criados', valor: nf.format(num(k.total_criados)), apoio: 'No período selecionado' }),
    cardKpi({
      rotulo: 'Resolvidos só pela IA',
      valor: nf.format(num(k.total_resolvido_ia)),
      apoio: num(k.total_criados) ? nf1.format(pct(num(k.total_resolvido_ia), num(k.total_criados))) + '% dos criados' : '—',
      medidorPct: pct(num(k.total_resolvido_ia), num(k.total_criados))
    }),
    cardKpi({ rotulo: 'Pedidos gerados pela IA', valor: nf.format(num(k.total_pedidos_ia)), apoio: 'No período selecionado' }),
    cardKpi({
      rotulo: 'Sem resposta > 30min',
      valor: nf.format(num(k.sem_resposta_30min_agora)),
      tag: 'agora',
      alerta: num(k.sem_resposta_30min_agora) > 0,
      apoio: 'Independe do período'
    }),
    cardKpi({
      rotulo: 'Efetividade da IA',
      valor: k.efetividade_media_pct != null ? nf.format(k.efetividade_media_pct) + '%' : '—',
      apoio: 'Média do score do Vigia',
      medidorPct: k.efetividade_media_pct != null ? num(k.efetividade_media_pct) : null
    })
  ].join('');

  const temColaborador = (dados.por_colaborador || []).length > 0;
  $('graficos-visao').innerHTML =
    cardGrafico('g-serie', 'Atendimentos ao longo do tempo', 'por forma de resolução', true,
      dados.granularidade === 'mes' ? 'por mês' : 'por dia') +
    cardGrafico('g-composicao', 'Composição das resoluções', 'participação de cada forma de resolução') +
    cardGrafico('g-pedidos-serie', 'Pedidos gerados pela IA', 'ao longo do tempo') +
    cardGrafico('g-pedidos-tipo', 'Pedidos por tipo de ocorrência') +
    (temColaborador
      ? cardGrafico('g-colaborador', 'Volume com intervenção humana por colaborador', 'o Vigia avalia a IA, não o colaborador humano')
      : cardGrafico('g-colaborador-vazio', 'Volume por colaborador', 'nenhum volume atribuído a colaborador no período'));

  graficoBarras('g-serie', serie, [
    { chave: 'ia', rotulo: 'Só IA', cor: 'var(--ae-serie-2)' },
    { chave: 'humano', rotulo: 'Com humano', cor: 'var(--ae-serie-1)' }
  ], dados.granularidade);

  graficoComposicao('g-composicao', [
    { rotulo: 'Resolvido só pela IA', valor: soIa, cor: 'var(--ae-serie-2)' },
    { rotulo: 'Com intervenção humana', valor: comHumano, cor: 'var(--ae-serie-1)' }
  ], { rodape: totalSerie ? nf.format(totalSerie) + ' atendimentos no período' : '' });

  graficoBarras('g-pedidos-serie', (dados.serie_pedidos || []).map(p => ({ bucket: p.bucket, total: p.quantidade })), [
    { chave: 'total', rotulo: 'Pedidos', cor: 'var(--ae-serie-3)' } /* violeta */
  ], dados.granularidade);

  graficoBarrasH('g-pedidos-tipo', dados.pedidos_por_tipo, 'tipo', 'quantidade', { cor: 'var(--ae-serie-3)' });

  if (temColaborador) {
    graficoBarrasH('g-colaborador', dados.por_colaborador, 'operador', 'quantidade');
  } else {
    $('g-colaborador-vazio').innerHTML = blocoVazio('Sem volume por colaborador', 'Nenhum atendimento com atribuição a colaborador nesse período.');
  }
}

// =============================================================================
// Seção: Qualidade da IA
// =============================================================================
function pintarQualidade(dados) {
  const k = dados.kpis || {};
  const faixas = seriesFaixasScore(dados.distribuicao_score_faixas);
  const serieScore = dados.distribuicao_score_serie || [];
  const avaliados = faixas.reduce((acc, f) => acc + somarSerie(serieScore, f.chave), 0);
  const falhas = (dados.falha_critica || []).reduce((acc, f) => acc + num(f.quantidade), 0);

  $('kpis-qualidade').innerHTML = [
    cardKpi({
      rotulo: 'Efetividade média da IA',
      valor: k.efetividade_media_pct != null ? nf.format(k.efetividade_media_pct) + '%' : '—',
      apoio: 'Score do Vigia no período',
      medidorPct: k.efetividade_media_pct != null ? num(k.efetividade_media_pct) : null
    }),
    cardKpi({
      rotulo: 'Atendimentos avaliados',
      valor: nf.format(avaliados),
      apoio: 'Com score do Vigia no período'
    }),
    cardKpi({
      rotulo: 'Com falha crítica',
      valor: nf.format(falhas),
      alerta: falhas > 0,
      apoio: avaliados ? nf1.format(pct(falhas, avaliados)) + '% dos avaliados' : '—'
    })
  ].join('');

  $('graficos-qualidade').innerHTML =
    cardGrafico('q-distribuicao', 'Distribuição do score de efetividade', 'atendimentos por faixa de nota, ao longo do tempo', true,
      dados.granularidade === 'mes' ? 'por mês' : 'por dia') +
    cardGrafico('q-criterios', estado.tipologia === 'comercial' ? 'Critérios de qualificação' : 'Critérios de suporte', 'média por critério') +
    cardGrafico('q-falha', 'Motivo de falha crítica', 'quantidade por motivo');

  graficoBarras('q-distribuicao', serieScore, faixas, dados.granularidade);
  graficoBarrasH('q-criterios', dados.criterios, 'criterio', 'media', { formatador: v => nf1.format(v) });
  graficoBarrasH('q-falha', dados.falha_critica, 'motivo', 'quantidade', { cor: 'var(--ae-serie-7)' });
}

// =============================================================================
// Auditoria: tabela de atendimentos
// =============================================================================
const COLUNAS_TABELA = 7;

function skeletonTabela() {
  const corpo = $('tabela-corpo');
  corpo.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < COLUNAS_TABELA; c++) {
      const td = document.createElement('td');
      td.innerHTML = '<div class="vg-skel" style="height:13px"></div>';
      tr.appendChild(td);
    }
    corpo.appendChild(tr);
  }
  $('tabela-meta').textContent = 'Carregando…';
  $('paginacao').innerHTML = '';
}
function celulaEstado(html) {
  $('tabela-corpo').innerHTML = `<tr><td colspan="${COLUNAS_TABELA}">${html}</td></tr>`;
}
function badgeSetor(tipologia) {
  if (tipologia === 'comercial') return '<span class="ae-badge ae-badge--info">Comercial</span>';
  if (tipologia === 'suporte') return '<span class="ae-badge">Suporte</span>';
  return '<span class="vg-vazio-celula">—</span>';
}
function badgeStatus(item) {
  return item.finished_at
    ? '<span class="ae-badge ae-badge--ok">Concluído</span>'
    : '<span class="ae-badge ae-badge--alerta">Em aberto</span>';
}
function celulaScore(item) {
  if (item.score_efetividade == null) return '<span class="vg-vazio-celula">—</span>';
  const v = num(item.score_efetividade);
  return `<span class="vg-score">
    <span class="vg-score__valor">${nf.format(v)}</span>
    <span class="vg-score__medidor"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>
  </span>`;
}
function celulaSinais(item) {
  const chips = [];
  if (item.falha_critica) chips.push('<span class="ae-badge ae-badge--erro" title="' + escapeHtml(item.falha_critica) + '">' + escapeHtml(item.falha_critica) + '</span>');
  if (item.sem_resposta_30min) chips.push('<span class="ae-badge ae-badge--alerta">Sem resposta</span>');
  return chips.length ? '<div class="vg-sinais">' + chips.join('') + '</div>' : '<span class="vg-vazio-celula">—</span>';
}
function renderizarTabela(dados) {
  const total = num(dados.total);
  $('tabela-meta').textContent = total ? nf.format(total) + ' no filtro atual' : '';
  if (!dados.itens || !dados.itens.length) {
    celulaEstado(blocoVazio('Nenhum atendimento encontrado', 'Nenhum atendimento nesse período com esses filtros. Amplie o período ou troque o status.'));
    renderizarPaginacao(dados);
    return;
  }
  const corpo = $('tabela-corpo');
  corpo.innerHTML = '';
  for (const item of dados.itens) {
    const tr = document.createElement('tr');
    const nome = escapeHtml(item.contact_name || 'Não informado');
    const cliente = item.chat_id
      ? `<a class="vg-cliente__nome" title="Abrir a conversa no Bitrix24" href="https://advocaciaescalavel.bitrix24.com.br/online/?IM_DIALOG=chat${encodeURIComponent(item.chat_id)}" target="_blank" rel="noopener">${nome}</a>`
      : `<span class="vg-cliente__nome">${nome}</span>`;
    tr.innerHTML = `
      <td><span class="vg-cliente">${cliente}</span></td>
      <td>${badgeSetor(item.tipologia)}</td>
      <td>${item.started_at ? df.format(new Date(item.started_at)) : '<span class="vg-vazio-celula">—</span>'}</td>
      <td>${badgeStatus(item)}</td>
      <td class="vg-tabela__num">${celulaScore(item)}</td>
      <td>${item.justificativa_avaliacao ? '<span class="vg-avaliacao" title="Clique para expandir">' + escapeHtml(item.justificativa_avaliacao) + '</span>' : '<span class="vg-vazio-celula">—</span>'}</td>
      <td>${celulaSinais(item)}</td>
    `;
    corpo.appendChild(tr);
  }
  renderizarPaginacao(dados);
}
function renderizarPaginacao(dados) {
  const el = $('paginacao');
  const total = num(dados.total);
  const totalPaginas = Math.max(1, Math.ceil(total / estado.limite));
  const inicio = total ? (estado.pagina - 1) * estado.limite + 1 : 0;
  const fim = Math.min(total, estado.pagina * estado.limite);
  el.innerHTML = `
    <span class="vg-paginacao__info">${total ? nf.format(inicio) + '–' + nf.format(fim) + ' de ' + nf.format(total) : 'Nenhum resultado'}</span>
    <span class="vg-paginacao__nav">
      <span class="vg-paginacao__info">Página ${estado.pagina} de ${totalPaginas}</span>
      <button class="ae-btn" id="pg-anterior" type="button" ${estado.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <button class="ae-btn" id="pg-proxima" type="button" ${estado.pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
    </span>`;
  const btnAnt = $('pg-anterior');
  const btnProx = $('pg-proxima');
  if (btnAnt) btnAnt.addEventListener('click', () => { estado.pagina--; carregarAtendimentos(); });
  if (btnProx) btnProx.addEventListener('click', () => { estado.pagina++; carregarAtendimentos(); });
}

// =============================================================================
// API
// =============================================================================
async function chamarApi(path, params) {
  if (window.VIGIA_DEMO && window.VigiaDemo) return window.VigiaDemo.responder(path, params, estado);
  const query = new URLSearchParams({ ...params, api_key: API_KEY }).toString();
  const urlFinal = API_BASE.replace(/\/$/, '') + '/' + path + '?' + query;
  const resposta = await fetch(urlFinal, { method: 'GET' });
  if (!resposta.ok) throw new Error('Falha na API (' + resposta.status + ')');
  return resposta.json();
}

function parametrosFiltro() {
  return {
    periodos: JSON.stringify(estado.periodos),
    status: estado.status,
    ...(estado.colaborador ? { colaborador: estado.colaborador } : {})
  };
}

async function carregarMetricas(forcar) {
  if (estado.dados && !forcar) { pintarMetricas(); return; }
  pintarCarregandoMetricas();
  marcarCarregando(true);
  try {
    const path = estado.tipologia === 'comercial' ? 'painel-ae-comercial' : 'painel-ae-suporte';
    estado.dados = await chamarApi(path, parametrosFiltro());
    pintarMetricas();
    marcarAtualizado();
  } catch (e) {
    const secao = estado.secao === 'qualidade' ? 'qualidade' : 'visao';
    $('kpis-' + secao).innerHTML = '';
    $('graficos-' + secao).innerHTML = `<div class="vg-card vg-card--largo">${blocoErro(e.message)}</div>`;
    mostrarToast('Erro ao carregar as métricas: ' + e.message);
    console.error(e);
  }
  marcarCarregando(false);
}

function pintarMetricas() {
  const dados = estado.dados;
  if (!dados) return;
  if (estado.secao === 'qualidade') {
    pintarQualidade(dados);
  } else {
    if (estado.tipologia === 'comercial') pintarVisaoComercial(dados);
    else pintarVisaoSuporte(dados);
  }
  if (window.BX24) BX24.fitWindow();
}

async function carregarAtendimentos() {
  skeletonTabela();
  marcarCarregando(true);
  try {
    const dados = await chamarApi('painel-ae-atendimentos', {
      ...parametrosFiltro(),
      limite: estado.limite,
      pagina: estado.pagina,
      tipologia: estado.tipologia
    });
    renderizarTabela(dados);
    marcarAtualizado();
  } catch (e) {
    $('tabela-meta').textContent = '';
    celulaEstado(blocoErro(e.message));
    $('paginacao').innerHTML = '';
    mostrarToast('Erro ao carregar os atendimentos: ' + e.message);
    console.error(e);
  }
  marcarCarregando(false);
  if (window.BX24) BX24.fitWindow();
}

// =============================================================================
// Feedback de carregamento
// =============================================================================
function marcarCarregando(ligado) {
  estado.carregando = ligado;
  $('btn-atualizar').classList.toggle('is-carregando', ligado);
}
function marcarAtualizado() {
  $('atualizado').textContent = 'Atualizado às ' + hf.format(new Date());
}

// =============================================================================
// Filtros: resumo, limpar, sincronização
// =============================================================================
const ROTULOS_COLABORADOR = { ia: 'Somente IA', colaboradores: 'Somente colaboradores' };
const ROTULOS_STATUS = { aberto: 'Em aberto', concluido: 'Concluídos' };

function atualizarResumoFiltros() {
  const pilulas = [];
  if (estado.colaborador) {
    pilulas.push(`<span class="vg-pilula">Origem: <b>${escapeHtml(ROTULOS_COLABORADOR[estado.colaborador])}</b>
      <button class="vg-pilula__x" type="button" data-limpar="colaborador" aria-label="Remover filtro de origem">×</button></span>`);
  }
  if (estado.status !== 'todos') {
    pilulas.push(`<span class="vg-pilula">Status: <b>${escapeHtml(ROTULOS_STATUS[estado.status])}</b>
      <button class="vg-pilula__x" type="button" data-limpar="status" aria-label="Remover filtro de status">×</button></span>`);
  }
  if (!estado.periodoPreset) {
    pilulas.push(`<span class="vg-pilula">Período: <b>${escapeHtml(estado.periodoRotulo)}</b>
      <button class="vg-pilula__x" type="button" data-limpar="periodo" aria-label="Voltar período para hoje">×</button></span>`);
  }
  const resumo = $('filtros-resumo');
  resumo.innerHTML = pilulas.join('') + (pilulas.length ? '<button class="vg-limpar" type="button" data-limpar="tudo">Limpar filtros</button>' : '');

  $('filtro-colaborador').classList.toggle('is-alterado', !!estado.colaborador);
  $('filtro-status').classList.toggle('is-alterado', estado.status !== 'todos');
  $('btn-periodo').classList.toggle('is-alterado', !estado.periodoPreset);
}

function aplicarPreset(chave, semRecarregar) {
  const preset = PRESETS[chave];
  estado.periodos = [preset.calcular()];
  estado.periodoRotulo = preset.rotulo;
  estado.periodoPreset = chave;
  $('periodo-rotulo').textContent = preset.rotulo;
  document.querySelectorAll('.vg-opcao').forEach(b => b.classList.toggle('is-ativo', b.dataset.preset === chave));
  limparMarcacoesPeriodo();
  if (!semRecarregar) recarregarPorFiltro();
}

function limparMarcacoesPeriodo() {
  document.querySelectorAll('#periodo-popup input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  $('periodo-custom-desde').value = '';
  $('periodo-custom-ate').value = '';
  atualizarContagemPeriodo();
}

function atualizarContagemPeriodo() {
  const marcados = document.querySelectorAll('#periodo-popup input[type="checkbox"]:checked').length;
  const temData = !!($('periodo-custom-desde').value || $('periodo-custom-ate').value);
  const total = marcados + (temData ? 1 : 0);
  $('periodo-contagem').textContent = total
    ? total + (total === 1 ? ' período marcado' : ' períodos marcados')
    : 'Nenhum conjunto marcado';
}

function recarregarPorFiltro() {
  estado.dados = null;
  estado.pagina = 1;
  atualizarResumoFiltros();
  atualizarTudo();
}

// =============================================================================
// Popover de período
// =============================================================================
function abrirPopupPeriodo() {
  $('periodo-popup').hidden = false;
  $('btn-periodo').setAttribute('aria-expanded', 'true');
}
function fecharPopupPeriodo() {
  $('periodo-popup').hidden = true;
  $('btn-periodo').setAttribute('aria-expanded', 'false');
}

function popularListasPeriodo() {
  const agora = new Date();

  const listaMeses = $('lista-meses');
  for (let i = 0; i < 24; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-tipo="mes" data-ano="${d.getFullYear()}" data-mes="${d.getMonth()}"> ${NOMES_MES[d.getMonth()]}/${d.getFullYear()}`;
    listaMeses.appendChild(label);
  }

  const listaSemanas = $('lista-semanas');
  for (let i = 0; i < 12; i++) {
    const ref = new Date(Date.now() - i * 7 * 86400000);
    const seg = segundaDaSemana(ref);
    const dom = new Date(seg);
    dom.setDate(seg.getDate() + 6);
    const rotulo = `${String(seg.getDate()).padStart(2, '0')}/${String(seg.getMonth() + 1).padStart(2, '0')} – ${String(dom.getDate()).padStart(2, '0')}/${String(dom.getMonth() + 1).padStart(2, '0')}`;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-tipo="semana" data-inicio="${seg.toISOString()}"> ${rotulo}`;
    listaSemanas.appendChild(label);
  }

  const listaAnos = $('lista-anos');
  for (let i = 0; i < 5; i++) {
    const ano = agora.getFullYear() - i;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-tipo="ano" data-ano="${ano}"> ${ano}`;
    listaAnos.appendChild(label);
  }
}

function ligarPopupPeriodo() {
  popularListasPeriodo();

  $('btn-periodo').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('periodo-popup').hidden) abrirPopupPeriodo(); else fecharPopupPeriodo();
  });
  $('periodo-popup').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => fecharPopupPeriodo());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharPopupPeriodo(); });
  $('btn-periodo-cancelar').addEventListener('click', fecharPopupPeriodo);
  $('btn-periodo-limpar').addEventListener('click', limparMarcacoesPeriodo);
  $('periodo-popup').addEventListener('change', atualizarContagemPeriodo);

  document.querySelectorAll('.vg-opcao').forEach(botao => {
    botao.addEventListener('click', () => {
      aplicarPreset(botao.dataset.preset);
      fecharPopupPeriodo();
    });
  });

  $('btn-periodo-aplicar').addEventListener('click', () => {
    const periodos = [];
    document.querySelectorAll('#lista-meses input:checked').forEach(cb => {
      periodos.push(periodoMes(Number(cb.dataset.ano), Number(cb.dataset.mes)));
    });
    document.querySelectorAll('#lista-semanas input:checked').forEach(cb => {
      periodos.push(periodoSemana(new Date(cb.dataset.inicio)));
    });
    document.querySelectorAll('#lista-anos input:checked').forEach(cb => {
      periodos.push(periodoAno(Number(cb.dataset.ano)));
    });
    const desdeCustom = $('periodo-custom-desde').value;
    const ateCustom = $('periodo-custom-ate').value;
    if (desdeCustom && ateCustom) {
      periodos.push({
        desde: new Date(desdeCustom + 'T00:00:00').toISOString(),
        ate: new Date(ateCustom + 'T23:59:59').toISOString()
      });
    } else if (desdeCustom) {
      periodos.push(periodoDia(new Date(desdeCustom + 'T00:00:00')));
    } else if (ateCustom) {
      periodos.push(periodoDia(new Date(ateCustom + 'T00:00:00')));
    }
    if (!periodos.length) { fecharPopupPeriodo(); return; }

    estado.periodos = periodos;
    estado.periodoPreset = null;
    estado.periodoRotulo = periodos.length === 1 ? 'Período personalizado' : periodos.length + ' períodos';
    $('periodo-rotulo').textContent = estado.periodoRotulo;
    document.querySelectorAll('.vg-opcao').forEach(b => b.classList.remove('is-ativo'));
    fecharPopupPeriodo();
    recarregarPorFiltro();
  });
}

// =============================================================================
// Logo
// =============================================================================
async function carregarLogos() {
  try {
    const [completo, isotipo] = await Promise.all([
      fetch('assets/logo-completo.svg').then(r => r.text()),
      fetch('assets/isotipo-gradiente.svg').then(r => r.text())
    ]);
    $('logo-completo').innerHTML = completo;
    $('logo-rodape').innerHTML = completo;
    $('logo-isotipo').innerHTML = isotipo;
  } catch (e) {
    console.warn('Não foi possível carregar os SVGs da marca.', e);
  }
}

// =============================================================================
// Tema
// =============================================================================
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  try { localStorage.setItem(TEMA_STORAGE_KEY, tema); } catch (e) {}
}
function alternarTema() {
  const atual = document.documentElement.getAttribute('data-tema') || 'claro';
  aplicarTema(atual === 'claro' ? 'escuro' : 'claro');
}

// =============================================================================
// Permissão por departamento (Bitrix24)
// =============================================================================
function aplicarPermissoesSetor(departamentosUsuario) {
  const mapeamentoConfigurado = Object.keys(DEPARTAMENTOS_SETOR).length > 0;
  const avisoEl = $('aviso-permissao');

  if (!mapeamentoConfigurado) {
    document.querySelectorAll('.vg-seg__item[data-tipologia]').forEach(el => { el.hidden = false; });
    avisoEl.hidden = false;
    return;
  }

  avisoEl.hidden = true;
  const setoresPermitidos = new Set(
    (departamentosUsuario || []).map(id => DEPARTAMENTOS_SETOR[String(id)]).filter(Boolean)
  );

  document.querySelectorAll('.vg-seg__item[data-tipologia]').forEach(el => {
    el.hidden = !setoresPermitidos.has(el.dataset.tipologia);
  });

  const ativoAtual = document.querySelector('.vg-seg__item.is-ativo');
  if (ativoAtual && ativoAtual.hidden) {
    const primeiroVisivel = document.querySelector('.vg-seg__item[data-tipologia]:not([hidden])');
    if (primeiroVisivel) selecionarSetor(primeiroVisivel.dataset.tipologia);
  }
}

function verificarPermissoes() {
  if (!window.BX24 || !BX24.callMethod) { aplicarPermissoesSetor([]); return; }
  BX24.callMethod('user.current', {}, (resultado) => {
    if (resultado.error()) { aplicarPermissoesSetor([]); return; }
    const dados = resultado.data() || {};
    aplicarPermissoesSetor(dados.UF_DEPARTMENT || []);
  });
}

// =============================================================================
// Orquestração
// =============================================================================
async function atualizarTudo(forcar) {
  if (estado.secao === 'auditoria') await carregarAtendimentos();
  else await carregarMetricas(forcar);
}

function selecionarSetor(tipologia) {
  document.querySelectorAll('.vg-seg__item[data-tipologia]').forEach(b => {
    const ativo = b.dataset.tipologia === tipologia;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
  estado.tipologia = tipologia;
  estado.dados = null;
  estado.pagina = 1;
  atualizarTudo();
}

function selecionarSecao(secao) {
  document.querySelectorAll('.vg-abas__item').forEach(b => {
    const ativo = b.dataset.secao === secao;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  $('secao-visao').hidden = secao !== 'visao';
  $('secao-qualidade').hidden = secao !== 'qualidade';
  $('secao-auditoria').hidden = secao !== 'auditoria';
  estado.secao = secao;
  esconderTip();
  atualizarTudo();
}

function ligarNavegacao() {
  document.querySelectorAll('.vg-seg__item[data-tipologia]').forEach(botao => {
    botao.addEventListener('click', () => selecionarSetor(botao.dataset.tipologia));
  });
  document.querySelectorAll('.vg-abas__item').forEach(botao => {
    botao.addEventListener('click', () => selecionarSecao(botao.dataset.secao));
  });

  $('filtro-colaborador').addEventListener('change', (e) => {
    estado.colaborador = e.target.value === 'todos' ? null : e.target.value;
    recarregarPorFiltro();
  });
  $('filtro-status').addEventListener('change', (e) => {
    estado.status = e.target.value;
    recarregarPorFiltro();
  });
  $('filtro-limite').addEventListener('change', (e) => {
    estado.limite = Number(e.target.value);
    estado.pagina = 1;
    carregarAtendimentos();
  });

  $('filtros-resumo').addEventListener('click', (e) => {
    const alvo = e.target.closest('[data-limpar]');
    if (!alvo) return;
    const qual = alvo.dataset.limpar;
    if (qual === 'colaborador' || qual === 'tudo') { estado.colaborador = null; $('filtro-colaborador').value = 'todos'; }
    if (qual === 'status' || qual === 'tudo') { estado.status = 'todos'; $('filtro-status').value = 'todos'; }
    if (qual === 'periodo' || qual === 'tudo') aplicarPreset('hoje', true);
    recarregarPorFiltro();
  });

  $('tabela-corpo').addEventListener('click', (e) => {
    const alvo = e.target.closest('.vg-avaliacao');
    if (alvo) alvo.classList.toggle('is-expandida');
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-acao="recarregar"]')) atualizarTudo(true);
  });

  $('btn-atualizar').addEventListener('click', () => atualizarTudo(true));
  $('btn-tema').addEventListener('click', alternarTema);
}

// =============================================================================
// Inicialização
// =============================================================================
function iniciar() {
  aplicarPreset('hoje', true);
  atualizarResumoFiltros();
  carregarLogos();
  ligarNavegacao();
  ligarPopupPeriodo();
  verificarPermissoes();
  atualizarTudo();
}

if (window.BX24) {
  BX24.init(() => { iniciar(); BX24.fitWindow(); });
} else {
  document.addEventListener('DOMContentLoaded', iniciar);
}
