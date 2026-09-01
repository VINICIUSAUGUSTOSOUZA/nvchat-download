# Cadastro e painel de testadores do NVChat

Esta funcionalidade está sendo preparada na branch `feat/admin-testers-layout` e **não deve ser mesclada na `main` nem publicada em produção sem autorização explícita**.

## Situação do banco de dados

A tabela `public.nvchat_testers` já existe no projeto Supabase usado pelo site e contém os campos necessários para o painel:

- `id`
- `name`
- `email`
- `created_at`
- `consent`
- `status`
- `invited_at`
- `notes`

O RLS está habilitado.

O visitante público recebe somente permissão de cadastro nos campos `name`, `email` e `consent`. Não existe leitura pública da lista de testadores.

A leitura e atualização são liberadas somente quando o usuário autenticado possui `app_metadata.nvchat_admin = true`.

A migration histórica continua em:

`supabase/migrations/20260901163000_create_nvchat_testers.sql`

Não recrie a tabela se ela já existir no projeto.

## Configuração inicial do administrador

O painel usa Supabase Auth com e-mail e senha. A senha não fica no código e nenhuma `service_role` é usada no frontend.

Para o painel funcionar, é necessário existir um usuário administrativo no Supabase Auth e esse usuário precisa ser marcado em `app_metadata` com:

```json
{
  "nvchat_admin": true
}
```

Essa é uma configuração inicial. Depois disso, o uso normal deve ser feito somente por:

`Site NVChat → Administrador → Login → Painel de testadores`

Após alterar `app_metadata`, faça logout e login novamente para renovar o JWT.

Nunca use `user_metadata` para autorização administrativa.

## Painel administrativo

O painel fica em `/admin.html` e inclui:

- indicadores de total, interessados, convidados e ativos;
- pesquisa por nome ou e-mail;
- filtro por status;
- alteração de status;
- registro automático da data do convite;
- observações internas;
- seleção múltipla e seleção de todos os resultados visíveis;
- cópia de e-mails;
- marcação em massa como convidado;
- exportação CSV compatível com Excel, incluindo data do convite;
- logout.

Conhecer o endereço `/admin.html` não concede acesso aos dados. A autorização real é aplicada pelo RLS do Supabase.

## Página principal

No desktop, a área de download e a área de cadastro de testadores ficam lado a lado.

No celular, elas ficam uma abaixo da outra.

O menu superior contém:

- Baixar
- Ser testador
- Administrador

O link e o arquivo atual do APK não foram alterados.

## Proteção do cadastro público

O formulário mantém:

- validação de e-mail;
- aceite obrigatório;
- e-mail único;
- honeypot;
- tempo mínimo antes do envio;
- cooldown local;
- RLS limitando o INSERT público.

Para uma etapa futura com proteção anti-bot mais forte, pode-se avaliar Edge Function + Cloudflare Turnstile + rate limit, mantendo qualquer segredo somente no servidor.

## Checklist antes de publicar

1. Criar/confirmar o usuário admin no Supabase Auth.
2. Adicionar `app_metadata.nvchat_admin=true` ao usuário admin.
3. Fazer logout/login para renovar o token.
4. Testar cadastro válido, e-mail inválido, duplicidade e aceite obrigatório.
5. Confirmar que visitante não consegue ler `nvchat_testers`.
6. Confirmar que usuário autenticado sem `nvchat_admin` também não consegue ler a tabela.
7. Testar login administrativo e logout.
8. Testar pesquisa e filtros.
9. Testar alteração de status e observações.
10. Testar seleção múltipla, copiar e-mails e marcação em massa como convidado.
11. Testar CSV no Excel.
12. Testar desktop e celular.
13. Confirmar que o download do APK continua funcionando.
14. Somente depois de autorização explícita, fazer merge/deploy.
