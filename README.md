# 321gravando 🎙️📺

O **321gravando** é um sistema automatizado e auto-hospedado (self-hosted) para gravação e transcrição inteligente de reuniões do Google Meet. O sistema roda integralmente dentro de um único container Docker e é projetado para servidores domésticos (como Debian 13) ou qualquer ambiente Windows/Linux local.

Todo o ciclo de controle é executado por meio de uma interface web minimalista baseada em **Glassmorphism & Dark Mode**.

---

## ✨ Funcionalidades

- 🌐 **Controle 100% Web**: Cole o link da reunião, inicie e pare a gravação clicando em botões no dashboard.
- 🤝 **Gravação Inteligente**: O robô Puppeteer entra no lobby do Meet e o servidor aguarda ser aceito pelo anfitrião. A gravação só começa de fato quando o bot entra na sala.
- 🔇 **Modo Invisível / Cortês**: O bot desliga automaticamente o microfone e a câmera logo na entrada para não atrapalhar nem transmitir ruídos na chamada.
- 📺 **Vídeo Full HD (1080p) Limpo**: A gravação roda em uma tela virtual e oculta abas, barras de endereços, avisos de controle remoto e banners de suporte. O resultado é um vídeo MP4 limpo em tela cheia.
- ⚡ **Disponibilidade Imediata**: Assim que você para a gravação, o vídeo fica disponível para assistir ou baixar na hora pelo navegador.
- 🧠 **Transcrição e Ata Assíncronas**: Em segundo plano, o áudio é extraído, acelerado em 1.5x e divido em fatias enviadas para a API do Groq (Whisper-large-v3). Em seguida, o Llama 3.3 gera uma ata executiva resumida com pontos chaves, decisões e próximos passos.
- 📝 **Edição e Exclusão via Web**: Renomeie reuniões (editando a ata) ou exclua gravações antigas para liberar espaço em disco com um clique.
- 🔑 **Configuração Simplificada**: Cole e salve sua API Key do Groq e o nome de exibição do Bot direto nas configurações do dashboard.

---

## 📂 Estrutura de Diretórios

```
├── .agents/
│   └── rules/
│       └── rules.md          # Regras locais de desenvolvimento
├── src/
│   ├── browser.js            # Automação do Puppeteer (Stealth, lobby, mutar mic/cam)
│   ├── recorder.js           # Subprocesso FFmpeg (captura de tela virtual + áudio nulo)
│   ├── audio.js              # Pipeline FFmpeg (1.5x speed, silenceremove, chunking)
│   └── groq.js               # Integração com APIs Groq (Whisper + Llama)
├── dashboard/
│   ├── server.js             # API Express de Orquestração
│   └── public/
│       ├── index.html        # Dashboard Web
│       ├── style.css         # Visual Premium Glassmorphism
│       ├── app.js            # Sincronização reativa de estados do front
│       └── media/            # [Ignorado no Git] Pasta onde os MP4 e MD finais são salvos
├── .env                      # [Ignorado no Git] Arquivo de configurações locais
├── .gitignore                # Regras de exclusão do Git
├── Dockerfile                # Imagem Debian Slim + dependências (Chromium, FFmpeg, PulseAudio)
├── entrypoint.sh             # Script de inicialização da tela virtual (Xvfb) e áudio virtual
└── docker-compose.yml        # Configuração do serviço Docker
```

---

## 🚀 Como Executar

### Pré-requisitos
Instale o [Docker](https://docs.docker.com/get-docker/) e o [Docker Compose](https://docs.docker.com/compose/install/) na sua máquina.

### Passo 1: Iniciar o Sistema
Abra o terminal na pasta do projeto e execute:
```bash
docker compose up --build -d
```
*(Esse comando vai buildar a imagem Debian Slim, instalar as dependências de tela virtual e som, e iniciar o dashboard em segundo plano).*

### Passo 2: Acessar a Interface
Abra seu navegador em:
👉 **[http://localhost:8080](http://localhost:8080)**

### Passo 3: Configurar a Chave do Groq
1. No canto inferior esquerdo da tela, clique em **"Configurações da API"**.
2. Cole sua chave do Groq (que você obtém em [console.groq.com](https://console.groq.com/)) e clique em **"Salvar"**.
3. O status exibirá verde indicando que a chave está ativa.

### Passo 4: Gravar e Transcrever
1. Cole o link de um Google Meet de teste no campo de texto e clique em **"Iniciar Gravação"**.
2. Aceite o robô no Meet oficial (o nome de exibição é configurável no painel de configurações).
3. No painel, clique em **"Parar Gravação"** quando a reunião terminar.
4. O vídeo estará disponível imediatamente. A ata aparecerá automaticamente na coluna direita assim que a transcrição em segundo plano for concluída!

---

## 🔒 Segurança & Privacidade
- **Zero Cloud Storage**: Seus dados (vídeos e textos) nunca são enviados para nuvens públicas de terceiros (exceto as fatias de áudio necessárias para transcrição temporária nas APIs da Groq). Tudo é servido e armazenado localmente na sua própria máquina.
- **Porta Protegida**: Se exposto publicamente via túnel Cloudflare, recomenda-se proteger o subdomínio utilizando políticas de acesso do **Cloudflare Access** (ex: autenticação via e-mail pessoal/Google).
