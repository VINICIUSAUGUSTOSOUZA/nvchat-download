# Cadastro de testadores do NVChat

Esta funcionalidade foi preparada na branch `feature/tester-signup-admin` e não deve ser publicada antes da configuração do Supabase abaixo.

## 1. Banco de dados

Aplicar a migration:

`supabase/migrations/20260901163000_create_nvchat_testers.sql`

Ela cria `public.nvchat_testers`, a restrição UNIQUE de e-mail, validações e RLS.

A página pública recebe apenas permissão de INSERT nas colunas `name`, `email` e `consent`. Não existe policy pública de SELECT, UPDATE ou DELETE.

## 2. Administrador

Crie um usuário administrativo no Supabase Auth com e-mail e senha fortes. Depois marque esse usuário no `app_metadata` com `nvchat_admin: true`.

Exemplo para executar no SQL Editor, substituindo o e-mail:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"nvchat_admin": true}'::jsonb
where lower(email) = lower('SEU_EMAIL_ADMIN_AQUI');
```

Depois faça logout/login no painel para renovar o JWT e carregar a nova permissão.

Nunca use `user_metadata` para autorização administrativa e nunca coloque `service_role` no frontend.

## 3. Painel

Depois de publicado, o painel fica em `/admin.html`.

Conhecer esse endereço não concede acesso aos e-mails: o banco só libera SELECT/UPDATE quando o JWT autenticado contém `app_metadata.nvchat_admin = true`.

## 4. Proteção contra spam

A versão inicial, compatível com o site estático atual, inclui honeypot, tempo mínimo antes do envio e cooldown local. Isso reduz bots simples, mas não substitui rate limit de servidor.

Para uma etapa futura mais forte, recomenda-se encaminhar o cadastro por Supabase Edge Function com Cloudflare Turnstile e rate limit. A `service_role`, se necessária nessa função, deve existir apenas como secret da função e nunca no navegador.

## 5. Publicação

Antes de mesclar esta branch no `main`:

1. aplicar a migration;
2. criar o usuário admin e adicionar `app_metadata.nvchat_admin=true`;
3. testar cadastro válido, inválido e duplicado;
4. confirmar pelo cliente público que SELECT em `nvchat_testers` retorna bloqueio/zero dados;
5. testar `/admin.html` com usuário comum e com administrador;
6. testar pesquisa, filtro, alteração de status, notas, cópia e CSV;
7. testar no celular;
8. somente então fazer merge/deploy.
