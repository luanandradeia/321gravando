# 321gravando 🎙️📺

O **321gravando** é um sistema automatizado e auto-hospedado (self-hosted) para gravação e transcrição inteligente de reuniões do Google Meet. O sistema roda integralmente dentro de um único container Docker e é projetado para servidores domésticos (como Debian 13) ou qualquer ambiente Windows/Linux local.

Todo o ciclo de controle é executado por meio de uma interface web minimalista baseada em **Glassmorphism & Dark Mode**.

---

## ✨ Funcionalidades

- 🌐 **Controle 100% Web**: Cole o link da reunião, inicie e pare a gravação clicando em botões no dashboard.
- ☁️ **Sincronização com Google Drive (Novo v2.0)**: Upload automático para o Google Drive com criação de subpastas dedicadas por reunião (`321gravando/<Data_Hora_Titulo>/`), contendo tanto o vídeo MP4 quanto o relatório Markdown formatado.
- 🤝 **Gravação Inteligente**: O robô Puppeteer entra no lobby do Meet e o servidor aguarda ser aceito pelo anfitrião. A gravação só começa de fato quando o bot entra na sala.
- 🔇 **Modo Invisível / Cortês**: O bot desliga automaticamente o microfone e a câmera logo na entrada para não atrapalhar nem transmitir ruídos na chamada.
- 📺 **Vídeo Full HD (1080p) Limpo**: A gravação roda em uma tela virtual e oculta abas, barras de endereços, avisos de controle remoto e banners de suporte. O resultado é um vídeo MP4 limpo em tela cheia.
- ⚡ **Disponibilidade Imediata**: Assim que você para a gravação, o vídeo fica disponível para assistir ou baixar na hora pelo navegador.
- 🧠 **Transcrição e Ata Assíncronas**: Em segundo plano, o áudio é extraído, acelerado em 1.5x e divido em fatias enviadas para a API do Groq (Whisper-large-v3). Em seguida, o Llama 3.3 gera uma ata executiva resumida com pontos chaves, decisões e próximos passos.
- 📝 **Edição e Exclusão via Web**: Renomeie reuniões (editando a ata) ou exclua gravações antigas para liberar espaço em disco com um clique.
- 🔑 **Configuração Simplificada**: Cole e salve sua API Key do Groq, configure o Google Drive e o nome de exibição do Bot direto nas configurações do dashboard.

---

## ☁️ Como Configurar o Google Drive (v2.0)

O **321gravando** suporta envio automático de todas as gravações e atas para o Google Drive.

### Estrutura de Pastas Gerada:
```text
📁 Google Drive
└── 📁 321gravando/                              <-- Pasta Raiz (criada automaticamente)
    ├── 📁 2026-08-18_18-30 - Planejamento Q3/  <-- Pasta da Reunião
    │   ├── 📹 reuniao_2026-08-18...mp4         <-- Gravação em Vídeo MP4
    │   └── 📝 Planejamento Q3.md               <-- Ata e Transcrição Formatada
    └── 📁 2026-08-19_09-00 - Alinhamento Dev/
        ├── 📹 reuniao_2026-08-19...mp4
        └── 📝 Alinhamento Dev.md
```

### Passo a Passo de Configuração:

1. **Criar uma Service Account no Google Cloud**:
   - Acesse o [Google Cloud Console](https://console.cloud.google.com/).
   - Crie um projeto (ou selecione um existente) e ative a **Google Drive API** na biblioteca de APIs.
   - Acesse **IAM e Administração** > **Contas de Serviço** e crie uma conta de serviço (ex: `notetaker-drive@seu-projeto.iam.gserviceaccount.com`).
   - Clique na conta criada > aba **Chaves** > **Adicionar Chave** > **Criar nova chave (JSON)** e baixe o arquivo.

2. **Compartilhar a Pasta no Google Drive**:
   - No seu Google Drive pessoal (ou compartilhado), crie uma pasta chamada `321gravando` (ou use a raiz).
   - Clique com o botão direito na pasta > **Compartilhar** > Cole o e-mail da sua Service Account com permissão de **Editor**.

3. **Ativar no 321gravando**:
   - Abra o dashboard em `http://localhost:8080`.
   - Clique em **"Configurações da API"** no rodapé da barra lateral.
   - Marque **"Sincronizar Google Drive"**.
   - Cole o conteúdo do JSON baixado no campo correspondente (ou salve o arquivo como `gdrive-credentials.json` na raiz do projeto).
   - Clique em **"Testar"** para validar o acesso e depois em **"Salvar Drive"**. Pronto!

---

## 📂 Estrutura de Diretórios

```
├── src/
│   ├── browser.js            # Automação do Puppeteer (Stealth, lobby, mutar mic/cam)
│   ├── recorder.js           # Subprocesso FFmpeg (captura de tela virtual + áudio nulo)
│   ├── audio.js              # Pipeline FFmpeg (1.5x speed, silenceremove, chunking)
│   ├── groq.js               # Integração com APIs Groq (Whisper + Llama)
│   └── gdrive.js             # [Novo] Integração com Google Drive (streaming e pastas)
├── dashboard/
│   ├── server.js             # API Express de Orquestração com rotas de Google Drive
│   └── public/
│       ├── index.html        # Dashboard Web com badges e links do Drive
│       ├── style.css         # Visual Premium Glassmorphism
│       ├── app.js            # Sincronização reativa de estados do front e Drive
│       └── media/            # [Ignorado no Git] Pasta onde os MP4, MD e metadados locais ficam salvos
├── .env                      # [Ignorado no Git] Arquivo de configurações locais
├── .env.example              # Modelo com variáveis de ambiente do Groq e Drive
├── Dockerfile                # Imagem Debian Slim + dependências
├── entrypoint.sh             # Script de inicialização Xvfb e som virtual
└── docker-compose.yml        # Configuração do serviço Docker com volume de credenciais
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

### Passo 3: Configurar as Chaves
1. No canto inferior esquerdo da tela, clique em **"Configurações da API"**.
2. Cole sua chave do Groq e configure as credenciais do Google Drive.
3. Clique em **"Salvar"**.

### Passo 4: Gravar e Transcrever
1. Cole o link de um Google Meet no campo de texto e clique em **"Iniciar Gravação"**.
2. Aceite o robô no Meet.
3. No painel, clique em **"Parar Gravação"** quando a reunião terminar.
4. O vídeo e ata estarão disponíveis localmente e enviados automaticamente para a pasta dedicada da reunião no seu Google Drive!

---

## 🔒 Segurança & Privacidade
- **Armazenamento Seguro**: As credenciais do Google Drive ficam protegidas localmente no seu servidor e nunca são expostas publicamente.
- **Porta Protegida**: Se exposto publicamente via túnel Cloudflare, recomenda-se proteger o subdomínio utilizando políticas de acesso do **Cloudflare Access**.

