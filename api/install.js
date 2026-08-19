// =============================================================================
// api/install.js — Handler de instalação do app local no Bitrix24.
// Recebe o POST que o Bitrix24 envia quando o app é instalado no portal,
// grava os tokens em bitrix_installations (Supabase) e finaliza o handshake
// via BX24.installFinish().
//
// Duas regras aprendidas com o Painel Sofia (Engel), que já resolveu esse
// mesmo problema:
// 1. installFinish() precisa ser chamado sempre que os tokens de auth vierem
//    validos, mesmo que a gravacao no Supabase falhe - senao TODOS os
//    usuarios do portal ficam com o app marcado como "nao instalado", nao
//    so o registro de tokens.
// 2. Depois de installFinish(), redireciona pra raiz - nao deixa a pessoa
//    parada na tela de sucesso precisando voltar pro Bitrix24 manualmente.
//
// PLACEHOLDER: preencha BITRIX_CLIENT_ID / BITRIX_CLIENT_SECRET nas variáveis
// de ambiente do Vercel quando o app local for criado no portal da
// Advocacia Escalável.
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL; // ex.: https://grxchfgnsqvmsmcjcayp.supabase.co
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function gravarInstalacao({ memberId, domain, accessToken, refreshToken, expiresIn }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const clientEndpoint = `https://${domain}/rest/`;
  const segundos = Number(expiresIn) > 0 ? Number(expiresIn) : 3600;
  await fetch(`${SUPABASE_URL}/rest/v1/bitrix_installations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      member_id: memberId,
      domain,
      client_endpoint: clientEndpoint,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + segundos * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const body = req.body || {};
    const domain = body.DOMAIN;
    const accessToken = body.AUTH_ID;
    const refreshToken = body.REFRESH_ID;
    const expiresIn = body.AUTH_EXPIRES;
    const memberId = body.member_id;

    if (memberId && accessToken && refreshToken) {
      try {
        await gravarInstalacao({ memberId, domain, accessToken, refreshToken, expiresIn });
      } catch (erro) {
        // Nao interrompe o handshake por causa disso - ver nota no topo do arquivo.
        console.error('Falha ao salvar instalação no Supabase:', erro);
      }
    } else {
      console.warn('POST de instalação recebido sem os campos esperados:', Object.keys(body));
    }
  }

  res.status(200).send(`<!doctype html>
<html lang="pt-BR" data-tema="claro">
<head>
<meta charset="UTF-8">
<title>Instalação — Painel Vigia</title>
<link href="https://fonts.googleapis.com/css2?family=Geologica:wght@100..900&display=swap" rel="stylesheet">
<style>
  body {
    margin: 0; font-family: "Geologica", "Segoe UI", sans-serif;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #2B2B6E 0%, #FF038F 100%);
    color: #FFFFFF; text-align: center; padding: 24px;
  }
  .caixa { max-width: 420px; }
  .status { font-size: 15px; font-weight: 600; margin-top: 16px; opacity: .95; }
  .marca { font-size: 23px; font-weight: 900; letter-spacing: -0.022em; margin: 0 0 8px; }
  .marca b { font-weight: 900; }
</style>
</head>
<body>
  <div class="caixa">
    <p class="marca">PAINEL <b>VIGIA</b></p>
    <p class="status" id="status-instalacao">Concluindo a instalação…</p>
  </div>

  <script src="//api.bitrix24.com/api/v1/"></script>
  <script>
    // Finaliza o handshake de instalacao do app. Enquanto isso nao for
    // chamado, o Bitrix24 marca o app como "nao instalado" pro portal
    // inteiro, e volta a mandar todo mundo pra esta mesma tela em vez de
    // abrir o painel de verdade.
    function finalizarInstalacao() {
      if (window.BX24 && typeof window.BX24.installFinish === 'function') {
        window.BX24.installFinish();
      }
      window.location.href = '/';
    }

    if (window.BX24 && typeof window.BX24.init === 'function') {
      window.BX24.init(finalizarInstalacao);
    } else {
      document.getElementById('status-instalacao').textContent =
        'Não foi possível carregar o SDK do Bitrix24. Tente novamente ou contate o suporte.';
    }
  </script>
</body>
</html>`);
};
