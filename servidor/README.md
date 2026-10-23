# Servidor do Gerador de News (Cloudflare Worker)

O site continua no GitHub Pages. Este servidor faz só duas coisas:

1. Guarda o **histórico compartilhado** de news, que é o mesmo para todos os usuários.
2. Repassa os pedidos de **imagem com IA** para a OpenAI e a Gemini. As chaves ficam guardadas aqui, nunca no site.

O plano gratuito da Cloudflare é suficiente. Não precisa de terminal: tudo é feito pelo painel.

---

## Passo a passo (cerca de 15 minutos)

### 1. Criar o Worker
1. Crie uma conta gratuita em <https://dash.cloudflare.com/sign-up>.
2. No menu, abra **Compute (Workers) → Workers & Pages → Create → Create Worker**.
3. Dê o nome `gerador-news-api` e clique em **Deploy**.
4. Clique em **Edit code**, apague o conteúdo de exemplo, cole todo o arquivo `worker.js` desta pasta e clique em **Deploy**.

### 2. Criar o armazenamento do histórico (KV)
1. No menu, abra **Storage & Databases → Workers KV → Create instance**.
2. Use o nome `gerador-news-historico` e confirme.
3. Volte ao Worker `gerador-news-api`, abra **Settings → Bindings → Add → KV namespace**.
4. Em **Variable name**, escreva exatamente `NEWS`. Selecione o namespace `gerador-news-historico` e salve.

### 3. Cadastrar as chaves e a senha
No Worker, abra **Settings → Variables and Secrets → Add**:

| Nome | Tipo | Valor |
|---|---|---|
| `TEAM_PASSWORD` | Secret | A senha que a equipe vai digitar no gerador. **Recomendado**: sem ela, qualquer pessoa com o link do servidor pode usar o seu crédito de IA. |
| `OPENAI_API_KEY` | Secret | Chave criada em <https://platform.openai.com/api-keys> |
| `GEMINI_API_KEY` | Secret | Chave criada em <https://aistudio.google.com/apikey> |
| `ALLOWED_ORIGINS` | Text | `https://digicriacao.github.io` |
| `OPENAI_IMAGE_MODEL` | Text | Opcional. O padrão é `gpt-image-2`. |
| `GEMINI_IMAGE_MODEL` | Text | Opcional. O padrão é `gemini-3.1-flash-image`. |

Você pode cadastrar só uma das duas chaves de IA. No chat do gerador, o modelo sem chave fica desativado.

Clique em **Deploy** para aplicar.

### 4. Testar
Abra no navegador o endereço do Worker com `/api/health` no final, por exemplo:
`https://gerador-news-api.SEU-USUARIO.workers.dev/api/health`

A resposta deve mostrar `"storage":true` e `"openai":true` e/ou `"gemini":true`.

### 5. Ligar o site ao servidor
Edite o arquivo `config.js` na raiz do repositório e cole o endereço do Worker, sem `/api`:

```js
window.NEWS_CONFIG = {
  apiUrl: 'https://gerador-news-api.SEU-USUARIO.workers.dev'
};
```

Suba o `config.js` para o GitHub. Na primeira vez, cada pessoa abre a aba **Histórico** e informa a senha da equipe e o próprio nome. O navegador guarda esses dados.

> Se o `config.js` ficar vazio, o gerador pede o endereço do servidor na aba Histórico.

---

## Observações

**Contas de IA**
- OpenAI: a conta precisa de crédito. Os modelos de imagem podem exigir a verificação da organização em *platform.openai.com → Settings → Organization*.
- Gemini: os modelos de imagem precisam de um projeto com faturamento ativo no Google AI Studio.
- Se um modelo mudar de nome, troque `OPENAI_IMAGE_MODEL` ou `GEMINI_IMAGE_MODEL` sem mexer no código.

**Limites do plano gratuito (Workers KV)**
- 1 GB de armazenamento e 1.000 gravações por dia.
- Cada "Salvar no histórico" usa 2 gravações, mais 1 para cada imagem nova. Imagens repetidas não são enviadas de novo.
- Imagens que deixam de ser usadas não são apagadas automaticamente. Se um dia o espaço apertar, dá para limpar pelo painel do KV.

**Histórico**
- Quem apaga uma news manda o item para a lixeira, de onde ele pode ser restaurado. "Apagar de vez" só funciona a partir da lixeira.
- Se duas pessoas editam a mesma news, quem salva por último recebe um aviso e escolhe entre substituir a versão da outra pessoa ou salvar a sua como cópia.
- Uma alteração pode levar até 1 minuto para aparecer para quem está em outra região. É uma característica do KV.

**Pelo terminal (opcional)**
Com o Node instalado, dentro desta pasta:

```bash
npx wrangler login
npx wrangler kv namespace create NEWS   # copie o id para o wrangler.toml
npx wrangler secret put TEAM_PASSWORD
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```
