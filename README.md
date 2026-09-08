# ZAnto.AI

Piattaforma AI personale: workspace persistenti, chat AI in streaming, agent con tool reali e
filesystem virtuale isolato. Nessun login obbligatorio: al primo avvio viene creata un'identità
**guest locale** e un workspace con file di esempio.

## Cosa è reale e cosa no

ZAnto.AI non simula nulla. In particolare:

| Modulo | Stato |
| --- | --- |
| Chat AI in streaming, Stop con abort reale | reale |
| Persistenza workspace / progetti / conversazioni / messaggi | reale (database) |
| Filesystem virtuale (tree, CRUD, editor, download, export ZIP) | reale |
| Agent con ciclo tool + attività | reale |
| Provider cloud con chiave personale, runtime locale Ollama | reale, solo se configurato/rilevato |
| Terminale di sistema, filesystem desktop, Android SDK/ADB, build APK | **predisposti, runtime non rilevato** |
| Server MCP esterni | layer pronto, nessun server collegato |

Un provider non configurato viene mostrato come tale e la chat rifiuta l'invio: nessuna risposta finta.

## Architettura a layer

```
UI            src/components/zanto/*, src/routes/*
Application   src/lib/zanto/workspace-context.tsx, theme.tsx, nav.ts
Agent         src/routes/api/chat.ts (ciclo tool), src/lib/zanto/chat-client.ts (stream + abort)
Tools         src/lib/zanto/catalog.ts (registry) + permessi in tool_permissions
Provider/Model/Runtime  src/lib/zanto/catalog.ts, providers.ts, src/lib/ai-gateway.server.ts
Storage-API   src/lib/zanto/db.ts, src/lib/zanto/server-db.server.ts
```

## Pagine

`/` chat · `/projects` · `/workspaces` · `/files` · `/models` · `/providers` · `/memory` ·
`/plugins` · `/mcp` · `/tools` · `/activity` · `/settings`

Layout a tre pannelli (conversazioni · chat · file/attività) con scrolling indipendente, tema
chiaro/scuro e command palette (`⌘/Ctrl + K`).

## Dati

Tabelle: `workspaces`, `projects`, `conversations`, `messages`, `vfs_nodes`, `activity_log`,
`tool_permissions`, `memory_notes`. Tutte le righe sono legate a `owner_key` (la chiave guest del
browser) e ogni operazione persistente finisce in `activity_log`.

## Sicurezza delle credenziali

- Il provider integrato usa una chiave lato server, mai esposta al browser.
- Le chiavi personali (OpenAI, Groq) e l'endpoint locale restano **solo nel localStorage** del
  browser: non vengono salvate nel database né nel log attività. Vengono inviate via HTTPS alla
  route interna dell'app solo al momento della richiesta.
- La chiave guest è locale: cancellare i dati del browser fa perdere l'accesso ai workspace.

## Tool dell'agent

`vfs_list`, `vfs_read`, `vfs_write`, `memory_save`, `memory_list`. Ogni tool può essere disattivato
in `/tools`: un tool disattivato non viene nemmeno proposto al modello.

## Sviluppo

```bash
bun install
bun dev      # http://localhost:8080
```
