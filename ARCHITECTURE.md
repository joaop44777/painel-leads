# PDF Studio — arquitetura

## Núcleo
- Next.js + React + TypeScript
- PDF.js para leitura, análise e renderização local
- @cantoo/pdf-lib para geração/alterações estruturais locais
- Sem contas, banco ou backend obrigatório

## Modelo do editor
O editor mantém uma árvore simples `Documento → Página → Elementos`. Elementos possuem página, posição, dimensões, rotação, visibilidade, nome e propriedades específicas.

## Exportação
Novos textos, imagens e formas são gravados no PDF localmente. Texto nativo existente é analisado e apresentado como objeto editável na interface. A substituição cirúrgica de operadores Tj/TJ/glyphs do content stream ainda é uma camada especializada separada; quando um texto existente é alterado, a versão atual usa uma substituição visual controlada, sem duplicar o texto original.

Essa separação é intencional: não mascarar uma limitação de PDF com uma implementação que possa corromper fontes, subsets ou posicionamento.

## Etapa atual
Implementados na v0.2/v1 em construção: ingestão PDF/JPG/PNG, análise de texto, renderização, elementos, imagens, formas básicas, movimento, resize, rotação, duplicação, exclusão, undo/redo, atalhos, pesquisa de elementos em todas as páginas e fluxo Salvar → Conferir → Finalizar → Baixar.

Próximas camadas: miniaturas pré-renderizadas persistentes, edição nativa de content streams, OCR local, apagar/mascarar inteligente, ordem de camadas e validação automática de abertura do PDF exportado.
