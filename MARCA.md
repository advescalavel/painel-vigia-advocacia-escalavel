# MARCA.md — Painel Vigia (Advocacia Escalável)

Aplicação da skill `marca-advocacia-escalavel-bitrix24` neste app.

## Checklist de entrega

- [x] Geologica carregando via Google Fonts; nenhum `font-family` fora de `--ae-font`/`--ae-font-num`
- [x] `ae-brand.css` presente e linkado antes de `styles.css`
- [x] `<html lang="pt-BR" data-tema="claro">`
- [x] Nenhum hexadecimal fora da paleta em `styles.css` (só consome tokens `--ae-*`)
- [x] Logo no cabeçalho — imagotipo no cabeçalho largo, isotipo no compacto (<700px)
- [x] Nome do produto na regra de PRODUTOS — "PAINEL **VIGIA**", cor R2 via `.ae-produto__nome`
- [x] Favicon com o isotipo sobre o gradiente (`favicon.svg`)
- [x] Botão primário reservado para `--ae-action` (nenhum botão usa `#FF038F` cru como fundo)
- [x] Foco visível em Magic Pink (herdado de `ae-brand.css`, `:focus-visible`)
- [x] Números em `tabular-nums` (`.ae-numero`, `.ae-kpi`, células de tabela)
- [x] Estados vazio, carregando (skeleton) e erro estilizados (`app.js` + `styles.css`)
- [x] Tela de instalação com a marca (`api/install.js`, fundo gradiente diagonal + lettering branco)
- [x] Testado visualmente em 700px, 1024px e largura cheia (breakpoints no CSS)
- [ ] Tema escuro conferido — os tokens existem (herdados de `ae-brand.css`) e o alternador funciona, mas peço uma segunda conferência visual depois do primeiro deploy real com dados
- [x] `BX24.fitWindow()` chamado após o render inicial e após cada atualização de tabela/filtro
- [x] `MARCA.md` atualizado com o que ficou pendente (este arquivo)

## Decisões de julgamento tomadas

- **Cabeçalho**: nome do cliente final não aparece — é um painel interno da própria Advocacia Escalável (não um painel branded para um escritório cliente), então o subtítulo é "Advocacia Escalável", sem regra de parceria de logo.
- **Onde o Magic Pink entra**: fita de 3px no topo, aba ativa, foco, badges de alerta/erro (`--ae-pink-ink`/`--ae-danger`), sem pintar fundo de card ou tabela.
- **KPIs de alerta** (falha crítica, sem resposta, insatisfação não escalada) usam `--ae-pink-ink` no número para se destacarem sem ferir contraste — não usam `--ae-magic-pink` puro como texto.
- **Tema escuro**: habilitado via alternador (`data-tema`), persistido em `localStorage` com chave `ae-tema:painel-vigia-ae`, sem seguir `prefers-color-scheme` do sistema, conforme a regra da skill.

## Segunda rodada — ajustes de estrutura (não são de marca, mas afetam o layout)

- **Sidebar de setores**: as abas Todos/Comercial/Suporte saíram do topo e foram para uma coluna fixa à esquerda (`.ae-sidebar`), com indicador de item ativo em Magic Pink na borda esquerda. Em telas <700px a sidebar vira uma faixa horizontal rolável, para não competir com a área de conteúdo.
- **Permissão por departamento**: `DEPARTAMENTOS_SETOR` em `app.js` é o mapeamento ID de departamento Bitrix24 → setor. Enquanto estiver vazio (placeholder), o painel libera todos os setores e mostra um aviso na sidebar, em vez de bloquear o acesso de todo mundo por padrão — decisão deliberada para não travar o rollout por falta de configuração. Preencha os IDs reais assim que possível.
- **Métricas x Auditoria**: virou uma navegação de abas própria dentro da área de conteúdo (`.ae-conteudo > .ae-abas`), separada da sidebar de setores. Cada seção dispara sua própria chamada à API só quando está ativa.
- **Filtro de data**: trocado de "7/30/90 dias" para seleção exata de dia (`<input type="date">`), mês (`<input type="month">`) ou ano (`<select>`), nunca os três ao mesmo tempo — o modo ativo decide qual input aparece. A API do n8n foi ajustada para receber `desde`/`ate` (ISO) em vez de `dias`.
- **Alinhamento do logo**: adicionado `align-items:center` explícito no contêiner da marca e `line-height:1` no nome do produto, para o texto "PAINEL VIGIA" não ficar com respiro extra empurrando-o para baixo em relação ao ícone.

## Pendências fora do escopo desta skill (dependem de infraestrutura ainda não criada)

- `BITRIX_CLIENT_ID` / `BITRIX_CLIENT_SECRET` — placeholders em `api/install.js` e `api/callback.js`, aguardando o cadastro do app local no portal Bitrix24 da Advocacia Escalável.
- `API_BASE` / `API_KEY` em `app.js` — placeholders aguardando a publicação do workflow `Painel - Vigia - Advocacia Escalável - API` no n8n.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — variáveis de ambiente do Vercel, ainda não configuradas neste pacote.
- Ícone do app (PNG 512×512 e 128×128, fundo gradiente + isotipo branco) para o cadastro no menu do Bitrix24 — o `favicon.svg` já está pronto, falta rasterizar.
