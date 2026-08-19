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
    const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (erro) {
    console.error('Erro ao servir o painel via handler raiz:', erro);
    res.status(500).send('Erro ao carregar o painel.');
  }
};
