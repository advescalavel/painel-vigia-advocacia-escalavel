// =============================================================================
// app.js — Painel Vigia (Advocacia Escalável)
// Consome a API do n8n (workflow "Painel - Vigia - Advocacia Escalável - API")
// e renderiza métricas + tabela de atendimentos dentro do iframe do Bitrix24.
// =============================================================================

// ---------- Configuração ----------
// PLACEHOLDER: troque pela URL base real do webhook do n8n quando o workflow
// da API estiver publicado (ex.: https://SEU-N8N/webhook).
const API_BASE = 'PLACEHOLDER_URL_BASE_N8N/webhook';
// PLACEHOLDER: mesma chave configurada nos nodes "...Autorizado?" da API.
const API_KEY = 'PLACEHOLDER_CHAVE_COMPARTILHADA_PAINEL';

const TEMA_STORAGE_KEY = 'ae-tema:painel-vigia-ae';

const estado = {
  tipologia: '',
  dias: 30,
  pagina: 1,
  limite: 25
};

const nf = new Intl.NumberFormat('pt-BR');
const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ---------- Logo (injeta os SVGs da marca) ----------
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
    // Se os SVGs não carregarem, o app segue funcional sem o logo.
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

// ---------- Chamadas à API ----------
async function chamarApi(path, params) {
  const url = new URL(API_BASE.replace(/\/$/, '') + '/' + path, window.location.href.startsWith('http') ? undefined : 'https://placeholder.invalid');
  // Monta query string manualmente para funcionar mesmo com API_BASE absoluta ou relativa.
  const query = new URLSearchParams(params).toString();
  const urlFinal = API_BASE.replace(/\/$/, '') + '/' + path + (query ? '?' + query : '');

  const resposta = await fetch(urlFinal, {
    method: 'GET',
    headers: { 'x-api-key': API_KEY }
  });

  if (!resposta.ok) {
    throw new Error('Falha na API (' + resposta.status + ')');
  }
  return resposta.json();
}

// ---------- Renderização: KPIs ----------
function renderizarKpis(m) {
  document.getElementById('kpi-score').textContent = m.score_efetividade_medio != null
    ? nf.format(m.score_efetividade_medio)
    : '—';
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
      <p class="ae-corpo">Nenhum atendimento encontrado nesse período com esses filtros.</p>
      <p class="ae-apoio">Tente ampliar o período ou trocar o filtro de setor.</p>
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

// ---------- Toast de erro ----------
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
  try {
    const m = await chamarApi('painel-ae-metricas', {
      dias: estado.dias,
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
  try {
    const dados = await chamarApi('painel-ae-atendimentos', {
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
  await Promise.all([carregarMetricas(), carregarAtendimentos()]);
  if (window.BX24) BX24.fitWindow();
}

// ---------- Ligação dos filtros ----------
function ligarFiltros() {
  document.querySelectorAll('.ae-abas__item').forEach(botao => {
    botao.addEventListener('click', () => {
      document.querySelectorAll('.ae-abas__item').forEach(b => {
        b.classList.remove('is-ativo');
        b.setAttribute('aria-selected', 'false');
      });
      botao.classList.add('is-ativo');
      botao.setAttribute('aria-selected', 'true');
      estado.tipologia = botao.dataset.tipologia || '';
      estado.pagina = 1;
      atualizarTudo();
    });
  });

  document.querySelectorAll('.ae-filtros__periodo .ae-chip').forEach(botao => {
    botao.addEventListener('click', () => {
      document.querySelectorAll('.ae-filtros__periodo .ae-chip').forEach(b => b.classList.remove('is-ativo'));
      botao.classList.add('is-ativo');
      estado.dias = Number(botao.dataset.dias);
      atualizarTudo();
    });
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
  ligarFiltros();
  atualizarTudo();
}

if (window.BX24) {
  BX24.init(() => {
    iniciar();
    BX24.fitWindow();
  });
} else {
  // Permite abrir o arquivo fora do Bitrix24 durante o desenvolvimento local.
  document.addEventListener('DOMContentLoaded', iniciar);
}
