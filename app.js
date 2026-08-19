// =============================================================================
// app.js — Painel Vigia (Advocacia Escalável)
// Dashboards por setor (Comercial/Suporte) com filtro de período (atalhos +
// conjunto selecionável não-contínuo), colaborador/IA e status, e gráficos
// de decomposição. Aba Auditoria mantém a lista/detalhe dos atendimentos.
// =============================================================================

// ---------- Configuração ----------
const API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook';

const API_KEY = 'vigia-ae-k7x9mP2qL8wZ4nR1';

// PLACEHOLDER: mapeamento de ID de departamento do Bitrix24 para setor do
// painel. Preencha com os IDs reais (Bitrix24 → Empresa → Estrutura da
// empresa). Enquanto estiver vazio, o painel libera os dois setores e avisa
// na sidebar, em vez de bloquear silenciosamente o acesso de todo mundo.
const DEPARTAMENTOS_SETOR = {
  // 'ID_DEPARTAMENTO_COMERCIAL': 'comercial',
  // 'ID_DEPARTAMENTO_SUPORTE': 'suporte',
};

const TEMA_STORAGE_KEY = 'ae-tema:painel-vigia-ae';
const nf = new Intl.NumberFormat('pt-BR');
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function escapeHtml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Estado ----------
const estado = {
  tipologia: 'comercial',
  secao: 'metricas',
  colaborador: null,
  status: 'todos',
  periodos: [],
  periodoRotulo: 'Hoje',
  pagina: 1,
  limite: 25
};

// ---------- Cálculo de períodos ----------
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
  const inicioTrimestre = Math.floor(agora.getMonth() / 3) * 3;
  return {
    desde: new Date(agora.getFullYear(), inicioTrimestre, 1, 0, 0, 0, 0).toISOString(),
    ate: new Date(agora.getFullYear(), inicioTrimestre + 3, 0, 23, 59, 59, 999).toISOString()
  };
}
function periodoSemestreAtual() {
  const agora = new Date();
  const inicioSemestre = agora.getMonth() < 6 ? 0 : 6;
  return {
    desde: new Date(agora.getFullYear(), inicioSemestre, 1, 0, 0, 0, 0).toISOString(),
    ate: new Date(agora.getFullYear(), inicioSemestre + 6, 0, 23, 59, 59, 999).toISOString()
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
  'mes-atual': { rotulo: 'Mês atual', calcular: () => { const a = new Date(); return periodoMes(a.getFullYear(), a.getMonth()); } },
  'mes-anterior': {
    rotulo: 'Mês anterior',
    calcular: () => { const a = new Date(); const m = a.getMonth() - 1; return m < 0 ? periodoMes(a.getFullYear() - 1, 11) : periodoMes(a.getFullYear(), m); }
  },
  'trimestre-atual': { rotulo: 'Trimestre atual', calcular: periodoTrimestreAtual },
  'semestre-atual': { rotulo: 'Semestre atual', calcular: periodoSemestreAtual },
  'semana-atual': { rotulo: 'Semana atual', calcular: () => periodoSemana(new Date()) },
  'semana-anterior': { rotulo: 'Semana anterior', calcular: () => periodoSemana(new Date(Date.now() - 7 * 86400000)) },
  'ano-atual': { rotulo: 'Ano atual', calcular: () => periodoAno(new Date().getFullYear()) }
};

function formatarBucket(bucket, granularidade) {
  if (granularidade === 'mes') {
    const [ano, mes] = bucket.split('-');
    return NOMES_MES[Number(mes) - 1] + '/' + ano.slice(2);
  }
  const [, mes, dia] = bucket.split('-');
  return dia + '/' + mes;
}

// ---------- Popup de período ----------
function abrirPopupPeriodo() {
  document.getElementById('periodo-popup').hidden = false;
  document.getElementById('btn-periodo').setAttribute('aria-expanded', 'true');
}
function fecharPopupPeriodo() {
  document.getElementById('periodo-popup').hidden = true;
  document.getElementById('btn-periodo').setAttribute('aria-expanded', 'false');
}

function popularListasPeriodo() {
  const agora = new Date();

  const listaMeses = document.getElementById('lista-meses');
  for (let i = 0; i < 24; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-tipo="mes" data-ano="${d.getFullYear()}" data-mes="${d.getMonth()}"> ${NOMES_MES[d.getMonth()]}/${d.getFullYear()}`;
    listaMeses.appendChild(label);
  }

  const listaSemanas = document.getElementById('lista-semanas');
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

  const listaAnos = document.getElementById('lista-anos');
  for (let i = 0; i < 5; i++) {
    const ano = agora.getFullYear() - i;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-tipo="ano" data-ano="${ano}"> ${ano}`;
    listaAnos.appendChild(label);
  }
}

function ligarPopupPeriodo() {
  popularListasPeriodo();

  document.getElementById('btn-periodo').addEventListener('click', (e) => {
    e.stopPropagation();
    const popup = document.getElementById('periodo-popup');
    if (popup.hidden) abrirPopupPeriodo(); else fecharPopupPeriodo();
  });
  document.getElementById('periodo-popup').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => fecharPopupPeriodo());
  document.getElementById('btn-periodo-cancelar').addEventListener('click', fecharPopupPeriodo);

  document.querySelectorAll('.ae-periodo-opcao').forEach(botao => {
    botao.addEventListener('click', () => {
      const preset = PRESETS[botao.dataset.preset];
      estado.periodos = [preset.calcular()];
      estado.periodoRotulo = preset.rotulo;
      document.getElementById('periodo-rotulo').textContent = preset.rotulo;
      fecharPopupPeriodo();
      estado.pagina = 1;
      atualizarTudo();
    });
  });

  document.getElementById('btn-periodo-aplicar').addEventListener('click', () => {
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
    const desdeCustom = document.getElementById('periodo-custom-desde').value;
    const ateCustom = document.getElementById('periodo-custom-ate').value;
    if (desdeCustom && ateCustom) {
      periodos.push({
        desde: new Date(desdeCustom + 'T00:00:00').toISOString(),
        ate: new Date(ateCustom + 'T23:59:59').toISOString()
      });
    } else if (desdeCustom) {
      // Só o primeiro campo preenchido: trata como um único dia.
      periodos.push(periodoDia(new Date(desdeCustom + 'T00:00:00')));
    } else if (ateCustom) {
      // Só o segundo campo preenchido: mesma lógica, usando essa data.
      periodos.push(periodoDia(new Date(ateCustom + 'T00:00:00')));
    }
    if (!periodos.length) { fecharPopupPeriodo(); return; }

    estado.periodos = periodos;
    estado.periodoRotulo = periodos.length === 1 ? '1 período selecionado' : periodos.length + ' períodos selecionados';
    document.getElementById('periodo-rotulo').textContent = estado.periodoRotulo;
    fecharPopupPeriodo();
    estado.pagina = 1;
    atualizarTudo();
  });
}

// ---------- Logo ----------
async function carregarLogos() {
  try {
    const [completo, isotipo] = await Promise.all([
      fetch('assets/logo-completo.svg').then(r => r.text()),
      fetch('assets/isotipo-gradiente.svg').then(r => r.text())
    ]);
    document.getElementById('logo-completo').innerHTML = completo;
    document.getElementById('logo-rodape').innerHTML = completo;
    document.getElementById('logo-isotipo').innerHTML = isotipo;
  } catch (e) {
    console.warn('Não foi possível carregar os SVGs da marca.', e);
  }
}

// ---------- Cabeçalho responsivo ----------
function ajustarCabecalho() {
  const compacto = window.innerWidth < 700;
  document.getElementById('cabecalho-largo').hidden = compacto;
  document.getElementById('cabecalho-compacto').hidden = !compacto;
}

// ---------- Tema ----------
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  try { localStorage.setItem(TEMA_STORAGE_KEY, tema); } catch (e) {}
}
function alternarTema() {
  const atual = document.documentElement.getAttribute('data-tema') || 'claro';
  aplicarTema(atual === 'claro' ? 'escuro' : 'claro');
}

// ---------- Permissão por departamento (Bitrix24) ----------
function aplicarPermissoesSetor(departamentosUsuario) {
  const mapeamentoConfigurado = Object.keys(DEPARTAMENTOS_SETOR).length > 0;
  const avisoEl = document.getElementById('aviso-permissao');

  if (!mapeamentoConfigurado) {
    document.querySelectorAll('.ae-sidebar__item[data-tipologia]').forEach(el => { el.hidden = false; });
    avisoEl.hidden = false;
    return;
  }

  avisoEl.hidden = true;
  const setoresPermitidos = new Set(
    (departamentosUsuario || []).map(id => DEPARTAMENTOS_SETOR[String(id)]).filter(Boolean)
  );

  document.querySelectorAll('.ae-sidebar__item[data-tipologia]').forEach(el => {
    el.hidden = !setoresPermitidos.has(el.dataset.tipologia);
  });

  const ativoAtual = document.querySelector('.ae-sidebar__item.is-ativo');
  if (ativoAtual && ativoAtual.hidden) {
    const primeiroVisivel = document.querySelector('.ae-sidebar__item[data-tipologia]:not([hidden])');
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

// ---------- Chamadas à API ----------
async function chamarApi(path, params) {
  const query = new URLSearchParams({ ...params, api_key: API_KEY }).toString();
  const urlFinal = API_BASE.replace(/\/$/, '') + '/' + path + '?' + query;
  const resposta = await fetch(urlFinal, { method: 'GET' });
  if (!resposta.ok) throw new Error('Falha na API (' + resposta.status + ')');
  return resposta.json();
}

// ---------- Renderizadores de gráfico genéricos ----------
function renderizarBarrasEmpilhadas(containerId, dados, series, granularidade) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!dados || !dados.length) {
    el.innerHTML = '<div class="ae-grafico-vazio">Sem dados nesse período.</div>';
    return;
  }

  const legenda = document.createElement('div');
  legenda.className = 'ae-legenda';
  series.forEach(s => {
    const item = document.createElement('span');
    item.className = 'ae-legenda__item';
    item.innerHTML = `<span class="ae-legenda__cor" style="background:${s.cor}"></span>${escapeHtml(s.rotulo)}`;
    legenda.appendChild(item);
  });
  el.appendChild(legenda);

  const detalhe = document.createElement('div');
  detalhe.className = 'ae-barras-v__detalhe';
  detalhe.innerHTML = '<span class="ae-apoio">Clique numa coluna para ver o detalhe por faixa.</span>';

  const max = Math.max(...dados.map(d => series.reduce((acc, s) => acc + (Number(d[s.chave]) || 0), 0)), 1);

  const barrasWrap = document.createElement('div');
  barrasWrap.className = 'ae-barras-v';
  const rotulosWrap = document.createElement('div');
  rotulosWrap.className = 'ae-barras-v__rotulos';

  function mostrarDetalhe(d, totalColuna) {
    const partes = series
      .map(s => ({ rotulo: s.rotulo, cor: s.cor, valor: Number(d[s.chave]) || 0 }))
      .filter(p => p.valor > 0);
    const itens = partes.map(p =>
      `<span class="ae-legenda__item"><span class="ae-legenda__cor" style="background:${p.cor}"></span>${escapeHtml(p.rotulo)}: <b>${nf.format(p.valor)}</b></span>`
    ).join('');
    detalhe.innerHTML = `<strong>${formatarBucket(d.bucket, granularidade)}</strong> — ${nf.format(totalColuna)} no total<div class="ae-legenda" style="margin-top:6px">${itens || '<span class="ae-apoio">Sem valores nessa coluna.</span>'}</div>`;
  }

  dados.forEach(d => {
    const coluna = document.createElement('div');
    coluna.className = 'ae-barras-v__coluna';
    const totalColuna = series.reduce((acc, s) => acc + (Number(d[s.chave]) || 0), 0);
    coluna.style.cursor = 'pointer';
    coluna.addEventListener('click', () => mostrarDetalhe(d, totalColuna));
    series.forEach(s => {
      const valor = Number(d[s.chave]) || 0;
      if (!valor) return;
      const seg = document.createElement('div');
      seg.className = 'ae-barras-v__segmento';
      seg.style.background = s.cor;
      seg.style.height = (valor / max * 85) + '%';
      seg.title = s.rotulo + ': ' + nf.format(valor);
      coluna.appendChild(seg);
    });
    // Ultimo filho em coluna column-reverse renderiza no topo visual - por isso
    // o rotulo de total entra depois dos segmentos, nao antes.
    const totalLabel = document.createElement('span');
    totalLabel.className = 'ae-barras-v__total-topo';
    totalLabel.textContent = nf.format(totalColuna);
    coluna.appendChild(totalLabel);
    barrasWrap.appendChild(coluna);

    const rot = document.createElement('div');
    rot.className = 'ae-barras-v__rotulo';
    rot.textContent = formatarBucket(d.bucket, granularidade);
    rotulosWrap.appendChild(rot);
  });

  el.appendChild(barrasWrap);
  el.appendChild(rotulosWrap);
  el.appendChild(detalhe);
}

function renderizarColunasSimples(containerId, dados, campoRotulo, campoValor, cor) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!dados || !dados.length) {
    el.innerHTML = '<div class="ae-grafico-vazio">Sem dados nesse período.</div>';
    return;
  }
  const max = Math.max(...dados.map(d => Number(d[campoValor]) || 0), 1);

  const barrasWrap = document.createElement('div');
  barrasWrap.className = 'ae-barras-v';
  const rotulosWrap = document.createElement('div');
  rotulosWrap.className = 'ae-barras-v__rotulos';

  dados.forEach(d => {
    const valor = Number(d[campoValor]) || 0;
    const rotuloCompleto = String(d[campoRotulo]);

    const coluna = document.createElement('div');
    coluna.className = 'ae-barras-v__coluna ae-barras-v__coluna--simples';
    coluna.title = rotuloCompleto + ': ' + nf.format(valor);

    const valorTopo = document.createElement('span');
    valorTopo.className = 'ae-barras-v__valor-topo';
    valorTopo.textContent = nf.format(valor);

    const barra = document.createElement('div');
    barra.className = 'ae-barras-v__segmento';
    barra.style.background = cor || 'var(--ae-magic-pink)';
    barra.style.height = (valor / max * 85) + '%';
    barra.style.minHeight = valor > 0 ? '2px' : '0';

    // Ordem normal (nao column-reverse aqui): o rotulo vem antes da barra no
    // DOM, e como o eixo esta com justify-content:flex-end os dois ficam
    // colados no fundo da trilha, com o numero sempre logo acima da barra.
    coluna.appendChild(valorTopo);
    coluna.appendChild(barra);
    barrasWrap.appendChild(coluna);

    const rot = document.createElement('div');
    rot.className = 'ae-barras-v__rotulo';
    rot.textContent = rotuloCompleto.length > 14 ? rotuloCompleto.slice(0, 14) + '…' : rotuloCompleto;
    rotulosWrap.appendChild(rot);
  });

  el.appendChild(barrasWrap);
  el.appendChild(rotulosWrap);
}

const CORES_FAIXA_SCORE = ['var(--ae-pink-ink)', 'var(--ae-magic-pink)', 'var(--ae-r2)', 'var(--ae-r3)', 'var(--ae-r4)'];
function seriesFaixasScore(faixas) {
  return faixas.map((f, i) => ({ chave: f.chave, rotulo: f.rotulo, cor: CORES_FAIXA_SCORE[i % CORES_FAIXA_SCORE.length] }));
}

function renderizarBarrasHorizontais(containerId, dados, campoRotulo, campoValor, formatador) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!dados || !dados.length) {
    el.innerHTML = '<div class="ae-grafico-vazio">Sem dados nesse período.</div>';
    return;
  }
  const max = Math.max(...dados.map(d => Number(d[campoValor]) || 0), 1);
  const wrap = document.createElement('div');
  wrap.className = 'ae-barras-h';
  dados.forEach(d => {
    const valor = Number(d[campoValor]) || 0;
    const linha = document.createElement('div');
    linha.className = 'ae-barras-h__linha';
    linha.innerHTML = `
      <span class="ae-barras-h__rotulo" title="${escapeHtml(d[campoRotulo])}">${escapeHtml(d[campoRotulo])}</span>
      <span class="ae-barras-h__trilha"><span class="ae-barras-h__preenchido" style="width:${(valor / max * 100)}%"></span></span>
      <span class="ae-barras-h__valor">${formatador ? formatador(valor) : nf.format(valor)}</span>
    `;
    wrap.appendChild(linha);
  });
  el.appendChild(wrap);
}

// ---------- Dashboard: Comercial ----------
function renderizarDashboardComercial(dados) {
  document.getElementById('kpis-setor').innerHTML = `
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Atendimentos criados</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.total_criados)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Realizados pela IA (transferidos)</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.total_transferido_ia)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini ae-kpi-card--alerta">
      <span class="ae-rotulo">Sem resposta &gt; 1h (agora)</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.sem_resposta_60min_agora)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Efetividade da IA</span>
      <span class="ae-numero ae-kpi">${dados.kpis.efetividade_media_pct != null ? nf.format(dados.kpis.efetividade_media_pct) + '%' : '—'}</span>
    </div>
  `;

  const mostrarColaborador = estado.colaborador === 'colaboradores';
  document.getElementById('graficos-setor').innerHTML = `
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Atendimentos ao longo do tempo</h2><p class="ae-apoio">por desfecho</p></div>
      <div id="grafico-serie-desfecho"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Distribuição do score de efetividade</h2><p class="ae-apoio">quantidade de atendimentos por faixa de nota, ao longo do tempo</p></div>
      <div id="grafico-distribuicao"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Critérios de qualificação</h2><p class="ae-apoio">média por critério</p></div>
      <div id="grafico-criterios"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Motivo de falha crítica</h2></div>
      <div id="grafico-falha-critica"></div>
    </div>
    ${mostrarColaborador ? `
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Volume transferido por colaborador</h2><p class="ae-apoio">volume — o Vigia avalia a Sofia, não o colaborador humano</p></div>
      <div id="grafico-por-colaborador"></div>
    </div>` : ''}
  `;

  renderizarBarrasEmpilhadas('grafico-serie-desfecho', dados.serie_desfecho, [
    { chave: 'sofia', rotulo: 'Só Sofia', cor: 'var(--ae-r3)' },
    { chave: 'humano', rotulo: 'Transferido', cor: 'var(--ae-magic-pink)' },
    { chave: 'automatico', rotulo: 'Automático', cor: 'var(--ae-r1)' }
  ], dados.granularidade);
  renderizarBarrasEmpilhadas('grafico-distribuicao', dados.distribuicao_score_serie, seriesFaixasScore(dados.distribuicao_score_faixas), dados.granularidade);
  renderizarBarrasHorizontais('grafico-criterios', dados.criterios, 'criterio', 'media', v => nf.format(v));
  renderizarColunasSimples('grafico-falha-critica', dados.falha_critica, 'motivo', 'quantidade', 'var(--ae-pink-ink)');
  if (mostrarColaborador) {
    renderizarBarrasHorizontais('grafico-por-colaborador', dados.por_colaborador, 'operador', 'quantidade');
  }
}

// ---------- Dashboard: Suporte ----------
function renderizarDashboardSuporte(dados) {
  document.getElementById('kpis-setor').innerHTML = `
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Atendimentos criados</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.total_criados)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Resolvidos só pela IA</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.total_resolvido_ia)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Pedidos gerados pela IA</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.total_pedidos_ia)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini ae-kpi-card--alerta">
      <span class="ae-rotulo">Sem resposta &gt; 30min (agora)</span>
      <span class="ae-numero ae-kpi">${nf.format(dados.kpis.sem_resposta_30min_agora)}</span>
    </div>
    <div class="ae-card ae-kpi-card--mini">
      <span class="ae-rotulo">Efetividade da IA</span>
      <span class="ae-numero ae-kpi">${dados.kpis.efetividade_media_pct != null ? nf.format(dados.kpis.efetividade_media_pct) + '%' : '—'}</span>
    </div>
  `;

  const mostrarColaborador = estado.colaborador === 'colaboradores';
  document.getElementById('graficos-setor').innerHTML = `
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Atendimentos ao longo do tempo</h2><p class="ae-apoio">por resolução</p></div>
      <div id="grafico-serie-resolucao"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Pedidos gerados pela IA ao longo do tempo</h2></div>
      <div id="grafico-serie-pedidos"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Pedidos por tipo de ocorrência</h2></div>
      <div id="grafico-pedidos-tipo"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Distribuição do score de efetividade</h2><p class="ae-apoio">quantidade de atendimentos por faixa de nota, ao longo do tempo</p></div>
      <div id="grafico-distribuicao"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Critérios de suporte</h2><p class="ae-apoio">média por critério</p></div>
      <div id="grafico-criterios"></div>
    </div>
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Motivo de falha crítica</h2></div>
      <div id="grafico-falha-critica"></div>
    </div>
    ${mostrarColaborador ? `
    <div class="ae-card ae-grafico-card">
      <div class="ae-grafico-cabecalho"><h2 class="ae-titulo-secao">Volume com intervenção humana por colaborador</h2><p class="ae-apoio">volume — o Vigia avalia a Sofia, não o colaborador humano</p></div>
      <div id="grafico-por-colaborador"></div>
    </div>` : ''}
  `;

  renderizarBarrasEmpilhadas('grafico-serie-resolucao', dados.serie_resolucao, [
    { chave: 'ia', rotulo: 'Só IA', cor: 'var(--ae-r3)' },
    { chave: 'humano', rotulo: 'Com humano', cor: 'var(--ae-magic-pink)' }
  ], dados.granularidade);
  renderizarBarrasEmpilhadas('grafico-serie-pedidos', dados.serie_pedidos.map(p => ({ bucket: p.bucket, total: p.quantidade })), [
    { chave: 'total', rotulo: 'Pedidos', cor: 'var(--ae-magic-pink)' }
  ], dados.granularidade);
  renderizarBarrasHorizontais('grafico-pedidos-tipo', dados.pedidos_por_tipo, 'tipo', 'quantidade');
  renderizarBarrasEmpilhadas('grafico-distribuicao', dados.distribuicao_score_serie, seriesFaixasScore(dados.distribuicao_score_faixas), dados.granularidade);
  renderizarBarrasHorizontais('grafico-criterios', dados.criterios, 'criterio', 'media', v => nf.format(v));
  renderizarColunasSimples('grafico-falha-critica', dados.falha_critica, 'motivo', 'quantidade', 'var(--ae-pink-ink)');
  if (mostrarColaborador) {
    renderizarBarrasHorizontais('grafico-por-colaborador', dados.por_colaborador, 'operador', 'quantidade');
  }
}

async function carregarDashboardSetor() {
  const path = estado.tipologia === 'comercial' ? 'painel-ae-comercial' : 'painel-ae-suporte';
  try {
    const dados = await chamarApi(path, {
      periodos: JSON.stringify(estado.periodos),
      status: estado.status,
      ...(estado.colaborador ? { colaborador: estado.colaborador } : {})
    });
    if (estado.tipologia === 'comercial') renderizarDashboardComercial(dados);
    else renderizarDashboardSuporte(dados);
  } catch (e) {
    document.getElementById('kpis-setor').innerHTML = '';
    document.getElementById('graficos-setor').innerHTML = '<div class="ae-grafico-vazio">Não foi possível carregar as métricas agora.</div>';
    console.error(e);
  }
}

// ---------- Auditoria: tabela de atendimentos ----------
function renderizarSkeleton() {
  const corpo = document.getElementById('tabela-corpo');
  corpo.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const tr = document.createElement('tr');
    tr.className = 'ae-linha-skeleton';
    for (let c = 0; c < 8; c++) {
      const td = document.createElement('td');
      td.innerHTML = '<div class="ae-skeleton"></div>';
      tr.appendChild(td);
    }
    corpo.appendChild(tr);
  }
}
function renderizarVazio() {
  const corpo = document.getElementById('tabela-corpo');
  corpo.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 8;
  td.innerHTML = `<div class="ae-vazio">
    <p class="ae-corpo">Nenhum atendimento encontrado nesse período com esses filtros.</p>
    <p class="ae-apoio">Tente ampliar o período ou trocar os demais filtros.</p>
  </div>`;
  tr.appendChild(td);
  corpo.appendChild(tr);
}
function renderizarErroTabela(mensagem) {
  const corpo = document.getElementById('tabela-corpo');
  corpo.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 8;
  td.innerHTML = `<div class="ae-erro">
    <p class="ae-corpo">Não foi possível carregar os atendimentos agora.</p>
    <p class="ae-apoio">${escapeHtml(mensagem || 'Tente atualizar em alguns instantes.')}</p>
  </div>`;
  tr.appendChild(td);
  corpo.appendChild(tr);
}
function badgeSetor(tipologia) {
  if (tipologia === 'comercial') return '<span class="ae-badge ae-badge--info">Comercial</span>';
  if (tipologia === 'suporte') return '<span class="ae-badge">Suporte</span>';
  return '<span class="ae-badge">—</span>';
}
function badgeStatus(item) {
  return item.finished_at
    ? '<span class="ae-badge ae-badge--ok">Concluído</span>'
    : '<span class="ae-badge ae-badge--alerta">Em aberto</span>';
}
function sinais(item) {
  const chips = [];
  if (item.falha_critica) chips.push('<span class="ae-badge ae-badge--erro" title="' + escapeHtml(item.falha_critica) + '">Falha crítica</span>');
  if (item.sem_resposta_30min) chips.push('<span class="ae-badge ae-badge--alerta">Sem resposta</span>');
  return chips.length ? '<div class="ae-sinais">' + chips.join('') + '</div>' : '—';
}
function renderizarTabela(dados) {
  if (!dados.itens || !dados.itens.length) { renderizarVazio(); renderizarPaginacao(dados); return; }
  const corpo = document.getElementById('tabela-corpo');
  corpo.innerHTML = '';
  for (const item of dados.itens) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.chat_id
          ? '<a class="ae-link-cliente" href="https://advocaciaescalavel.bitrix24.com.br/online/?IM_DIALOG=chat' + encodeURIComponent(item.chat_id) + '" target="_blank" rel="noopener">' + escapeHtml(item.contact_name || 'Não informado') + '</a>'
          : escapeHtml(item.contact_name || 'Não informado')}</td>
      <td>${badgeSetor(item.tipologia)}</td>
      <td class="ae-numero">${item.started_at ? df.format(new Date(item.started_at)) : '—'}</td>
      <td>${badgeStatus(item)}</td>
      <td class="ae-numero">${item.score_efetividade != null ? nf.format(item.score_efetividade) : '—'}</td>
      <td>${item.falha_critica ? '<span class="ae-badge ae-badge--erro">' + escapeHtml(item.falha_critica) + '</span>' : '—'}</td>
      <td>${item.justificativa_avaliacao ? '<span class="ae-avaliacao-texto" title="Clique para ver o texto completo">' + escapeHtml(item.justificativa_avaliacao) + '</span>' : '—'}</td>
      <td>${sinais(item)}</td>
    `;
    corpo.appendChild(tr);
  }
  renderizarPaginacao(dados);
}
function renderizarPaginacao(dados) {
  const el = document.getElementById('paginacao');
  const totalPaginas = Math.max(1, Math.ceil((dados.total || 0) / estado.limite));
  el.innerHTML = `
    <span class="ae-paginacao__info">${nf.format(dados.total || 0)} atendimento(s) · página ${estado.pagina} de ${totalPaginas}</span>
    <button class="ae-btn" id="pg-anterior" ${estado.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <button class="ae-btn" id="pg-proxima" ${estado.pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
  `;
  const btnAnt = document.getElementById('pg-anterior');
  const btnProx = document.getElementById('pg-proxima');
  if (btnAnt) btnAnt.addEventListener('click', () => { estado.pagina--; carregarAtendimentos(); });
  if (btnProx) btnProx.addEventListener('click', () => { estado.pagina++; carregarAtendimentos(); });
}
async function carregarAtendimentos() {
  renderizarSkeleton();
  try {
    const dados = await chamarApi('painel-ae-atendimentos', {
      periodos: JSON.stringify(estado.periodos),
      limite: estado.limite,
      pagina: estado.pagina,
      tipologia: estado.tipologia,
      status: estado.status,
      ...(estado.colaborador ? { colaborador: estado.colaborador } : {})
    });
    renderizarTabela(dados);
  } catch (e) {
    renderizarErroTabela(e.message);
    console.error(e);
  }
  if (window.BX24) BX24.fitWindow();
}

// ---------- Orquestração ----------
async function atualizarTudo() {
  if (estado.secao === 'metricas') await carregarDashboardSetor();
  else await carregarAtendimentos();
  if (window.BX24) BX24.fitWindow();
}

function selecionarSetor(tipologia) {
  document.querySelectorAll('.ae-sidebar__item[data-tipologia]').forEach(b => {
    const ativo = b.dataset.tipologia === tipologia;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-current', ativo ? 'true' : 'false');
  });
  estado.tipologia = tipologia;
  estado.pagina = 1;
  atualizarTudo();
}
function selecionarSecao(secao) {
  document.querySelectorAll('.ae-conteudo > .ae-abas .ae-abas__item').forEach(b => {
    const ativo = b.dataset.secao === secao;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  document.getElementById('secao-metricas').hidden = secao !== 'metricas';
  document.getElementById('secao-auditoria').hidden = secao !== 'auditoria';
  estado.secao = secao;
  atualizarTudo();
}

function ligarNavegacao() {
  document.querySelectorAll('.ae-sidebar__item[data-tipologia]').forEach(botao => {
    botao.addEventListener('click', () => selecionarSetor(botao.dataset.tipologia));
  });
  document.querySelectorAll('.ae-conteudo > .ae-abas .ae-abas__item').forEach(botao => {
    botao.addEventListener('click', () => selecionarSecao(botao.dataset.secao));
  });
  document.querySelectorAll('[data-colaborador]').forEach(botao => {
    botao.addEventListener('click', () => {
      const jaAtivo = botao.classList.contains('is-ativo');
      document.querySelectorAll('[data-colaborador]').forEach(b => b.classList.remove('is-ativo'));
      if (jaAtivo) {
        estado.colaborador = null; // clicar de novo no que já estava ativo volta ao geral
      } else {
        botao.classList.add('is-ativo');
        estado.colaborador = botao.dataset.colaborador;
      }
      atualizarTudo();
    });
  });
  document.getElementById('filtro-status').addEventListener('change', (e) => {
    estado.status = e.target.value;
    estado.pagina = 1;
    atualizarTudo();
  });
  document.getElementById('tabela-corpo').addEventListener('click', (e) => {
    const alvo = e.target.closest('.ae-avaliacao-texto');
    if (alvo) alvo.classList.toggle('ae-avaliacao-texto--expandida');
  });
  document.getElementById('btn-atualizar').addEventListener('click', atualizarTudo);
  document.getElementById('btn-tema').addEventListener('click', alternarTema);
  document.getElementById('btn-tema-compacto').addEventListener('click', alternarTema);
}

// ---------- Inicialização ----------
function iniciar() {
  estado.periodos = [PRESETS['hoje'].calcular()];
  ajustarCabecalho();
  window.addEventListener('resize', ajustarCabecalho);
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
