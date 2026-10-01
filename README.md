# PDF Studio

Editor de PDF local-first, moderno e sem contas.

## Rodar
```bash
npm install
npm run dev
```

Depois abra `http://localhost:3000`.

## Build
```bash
npm run build
npm start
```

O projeto foi preparado para GitHub + Vercel. Não há variáveis obrigatórias nem banco de dados.

## Observação técnica
A edição de texto nativo de PDFs é diferente de editar HTML: o texto pode estar fragmentado em operadores, fontes e glyphs. O projeto separa essa camada de edição cirúrgica do restante do editor para evitar exportações aparentemente corretas que danifiquem o documento.


## Estado da v1.0

A implementação mantém todos os recursos já adicionados na v0.1/v1.0-em-construção e prioriza o núcleo de texto. A exportação tenta uma edição nativa do content stream para alterações simples e seguras de texto ASCII com o mesmo comprimento; quando a codificação incorporada não permite essa alteração com segurança, usa substituição visual controlada como fallback. Isso evita alterar silenciosamente o documento de forma potencialmente corrompida.

O projeto é client-side/local-first: o PDF do usuário não precisa ser enviado para um backend para a edição normal. A validação final do build depende da instalação das dependências no ambiente local/CI.


### Correção de edição de texto — preview ao vivo e fontes
- A visualização do documento é regenerada localmente após alterações, para que o resultado apareça no próprio PDF antes de clicar em **Salvar Edição**.
- Alterações de texto ASCII em streams literais agora tentam preservar o operador, a fonte e o estilo originais mesmo quando o novo texto tem comprimento diferente.
- A detecção de negrito/itálico considera o nome interno da fonte e o estilo reportado pelo PDF.js.
- O editor aceita fontes externas `.TTF`, `.OTF` e `.TTC` para uso na sessão e incorporação no PDF, usando `@cantoo/fontkit`. Fontes incorporadas dessa forma permitem manter uma família específica quando ela não é uma fonte padrão.
- A importação de fonte é opcional; o editor continua funcionando sem rede e sem conta.
