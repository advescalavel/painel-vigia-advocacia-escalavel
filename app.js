// =============================================================================
// app.js — Painel Vigia (Advocacia Escalável)
// Consome a API do n8n (workflow "Painel - Vigia - Advocacia Escalável - API")
// e renderiza métricas + auditoria dentro do iframe do Bitrix24.
// =============================================================================

// ---------- Configuração ----------
// PLACEHOLDER: troque pela URL base real do webhook do n8n quando o workflow
// da API estiver publicado (ex.: https://SEU-N8N/webhook).
const API_BASE = 'https://webhook.prod.advocaciaescalaveldev.shop/webhook/painel-ae-metricas';
// PLACEHOLDER: mesma chave configurada nos nodes "...Autorizado?" da API.
const API_KEY = 'vigia-ae-k7x9mP2qL8wZ4nR1';

// PLACEHOLDER: mapeamento de ID de departamento do Bitrix24 para setor do
// painel. Preencha com os IDs reais (Bitrix24 → Empresa → Estrutura da
// empresa). Enquanto estiver vazio, o painel libera todos os setores e avisa
// na sidebar, em vez de bloquear silenciosamente o acesso de todo mundo.
const DEPARTAMENTOS_SETOR = {
  // 'ID_DEPARTAMENTO_COMERCIAL': 'comercial',
  // 'ID_DEPARTAMENTO_SUPORTE': 'suporte',
};

const TEMA_STORAGE_KEY = 'ae-tema:painel-vigia-ae';

const estado = {
  tipologia: '',
  secao: 'metricas',
  modoData: 'dia',
  valorDia: new Date().toISOString().slice(0, 10),
  valorMes: new Date().toISOString().slice(0, 7),
  valorAno: new Date().getFullYear(),
  pagina: 1,
  limite: 25
};

const nf = new Intl.NumberFormat('pt-BR');
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ---------- Cálculo do período (dia | mês | ano → desde/ate ISO) ----------
function calcularPeriodo() {
  let inicio, fim;

  if (estado.modoData === 'dia') {
    const [ano, mes, dia] = estado.valorDia.split('-').map(Number);
    inicio = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
    fim = new Date(ano, mes - 1, dia, 23, 59, 59, 999);
  } else if (estado.modoData === 'mes') {
    const [ano, mes] = estado.valorMes.split('-').map(Number);
    inicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
    fim = new Date(ano, mes, 0, 23, 59, 59, 999); // último dia do mês
  } else {
    inicio = new Date(estado.valorAno, 0, 1, 0, 0, 0, 0);
    fim = new Date(estado.valorAno, 11, 31, 23, 59, 59, 999);
  }

  return { desde: inicio.toISOString(), ate: fim.toISOString() };
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
// Mostra/oculta as abas de setor na sidebar de acordo com o departamento do
// usuário logado. Se DEPARTAMENTOS_SETOR estiver vazio (ainda não
// configurado), libera tudo e avisa, em vez de travar o acesso de todos.
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
    (departamentosUsuario || [])
      .map(id => DEPARTAMENTOS_SETOR[String(id)])
      .filter(Boolean)
  );

  document.querySelectorAll('.ae-sidebar__item[data-tipologia]').forEach(el => {
    const setor = el.dataset.tipologia;
    if (setor === '') { el.hidden = false; return; } // "Todos" continua visível
    el.hidden = !setoresPermitidos.has(setor);
  });

  // Se o setor ativo no momento não é mais permitido, volta para "Todos".
  const ativoAtual = document.querySelector('.ae-sidebar__item.is-ativo');
  if (ativoAtual && ativoAtual.hidden) {
    selecionarSetor('');
  }
}

function verificarPermissoes() {
  if (!window.BX24 || !BX24.callMethod) {
    aplicarPermissoesSetor([]);
    return;
  }
  BX24.callMethod('user.current', {}, (resultado) => {
    if (resultado.error()) {
      console.warn('Não foi possível obter o usuário atual do Bitrix24.', resultado.error());
      aplicarPermissoesSetor([]);
      return;
    }
    const dados = resultado.data() || {};
    aplicarPermissoesSetor(dados.UF_DEPARTMENT || []);
  });
}

// ---------- Chamadas à API ----------
async function chamarApi(path, params) {
  const query = new URLSearchParams({ ...params, api_key: API_KEY }).toString();
  const urlFinal = API_BASE.replace(/\/$/, '') + '/' + path + '?' + query;

  const resposta = await fetch(urlFinal, { method: 'GET' });

  if (!resposta.ok) {
    throw new Error('Falha na API (' + resposta.status + ')');
  }
  return resposta.json();
}

// ---------- Renderização: KPIs ----------
function renderizarKpis(m) {
  document.getElementById('kpi-score').textContent = m.score_efetividade_medio != null ? nf.format(m.score_efetividade_medio) : '—';
  document.getElementById('kpi-abertos').textContent = nf.format(m.em_aberto || 0);
  document.getElementById('kpi-concluidos').textContent = nf.format(m.concluidos || 0);
  document.getElementById('kpi-falha-critica').textContent = nf.format(m.com_falha_critica || 0);
  document.getElementById('kpi-sem-resposta').textContent = nf.format(m.sem_resposta_30min_agora || 0);
  document.getElementById('kpi-insatisfacao').textContent = nf.format(m.insatisfacao_nao_escalada || 0);
}

// ---------- Renderização: estados da tabela ----------
function renderizarSkeleton() {
  const corpo = document.getElementById('tabela-corpo');
  corpo.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const tr = document.createElement('tr');
    tr.className = 'ae-linha-skeleton';
    for (let c = 0; c < 7; c++) {
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
  td.colSpan = 7;
  td.innerHTML = `
    <div class="ae-vazio">
      <p class="ae-corpo">Nenhum atendimento avaliado nesse período com esses filtros.</p>
      <p class="ae-apoio">Tente outro dia, mês ou ano, ou trocar o setor.</p>
    </div>`;
  tr.appendChild(td);
  corpo.appendChild(tr);
}

function renderizarErro(mensagem) {
  const corpo = document.getElementById('tabela-corpo');
  corpo.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 7;
  td.innerHTML = `
    <div class="ae-erro">
      <p class="ae-corpo">Não foi possível carregar os atendimentos agora.</p>
      <p class="ae-apoio">${mensagem || 'Tente atualizar em alguns instantes.'}</p>
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
  if (item.falha_critica) chips.push('<span class="ae-badge ae-badge--erro" title="' + item.falha_critica + '">Falha crítica</span>');
  if (item.sem_resposta_30min) chips.push('<span class="ae-badge ae-badge--alerta">Sem resposta</span>');
  if (item.insatisfacao_detectada && !item.insatisfacao_escalada) chips.push('<span class="ae-badge ae-badge--erro">Insatisfação</span>');
  return chips.length ? '<div class="ae-sinais">' + chips.join('') + '</div>' : '—';
}

function renderizarTabela(dados) {
  const corpo = document.getElementById('tabela-corpo');
  if (!dados.itens || !dados.itens.length) {
    renderizarVazio();
    renderizarPaginacao(dados);
    return;
  }
  corpo.innerHTML = '';
  for (const item of dados.itens) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.contact_name || 'Não informado'}</td>
      <td>${badgeSetor(item.tipologia)}</td>
      <td class="ae-numero">${item.started_at ? df.format(new Date(item.started_at)) : '—'}</td>
      <td>${badgeStatus(item)}</td>
      <td class="ae-numero">${item.score_efetividade != null ? nf.format(item.score_efetividade) : '—'}</td>
      <td>${item.falha_critica ? '<span class="ae-badge ae-badge--erro">' + item.falha_critica + '</span>' : '—'}</td>
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

function mostrarToast(mensagem) {
  const existente = document.querySelector('.ae-toast');
  if (existente) existente.remove();
  const toast = document.createElement('div');
  toast.className = 'ae-toast';
  toast.textContent = mensagem;
  document.querySelector('.ae-app').appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ---------- Carregamento de dados ----------
async function carregarMetricas() {
  const { desde, ate } = calcularPeriodo();
  try {
    const m = await chamarApi('painel-ae-metricas', {
      desde, ate,
      ...(estado.tipologia ? { tipologia: estado.tipologia } : {})
    });
    renderizarKpis(m);
  } catch (e) {
    mostrarToast('Não foi possível atualizar as métricas.');
    console.error(e);
  }
}

async function carregarAtendimentos() {
  renderizarSkeleton();
  const { desde, ate } = calcularPeriodo();
  try {
    const dados = await chamarApi('painel-ae-atendimentos', {
      desde, ate,
      limite: estado.limite,
      pagina: estado.pagina,
      ...(estado.tipologia ? { tipologia: estado.tipologia } : {})
    });
    renderizarTabela(dados);
  } catch (e) {
    renderizarErro(e.message);
    console.error(e);
  }
  if (window.BX24) BX24.fitWindow();
}

async function atualizarTudo() {
  if (estado.secao === 'metricas') {
    await carregarMetricas();
  } else {
    await carregarAtendimentos();
  }
  if (window.BX24) BX24.fitWindow();
}

// ---------- Navegação: setor (sidebar) ----------
function selecionarSetor(tipologia) {
  document.querySelectorAll('.ae-sidebar__item').forEach(b => {
    const ativo = b.dataset.tipologia === tipologia;
    b.classList.toggle('is-ativo', ativo);
    b.setAttribute('aria-current', ativo ? 'true' : 'false');
  });
  estado.tipologia = tipologia;
  estado.pagina = 1;
  atualizarTudo();
}

// ---------- Navegação: seção (Métricas x Auditoria) ----------
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

// ---------- Filtro de data ----------
function atualizarVisibilidadeInputsData() {
  document.getElementById('filtro-dia').hidden = estado.modoData !== 'dia';
  document.getElementById('filtro-mes').hidden = estado.modoData !== 'mes';
  document.getElementById('filtro-ano').hidden = estado.modoData !== 'ano';
}

function popularSelectAno() {
  const select = document.getElementById('filtro-ano');
  const anoAtual = new Date().getFullYear();
  select.innerHTML = '';
  for (let ano = anoAtual; ano >= anoAtual - 5; ano--) {
    const opt = document.createElement('option');
    opt.value = String(ano);
    opt.textContent = String(ano);
    select.appendChild(opt);
  }
  select.value = String(estado.valorAno);
}

function ligarFiltroData() {
  document.getElementById('filtro-dia').value = estado.valorDia;
  document.getElementById('filtro-mes').value = estado.valorMes;
  popularSelectAno();
  atualizarVisibilidadeInputsData();

  document.querySelectorAll('.ae-chip-group .ae-chip').forEach(botao => {
    botao.addEventListener('click', () => {
      document.querySelectorAll('.ae-chip-group .ae-chip').forEach(b => b.classList.remove('is-ativo'));
      botao.classList.add('is-ativo');
      estado.modoData = botao.dataset.modo;
      atualizarVisibilidadeInputsData();
      atualizarTudo();
    });
  });

  document.getElementById('filtro-dia').addEventListener('change', (e) => {
    estado.valorDia = e.target.value;
    atualizarTudo();
  });
  document.getElementById('filtro-mes').addEventListener('change', (e) => {
    estado.valorMes = e.target.value;
    atualizarTudo();
  });
  document.getElementById('filtro-ano').addEventListener('change', (e) => {
    estado.valorAno = Number(e.target.value);
    atualizarTudo();
  });
}

// ---------- Ligação geral ----------
function ligarNavegacao() {
  document.querySelectorAll('.ae-sidebar__item').forEach(botao => {
    botao.addEventListener('click', () => selecionarSetor(botao.dataset.tipologia || ''));
  });
  document.querySelectorAll('.ae-conteudo > .ae-abas .ae-abas__item').forEach(botao => {
    botao.addEventListener('click', () => selecionarSecao(botao.dataset.secao));
  });
  document.getElementById('btn-atualizar').addEventListener('click', atualizarTudo);
  document.getElementById('btn-tema').addEventListener('click', alternarTema);
  document.getElementById('btn-tema-compacto').addEventListener('click', alternarTema);
}

// ---------- Inicialização ----------
function iniciar() {
  ajustarCabecalho();
  window.addEventListener('resize', ajustarCabecalho);
  carregarLogos();
  ligarNavegacao();
  ligarFiltroData();
  verificarPermissoes();
  atualizarTudo();
}

if (window.BX24) {
  BX24.init(() => {
    iniciar();
    BX24.fitWindow();
  });
} else {
  document.addEventListener('DOMContentLoaded', iniciar);
}
