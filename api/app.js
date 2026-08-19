// =============================================================================
// api/app.js — Handler da rota raiz ("/"), que é o "Caminho do manipulador"
// cadastrado no Bitrix24.
//
// Por que isso existe: o Bitrix24 SEMPRE abre um app local fazendo um POST
// pra URL do manipulador (com DOMAIN, AUTH_ID etc. no corpo), nunca um GET.
// Hospedagem de arquivo estático puro (servir index.html direto) geralmente
// só responde bem a GET/HEAD - um POST pode cair em erro/resposta vazia,
// que dentro do iframe do Bitrix24 aparece como tela branca. Servindo o
// mesmo HTML através de uma function serverless, qualquer metodo HTTP
// recebe o conteudo normalmente.
// =============================================================================

const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), 'templates', 'index.html');
    const html = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (erro) {
    console.error('Falha ao servir index.html via /api/app:', erro);
    // Temporario: exposto o erro real pra diagnostico. Depois de confirmar
    // que funciona, trocar de volta pra uma mensagem generica sem detalhe interno.
    res.status(500).send(
      'Erro ao carregar o painel.\n' +
      'Detalhe: ' + erro.message + '\n' +
      'cwd: ' + process.cwd()
    );
  }
};
