// =============================================================================
// api/install.js — Handler de instalação do app local no Bitrix24.
// Recebe o POST que o Bitrix24 envia quando o app é instalado no portal,
// troca o AUTH_ID/REFRESH_ID por um token de longa duração e grava em
// bitrix_installations (Supabase), no mesmo padrão do Painel Sofia.
//
// PLACEHOLDER: preencha BITRIX_CLIENT_ID / BITRIX_CLIENT_SECRET nas variáveis
// de ambiente do Vercel quando o app local for criado no portal da
// Advocacia Escalável.
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL; // ex.: https://grxchfgnsqvmsmcjcayp.supabase.co
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BITRIX_CLIENT_ID = process.env.BITRIX_CLIENT_ID;
const BITRIX_CLIENT_SECRET = process.env.BITRIX_CLIENT_SECRET;

function telaInstalacao({ sucesso, mensagem }) {
  return `<!doctype html>
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
    <p class="status">${sucesso ? 'Instalação concluída com sucesso.' : 'Não foi possível concluir a instalação.'}</p>
    <p class="status" style="opacity:.8; font-weight:400">${mensagem}</p>
  </div>

  <!-- SDK do Bitrix24 - sem isso, o Bitrix24 nunca marca a instalacao como
       finalizada e volta a chamar este mesmo handler de instalacao a cada
       tentativa de abrir o app, em vez de abrir o app de verdade. -->
  <script src="//api.bitrix24.com/api/v1/"></script>
  <script>
    if (window.BX24) {
      BX24.init(function () {
        ${sucesso ? 'BX24.installFinish();' : ''}
      });
    }
  </script>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  try {
    const body = req.body || {};
    const authId = body.AUTH_ID;
    const refreshId = body.REFRESH_ID;
    const memberId = body.member_id;
    const domain = body.DOMAIN;

    if (!authId || !memberId) {
      res.status(400).send(telaInstalacao({ sucesso: false, mensagem: 'Dados de instalação incompletos.' }));
      return;
    }

    // PLACEHOLDER: troca do código por token de longa duração via oauth.bitrix.info
    // quando o app estiver registrado com client_id/secret reais. Hoje apenas
    // registra o que o Bitrix24 já entrega na chamada de instalação local.
    const clientEndpoint = `https://${domain}/rest/`;

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
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
          access_token: authId,
          refresh_token: refreshId,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      });
    }

    res.status(200).send(telaInstalacao({ sucesso: true, mensagem: 'Pode voltar ao Bitrix24 e abrir o Painel Vigia.' }));
  } catch (erro) {
    console.error('Erro na instalação:', erro);
    res.status(500).send(telaInstalacao({ sucesso: false, mensagem: 'Erro interno. Tente novamente ou contate o suporte.' }));
  }
};
