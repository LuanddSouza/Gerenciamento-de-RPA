# API do Roberty — endpoints que usamos nos sistemas

Documento só sobre a **API do Roberty** consumida pelo Appointment Manager e pelo Portal de Robôs (não inclui as rotas internas dos sistemas).

- **Base URL:** `https://api.roberty.app/v4` (configurável em `ROBERTY_API_URL`)
- **Formato:** JSON (`Accept: application/json`)

## 1. Autenticação

Há dois modos, conforme o endpoint.

### 1.1 Sessão por cookie (conta Roberty: e-mail + senha)
Usada em todos os endpoints "de leitura" (seções 2 a 4).

1. `POST /auth/login` com `{ "email": "...", "password": "..." }`.
2. A resposta traz `Set-Cookie`; guardar os pares `nome=valor` e enviar no header `Cookie` nas chamadas seguintes.
3. Se qualquer chamada responder **401/403**, refazer o login uma vez e repetir a chamada.
4. Respostas **5xx**: repetir com espera crescente (500 ms · 2^tentativa + jitter). Usamos 1 retentativa (`ROBERTY_MAX_RETRIES`).
5. Login com 400/401/403/404 = credenciais inválidas; sem `Set-Cookie` = falha.

### 1.2 API key (webhook de robôs)
Usada nos endpoints `/public/webhook/...` (seção 5): header `x-roberty-api-key: <chave>`. Sem cookie.

## 2. Resumo

| # | Método | Endpoint | Auth | Para quê |
|---|---|---|---|---|
| 1 | POST | `/auth/login` | e-mail/senha | Abrir sessão |
| 2 | GET | `/auth/logged` | cookie | Workspaces do usuário |
| 3 | GET | `/workspaces/{workspaceId}/logo` | cookie | Logo da workspace |
| 4 | GET | `/workspaces/{workspaceId}/devices?status=` | cookie | Dispositivos (máquinas) |
| 5 | GET | `/devices/{deviceId}/robots?limit=100&page=N` | cookie | Robôs do dispositivo |
| 6 | GET | `/designer/{designId}` | cookie | Designer do robô + agendamentos |
| 7 | GET | `/designer/{designerId}/asRobot` | cookie | Robô + agendamentos (prioritário) |
| 8 | GET | `/designer/{designerId}/asRobot/runs?page=1&limit=10&startDate=&endDate=` | cookie | Execuções por período |
| 9 | POST | `/public/webhook/robot/request/{chave}` | API key | Disparar um robô |
| 10 | GET | `/public/webhook/robot/arguments/{chave}` | API key | Listar parâmetros do robô |

## 3. Detalhe dos endpoints de leitura (cookie)

### 1. `POST /auth/login`
Body: `{ "email": "usuario@empresa.com", "password": "***" }`
Retorno: cookie de sessão (corpo não é usado).

### 2. `GET /auth/logged`
Retorna o usuário logado. Campo usado:
- `workspaces[]` → `_id` (id da workspace), `displayName` (nome exibido).

### 3. `GET /workspaces/{workspaceId}/logo`
Campo usado: `downloadURL` — URL assinada (S3) da imagem, **expira em algumas horas**; buscar de novo a cada coleta. Sem logo cadastrada a chamada falha (tratar como "sem logo", não como erro). O Portal baixa os bytes dessa URL e guarda em cache (~50 min).

### 4. `GET /workspaces/{workspaceId}/devices?status=`
`status` vazio = todos. Campos usados em `records[]`: `_id`, `name`, `status`.

### 5. `GET /devices/{deviceId}/robots?limit=100`
Paginado: resposta `{ records: [...], metadata: { pages } }`; percorrer `page=1..pages`. Campos usados em `records[]`: `name` (nome no dispositivo) e `design._id` (id do design, usado nas chamadas 6/7/8).

### 6. `GET /designer/{designId}`
Campos usados: `designer._id`, `designer.robot` (`key`, `name`), `schedules[]`.

### 7. `GET /designer/{designerId}/asRobot`
Mesmos conceitos, com prioridade sobre a chamada 6 quando responde: `robot` (`key` = chave usada no webhook, `name`) e `schedules[]` (agendamentos do robô).
Fluxo usado: chamar 6 → pegar `designer._id` → chamar 7 → usar o `schedules`/`robot` de 7 e, se faltar, o de 6.

### 8. `GET /designer/{designerId}/asRobot/runs`
Parâmetros: `page`, `limit`, `startDate=YYYY-MM-DD`, `endDate=YYYY-MM-DD`.
Resposta: `records[]`, cada item `{ run, robot, device }`:
- `run._id`, `run.success` (boolean), `run.startDate`, `run.endDate`, `run.kind` (tipo), `run.duration` (segundos)
- `robot.name`, `device.name`

Uso no Appointment Manager: execuções do **dia atual** (`startDate = endDate = hoje`), só de robôs com agendamento.
Uso no Portal: execuções "ao vivo" (identifica as em andamento, ou seja, sem fim) e logo após cada disparo (consulta repetida em 1,5 s, 4 s, 8 s, 15 s e 30 s, pois a execução demora alguns segundos para aparecer).

## 4. Fluxo de coleta (ordem das chamadas)

```
POST /auth/login
GET  /auth/logged                         → workspaces
GET  /workspaces/{id}/logo                → logo (opcional)
GET  /workspaces/{id}/devices?status=     → dispositivos
GET  /devices/{id}/robots?limit=100&page  → robôs (design._id)
GET  /designer/{designId}                 → designer._id
GET  /designer/{designerId}/asRobot       → chave (robot.key) + schedules
GET  /designer/{designerId}/asRobot/runs  → execuções
```
As chamadas por item rodam em paralelo com limite de concorrência (`CONCURRENCY`, padrão 4 no Portal). Erros de um item não abortam a coleta.

## 5. Webhook de robôs (API key)

### 9. `POST /public/webhook/robot/request/{chave}`
Dispara a execução do robô identificado por `{chave}` (a `robot.key` da chamada 7).

Headers: `x-roberty-api-key: <chave>`, `Content-Type: application/json` (se houver corpo).
Body (opcional):
```json
{ "args": { "alias_do_parametro": "valor" } }
```
Sem parâmetros: sem body (ou o body padrão configurado para o robô).

**Atenção:** o Roberty pode responder **HTTP 200 mesmo recusando** o disparo. A recusa vem no corpo:
```json
{ "success": false, "errors": [ { "message": "motivo" } ] }
```
Considerar sucesso apenas se `res.ok` **e** `success !== false`.

Exemplo:
```bash
curl -X POST "https://api.roberty.app/v4/public/webhook/robot/request/CLI001" \
  -H "x-roberty-api-key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d '{"args":{"cnpj":"00.000.000/0001-00"}}'
```

### 10. `GET /public/webhook/robot/arguments/{chave}`
Lista os parâmetros que o robô aceita ("Descobrir argumentos"). Só leitura, não executa nada.
Resposta usada: `inputs.fields[]` → `{ alias, type }` (`text`, `number`, `boolean`).
Tipagem antes de enviar: `number` aceita vírgula decimal (converter para ponto); `boolean` aceita `true`/`"true"`; demais viram string; vazios e aliases não declarados são descartados.

```bash
curl "https://api.roberty.app/v4/public/webhook/robot/arguments/CLI001" \
  -H "x-roberty-api-key: SUA_CHAVE"
```
No Portal também serve para **testar a chave** (200 = válida; 401/403 = sem permissão para o robô).

## 6. Códigos de resposta que tratamos

| HTTP | Tratamento |
|---|---|
| 200 | Sucesso (no webhook, conferir `success`) |
| 400/401/403/404 no login | Credenciais inválidas |
| 401/403 em chamada autenticada | Relogin automático (1x) e repete |
| 5xx | Retentativa com backoff |
| demais | Erro `GET <path> → HTTP <status>` |

## 7. Onde cada sistema usa

| Endpoint | Appointment Manager | Portal de Robôs |
|---|---|---|
| 1, 2 | login da pessoa | login da **conta de serviço** (`ROBERTY_SERVICE_EMAIL/PASSWORD`) |
| 3 | logo no cabeçalho | logo do cliente (proxy com cache) |
| 4–7 | inventário de robôs/agendamentos | idem, filtrado pela workspace do cliente |
| 8 | execuções do dia | monitoramento ao vivo + pós-disparo |
| 9, 10 | — | executar robô, descobrir parâmetros, testar chave |
