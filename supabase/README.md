# Banco de dados

O schema já está aplicado no projeto Supabase `cardapio-saas`
(ref `fjrvjnhnvjkpowxzxiez`, região `sa-east-1`).

Arquivos:

- `migrations/0001_init.sql` — schema completo da Etapa 1 (tabelas, enums,
  funções auxiliares, trigger de provisionamento, RPC `create_restaurant`,
  RLS de `users` / `restaurants` / `restaurant_users`, bucket de storage).

## Como aplicar em outro projeto

1. Crie um projeto no Supabase.
2. Rode o conteúdo de `migrations/0001_init.sql` no SQL Editor (ou
   `supabase db push` com a CLI, se preferir o fluxo de migrations).
3. Em **Authentication → Providers → Email**, ajuste conforme o ambiente:
   - desenvolvimento: *Confirm email* desligado (cadastro entra direto no onboarding);
   - produção: *Confirm email* ligado — o fluxo já trata o link em `/auth/callback`.
4. Em **Authentication → URL Configuration**:
   - Site URL: seu domínio;
   - Redirect URLs: `http://localhost:3000/**`, `https://seu-dominio/**` e os
     domínios de preview da Vercel.
5. Atualize `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Modelo de acesso

Toda leitura/escrita parte do cliente anon com a sessão do usuário, então a RLS é
sempre aplicada. Funções `security definer` são usadas apenas para:

- consultar o vínculo do usuário sem recursão de policy;
- criar restaurante + vínculo `owner` de forma atômica (`create_restaurant`);
- provisionar `public.users` a partir de `auth.users` (trigger).
