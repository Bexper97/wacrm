# Identidade visual — Bexper / BEX

Referência obrigatória para qualquer trabalho visual neste projeto (telas, ícones,
e-mails, apresentações, favicon). **Não sair deste padrão.**

## Nomes

| Quem | Nome | Observação |
|---|---|---|
| Empresa | **BEXPER** (logo em minúsculas: "bexper") | Marketing & Negócios que une estratégia, criatividade e tecnologia |
| Este produto (central de conversas) | **BEX** | É o nome que o usuário vê nas telas, na aba do navegador e nas mensagens |
| Nome antigo | ~~wacrm~~ | Não deve aparecer para o usuário. Segue só em repositório, pasta, PM2 e chaves técnicas |

Textos fora da marca ("Modelo de CRM para WhatsApp", "WhatsApp CRM") também não devem aparecer.

## Paleta (oficial)

Arquivo: `brand/paleta-de-cores.png`

| Cor | Hex | Papel |
|---|---|---|
| Violeta | `#8858F1` | **Primária**: botões, links, destaque, seleção |
| Lavanda | `#C9B1FD` | Apoio claro: fundos suaves, hover, etiquetas, texto de destaque sobre roxo escuro |
| Verde-limão | `#B9F32E` | **Acento** de energia (CTA, sucesso, novidade). Usar com moderação |
| Roxo profundo | `#341F71` | Títulos sobre fundo claro, superfícies escuras secundárias, "per" do logo |
| Off-white | `#F5F6FC` | Fundo claro padrão. **Não usar branco puro** |
| Roxo quase preto | `#14082F` | Fundo escuro principal e texto sobre o verde-limão |

O símbolo (três paralelogramos) usa degradê do limão claro ao limão mais escuro, como nos arquivos do logo.
As capas e telas de impacto usam fundo radial do violeta (`#8858F1`) nas bordas para o `#14082F` no centro.

### Combinações de texto (contraste)

- Sobre `#B9F32E` → texto `#14082F`.
- Sobre `#8858F1` → texto `#F5F6FC`.
- Sobre `#C9B1FD` → texto `#341F71`.
- Sobre `#F5F6FC` → texto `#14082F` (corpo) e `#341F71` (títulos).
- Sobre `#14082F` → texto `#F5F6FC`, destaque em `#B9F32E` ou `#8858F1`.

## Logo

Pasta: `brand/logos/`

| Arquivo | Quando usar |
|---|---|
| `bexper-logo-horizontal-fundo-claro.png` | Fundos claros (`#F5F6FC`, branco): "be" violeta, "xper" roxo profundo |
| `bexper-logo-horizontal-fundo-escuro.png` | Fundos escuros (`#14082F`): "be" off-white, "xper" violeta |
| `bexper-logo-vertical-com-slogan-para-fundo-escuro.png` | Capas e materiais com slogan. O "be" é off-white, então só funciona sobre fundo escuro |

Regras:
- Nunca recolorir, esticar, girar ou redesenhar o logo, nem "digitar" bexper com uma fonte parecida.
- Manter área livre ao redor equivalente à altura do "b".
- Fundos permitidos: `#14082F`, `#341F71`, `#8858F1`, `#C9B1FD`, `#B9F32E`, `#F5F6FC`.
- **Falta:** o símbolo sozinho (os três paralelogramos) em SVG/PNG transparente, para favicon, avatar e ícone do menu. Pedir ao Gabriel antes de inventar um.

## Tipografia

- Interface e textos: **Inter** (já é a fonte do projeto). Títulos em peso 700-800 com espaçamento entre letras levemente apertado; corpo em 400-500.
- O logotipo é um desenho próprio: usar sempre os arquivos, nunca uma fonte.

## Tom de voz

Português do Brasil, direto e prático. Ideias da marca: **clareza**, **controle**, **tempo de volta**, "mais clareza e menos achismo".
Slogans oficiais:
- "Seu negócio no controle. Seu tempo de volta!"
- "Vender é bom. Manter é melhor."
- "Não perca nenhum lead!"
- Assinatura: "Marketing & Tecnologia | Negócios & Estratégia"

## Decisões já tomadas sobre o app

- A área de **conversa do inbox imita o WhatsApp Web de propósito** (pedido do Gabriel: balões, fundo e lista). É uma exceção consciente à paleta.
- Fora do chat (menu, configurações, painéis, favicon, e-mails), seguir esta paleta. **Já aplicado** em tokens (`src/app/globals.css`), menu lateral, cabeçalho, cartões, botões, login e gráficos: tema escuro sobre `#14082F`, linhas suaves (lavanda a ~10%), brilho violeta no fundo e limão como acento (`--lime`).
- O inbox (lista, conversa, compositor, balões) mantém o visual do WhatsApp Web, com o verde `#00a884` apenas ali dentro.
- Pendente: o favicon (quadrado verde WhatsApp com "B") ainda não segue a marca; falta o símbolo dos paralelogramos em arquivo separado.

## Checklist antes de entregar algo visual

1. Usa só as cores da paleta (e off-white em vez de branco)?
2. O contraste do texto segue as combinações acima?
3. O logo é um dos arquivos oficiais, sem alteração?
4. O nome na tela é **BEX** (produto) ou **Bexper** (empresa), nunca "wacrm"?
5. O texto está em português do Brasil, com o tom da marca?
6. Os dois temas (claro e escuro) foram pensados?

## Fontes originais

`Apresentação Bexper.pdf` e `LOGO BEXPER.pdf` (arquivos enviados pelo Gabriel). Se quiser guardá-los aqui, colocar em `brand/fonte/`.
