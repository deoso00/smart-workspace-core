# ZAnto.AI Desktop — Installazione Windows + Ollama

Questa guida serve per usare **ZAnto sul PC** con **Ollama** in locale.
Il sito su **Vercel** e il progetto **Lovable** restano separati: non vengono modificati da questo installer.

## Cosa ottieni

- `ZAnto Setup.exe` — installatore Windows
- App desktop che avvia un server locale su `http://127.0.0.1:8787`
- Provider consigliato: **Ollama** (`http://localhost:11434`)

## 1. Installa Ollama (obbligatorio per AI gratis locale)

1. Scarica Ollama: https://ollama.com/download  
2. Installalo e avvialo (icona nella system tray).  
3. Apri **Prompt dei comandi** o PowerShell e lancia:

```bat
ollama pull llama3.2:1b
```

Modelli leggeri consigliati (poca RAM):

```bat
ollama pull llama3.2:1b
ollama pull qwen2.5-coder:1.5b
```

Verifica:

```bat
ollama list
curl http://localhost:11434/api/tags
```

## 2. Installa ZAnto Desktop

1. Esegui `ZAnto Setup x.x.x.exe`
2. Completa l’installazione
3. Avvia **ZAnto.AI** dal menu Start

Al primo avvio, se Ollama non è attivo, compare una guida con i passi sopra.

## 3. Configura Providers in app

1. Apri **Providers**
2. **Ollama** → endpoint `http://localhost:11434` (di solito già ok)
3. In chat seleziona provider **Ollama** e modello `llama3.2:1b`
4. **Agent OFF** per i modelli piccoli; **Agent ON** solo se il modello regge i tool

Opzionale:

- **OpenRouter** (chiave gratis) per modelli cloud più forti
- **Google Gemini** per chat cloud / video Veo (billing)

## 4. Supabase (workspace / file)

ZAnto Desktop usa ancora **Supabase** per workspace e file (serve internet).
Le variabili stanno in:

- file `.env` usato in build, oppure
- `%APPDATA%\zanto-ai\zanto.env` (crealo tu con le stesse chiavi di `.env.example`)

Esempio `zanto.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_...
```

## 5. Build da sorgente (sviluppatori)

Prerequisiti: [Bun](https://bun.sh), Node.js 20+.

```bat
bun install
bun run desktop:build
bun run desktop:dist
```

Output:

- installer in `desktop\dist\ZAnto Setup *.exe`
- server in `desktop\.output`

Dev (dopo `desktop:build`):

```bat
bun run desktop:dev
```

## 6. Backup — non perdere il programma

Oltre all’installer, tieni una copia di:

1. Tutta la cartella progetto (o uno ZIP senza `node_modules`)
2. Il file `ZAnto Setup *.exe`
3. Il tuo `.env` / `zanto.env` (privato, non condividerlo)

Script di backup ZIP (esclude `.git` e `node_modules`):

```bat
bun run desktop:backup-zip
```

Lo ZIP finisce in `desktop\backup\`.

## Problemi comuni

| Sintomo | Cosa fare |
|--------|-----------|
| “Ollama non rilevato” | Avvia Ollama, poi `ollama list` |
| Chat lenta / hang | Usa `llama3.2:1b`, Agent OFF |
| Workspace / file non caricano | Controlla chiavi Supabase in `zanto.env` |
| App bianca all’avvio | Controlla che la porta 8787 sia libera |

## Link utili

- Ollama: https://ollama.com  
- OpenRouter keys: https://openrouter.ai/keys  
- Gemini keys: https://aistudio.google.com/apikey  
