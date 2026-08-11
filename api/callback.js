// =============================================================================
// api/callback.js — Callback OAuth do app Bitrix24 (fluxo de reautenticação /
// atualização de token fora da instalação inicial).
//
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BITRIX_CLIENT_ID = process.env.BITRIX_CLIENT_ID;
const BITRIX_CLIENT_SECRET = process.env.BITRIX_CLIENT_SECRET;

module.exports = async function handler(req, res) {
  const { code, domain, member_id } = req.query;

  if (!code || !domain) {
    res.status(400).json({ erro: 'Parâmetros de callback incompletos.' });
    return;
  }

  try {
    const tokenResp = await fetch(
      `https://oauth.bitrix.info/oauth/token/?grant_type=authorization_code` +
      `&client_id=${encodeURIComponent(BITRIX_CLIENT_ID)}` +
      `&client_secret=${encodeURIComponent(BITRIX_CLIENT_SECRET)}` +
      `&code=${encodeURIComponent(code)}`
    );
    const token = await tokenResp.json();

    if (!token.access_token) {
      res.status(502).json({ erro: 'Bitrix24 não retornou um token válido.', detalhe: token });
      return;
    }

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
          member_id: member_id || token.member_id,
          domain,
          client_endpoint: token.client_endpoint,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      });
    }

    res.redirect(302, '/index.html');
  } catch (erro) {
    console.error('Erro no callback OAuth:', erro);
    res.status(500).json({ erro: 'Erro interno ao processar o callback.' });
  }
};
