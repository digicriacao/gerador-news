# Gerador de News Prudential

Ferramenta web para montar e exportar as edições da news Conecta PEM, da Prudential, em PNG, JPG ou PDF.

## Uso
Abra `index.html` no navegador ou acesse a versão publicada no GitHub Pages.

## Estrutura
- `index.html`: a aplicação.
- `config.js`: endereço do servidor do histórico e da IA. Ao atualizar o site, **não sobrescreva** este arquivo depois de configurado.
- `support.js`: runtime. Não editar.
- `assets/`: logo e ícones.
- `servidor/`: o Cloudflare Worker que guarda o histórico compartilhado e gera imagens com IA. O passo a passo de instalação está em `servidor/README.md`.

## Recursos que dependem do servidor
- **Histórico compartilhado**: aba Histórico. Permite salvar, abrir, editar, duplicar, baixar e apagar (com lixeira).
- **Gerar imagem com IA**: botão "✦ Gerar com IA" na imagem da notícia, no banner e na foto de capa. Usa OpenAI ou Gemini, e os ajustes são pedidos no chat.

Sem o servidor, o gerador continua funcionando como antes: salva só no navegador e exporta arquivos normalmente.
