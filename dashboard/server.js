import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { launchBrowser } from '../src/browser.js';
import { startRecording, stopRecording } from '../src/recorder.js';
import { processAudioPipeline } from '../src/audio.js';
import { transcribeAndSummarize } from '../src/groq.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

const currentDir = path.resolve();
const publicDir = path.join(currentDir, 'dashboard', 'public');
const mediaDir = path.join(publicDir, 'media');

// Garante as pastas necessárias
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

app.use(express.json());
app.use(express.static(publicDir));

// Estados de gravação em memória
let isRecording = false;
let isAdmitted = false;
let activeSessionId = null;
let activeMeetUrl = '';
let recordingStartTime = null;
let ffmpegProcess = null;
let browserInstance = null;

// Rastreamento de transcrições em andamento em segundo plano
const activeTranscriptions = new Set();

/**
 * Auxiliar para formatar data
 */
function parseSessionDate(sessionId) {
  try {
    const timeStr = sessionId.replace('reuniao_', '').replace(/-/g, ':');
    const dateParts = timeStr.split('T')[0].split(':');
    const timeParts = timeStr.split('T')[1].replace('Z', '').split(':');
    
    const year = dateParts[0];
    const month = dateParts[1];
    const day = dateParts[2];
    const hours = timeParts[0];
    const minutes = timeParts[1];
    const seconds = timeParts[2];

    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
    return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch (e) {
    return 'Data desconhecida';
  }
}

/**
 * Busca o primeiro cabeçalho H1 de um arquivo markdown
 */
function extractTitleFromMarkdown(filePath, defaultTitle) {
  try {
    if (!fs.existsSync(filePath)) return defaultTitle;
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : defaultTitle;
  } catch (e) {
    return defaultTitle;
  }
}

/**
 * API: Obter estado atual do gravador
 */
app.get('/api/recording/status', (req, res) => {
  res.json({
    isRecording,
    isAdmitted,
    activeSessionId,
    meetUrl: activeMeetUrl,
    startTime: recordingStartTime,
    transcribing: Array.from(activeTranscriptions)
  });
});

/**
 * API: Iniciar gravação do Google Meet
 */
app.post('/api/recording/start', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'URL do Google Meet inválida.' });
  }

  if (isRecording) {
    return res.status(400).json({ error: 'Já existe uma gravação ativa no momento.' });
  }

  try {
    activeSessionId = `reuniao_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    activeMeetUrl = url;
    recordingStartTime = null;
    isAdmitted = false;
    isRecording = true;

    const tempSessionDir = path.join(currentDir, 'temp', activeSessionId);
    fs.mkdirSync(tempSessionDir, { recursive: true });

    const rawVideoPath = path.join(tempSessionDir, 'raw.mp4');

    console.log(`\n[Dashboard API] Iniciando fluxo de entrada para a sessão: ${activeSessionId}`);
    
    // Inicia fluxo de conexão e gravação em segundo plano (evita timeout HTTP)
    runStartRecordingFlow(url, rawVideoPath, tempSessionDir);

    res.json({ success: true, sessionId: activeSessionId });
  } catch (err) {
    console.error('[Dashboard API] Erro ao disparar gravação:', err);
    res.status(500).json({ error: `Erro ao disparar gravação: ${err.message}` });
  }
});

/**
 * Fluxo de inicialização assíncrono para entrar no Meet e depois gravar
 */
async function runStartRecordingFlow(url, rawVideoPath, tempSessionDir) {
  try {
    console.log('[Start Flow] Iniciando Puppeteer...');
    const browserData = await launchBrowser(url);
    browserInstance = browserData.browser;

    if (!browserData.admitted) {
      console.log('[Start Flow] AVISO: Não foi admitido na reunião. Fechando navegador e abortando...');
      if (browserInstance) await browserInstance.close();
      
      // Reseta estado global
      isRecording = false;
      isAdmitted = false;
      activeSessionId = null;
      activeMeetUrl = '';
      recordingStartTime = null;
      browserInstance = null;
      
      try {
        fs.rmSync(tempSessionDir, { recursive: true, force: true });
      } catch (e) {}
      return;
    }

    console.log('[Start Flow] Acesso concedido! Iniciando gravação do FFmpeg...');
    isAdmitted = true;
    recordingStartTime = new Date();
    
    ffmpegProcess = await startRecording(rawVideoPath);
    console.log('[Start Flow] FFmpeg rodando e gravando ativamente.');

  } catch (err) {
    console.error('[Start Flow] Erro fatal no fluxo de inicialização:', err);
    
    // Reseta estado global em caso de erro
    isRecording = false;
    isAdmitted = false;
    activeSessionId = null;
    activeMeetUrl = '';
    recordingStartTime = null;
    ffmpegProcess = null;
    
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (e) {}
      browserInstance = null;
    }
    
    try {
      fs.rmSync(tempSessionDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

/**
 * API: Parar gravação atual e iniciar pós-processamento assíncrono
 */
app.post('/api/recording/stop', async (req, res) => {
  if (!isRecording) {
    return res.status(400).json({ error: 'Não há gravação ativa para parar.' });
  }

  // Cache das variáveis da sessão para processamento em background
  const sessionId = activeSessionId;
  const tempSessionDir = path.join(currentDir, 'temp', sessionId);
  const rawVideoPath = path.join(tempSessionDir, 'raw.mp4');
  const finalVideoPath = path.join(mediaDir, `${sessionId}.mp4`);
  const finalMarkdownPath = path.join(mediaDir, `${sessionId}.md`);

  console.log(`\n[Dashboard API] Parando gravação para sessão: ${sessionId}`);

  try {
    // 1. Para a gravação (FFmpeg)
    if (ffmpegProcess) {
      await stopRecording(ffmpegProcess);
    }

    // 2. Fecha o navegador (Puppeteer)
    if (browserInstance) {
      await browserInstance.close();
    }

    // Reseta o estado de gravação de imediato para liberar novas chamadas
    isRecording = false;
    activeSessionId = null;
    activeMeetUrl = '';
    recordingStartTime = null;
    ffmpegProcess = null;
    browserInstance = null;

    // 3. Move o arquivo de vídeo MP4 bruto imediatamente para a pasta pública
    if (fs.existsSync(rawVideoPath)) {
      console.log('[Dashboard API] Movendo vídeo raw para pasta pública imediatamente...');
      fs.copyFileSync(rawVideoPath, finalVideoPath);
      fs.unlinkSync(rawVideoPath);
      console.log('[Dashboard API] Vídeo disponibilizado com sucesso.');
    }

    // 4. Inicia pós-processamento (áudio, Whisper, Llama) em segundo plano (assíncrono)
    runBackgroundProcessing(sessionId, finalVideoPath, tempSessionDir, finalMarkdownPath);

    res.json({
      success: true,
      sessionId,
      message: 'Gravação encerrada. O vídeo já está disponível. A ata está sendo gerada em segundo plano.'
    });

  } catch (err) {
    console.error('[Dashboard API] Erro ao parar gravação:', err);
    res.status(500).json({ error: `Erro ao parar gravação: ${err.message}` });
  }
});

/**
 * Executa o processamento pesado de áudio e transcrição em background
 */
async function runBackgroundProcessing(sessionId, videoPath, tempSessionDir, markdownPath) {
  activeTranscriptions.add(sessionId);
  console.log(`[Background Process] Iniciando processamento de transcrição para: ${sessionId}`);

  try {
    // 1. Extração + Aceleração + Segmentação de áudio
    const chunks = await processAudioPipeline(videoPath, tempSessionDir);

    if (chunks.length > 0) {
      // 2. Transcrição (Whisper) e Ata (Llama) via Groq
      const markdownContent = await transcribeAndSummarize(chunks);
      fs.writeFileSync(markdownPath, markdownContent, 'utf-8');
      console.log(`[Background Process] Ata Markdown finalizada e salva em: ${markdownPath}`);
    } else {
      console.log(`[Background Process] Nenhum áudio extraído para a sessão: ${sessionId}`);
      fs.writeFileSync(
        markdownPath, 
        `# Ata de Reunião\n\nNão foi possível extrair áudio válido desta gravação para gerar a ata.`, 
        'utf-8'
      );
    }
  } catch (err) {
    console.error(`[Background Process] Falha ao processar sessão ${sessionId}:`, err);
    fs.writeFileSync(
      markdownPath, 
      `# Erro no Pós-Processamento\n\nOcorreu um erro ao gerar a ata resumida da reunião: \n\`\`\`\n${err.message}\n\`\`\``, 
      'utf-8'
    );
  } finally {
    // Remove do conjunto de transcrições ativas
    activeTranscriptions.delete(sessionId);
    
    // Limpa a pasta temporária de processamento da sessão
    try {
      if (fs.existsSync(tempSessionDir)) {
        fs.rmSync(tempSessionDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('[Background Process] Falha ao limpar pasta temporária:', e.message);
    }
  }
}

/**
 * API: Listar reuniões
 */
app.get('/api/meetings', (req, res) => {
  try {
    if (!fs.existsSync(mediaDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(mediaDir);
    const meetingsMap = new Map();

    files.forEach(file => {
      const ext = path.extname(file);
      const baseName = path.basename(file, ext);

      if (ext !== '.mp4' && ext !== '.md') return;

      if (!meetingsMap.has(baseName)) {
        meetingsMap.set(baseName, {
          id: baseName,
          title: baseName.replace('reuniao_', 'Reunião '),
          date: parseSessionDate(baseName),
          videoUrl: null,
          markdownUrl: null,
          hasVideo: false,
          hasMarkdown: false,
          transcribing: activeTranscriptions.has(baseName),
          timestamp: 0
        });
      }

      const meeting = meetingsMap.get(baseName);
      
      try {
        const timePart = baseName.replace('reuniao_', '').split('T')[0];
        const timePart2 = baseName.replace('reuniao_', '').split('T')[1].replace(/-/g, ':');
        meeting.timestamp = new Date(`${timePart}T${timePart2}`).getTime();
      } catch (e) {
        meeting.timestamp = 0;
      }

      if (ext === '.mp4') {
        meeting.videoUrl = `/media/${file}`;
        meeting.hasVideo = true;
      } else if (ext === '.md') {
        meeting.markdownUrl = `/media/${file}`;
        meeting.hasMarkdown = true;
        meeting.title = extractTitleFromMarkdown(
          path.join(mediaDir, file), 
          meeting.title
        );
      }
    });

    // Ordena da mais nova para a mais antiga
    const meetings = Array.from(meetingsMap.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    res.json(meetings);
  } catch (err) {
    console.error('[Dashboard Server] Erro ao listar reuniões:', err);
    res.status(500).json({ error: 'Erro interno ao listar as reuniões.' });
  }
});

/**
 * API: Obter ata markdown
 */
app.get('/api/meetings/:id/markdown', (req, res) => {
  const { id } = req.params;
  const filePath = path.join(mediaDir, `${id}.md`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Ata não encontrada.' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.send(content);
  } catch (err) {
    console.error(`[Dashboard Server] Erro ao ler markdown ${id}:`, err);
    res.status(500).json({ error: 'Erro ao ler arquivo markdown.' });
  }
});

/**
 * API: Excluir reunião e ata correspondente
 */
app.delete('/api/meetings/:id', (req, res) => {
  const { id } = req.params;
  const mp4Path = path.join(mediaDir, `${id}.mp4`);
  const mdPath = path.join(mediaDir, `${id}.md`);
  let deletedAny = false;

  try {
    if (fs.existsSync(mp4Path)) {
      fs.unlinkSync(mp4Path);
      deletedAny = true;
    }
    if (fs.existsSync(mdPath)) {
      fs.unlinkSync(mdPath);
      deletedAny = true;
    }

    if (deletedAny) {
      console.log(`[Dashboard API] Reunião excluída com sucesso: ${id}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Reunião não encontrada.' });
    }
  } catch (err) {
    console.error(`[Dashboard API] Erro ao excluir reunião ${id}:`, err);
    res.status(500).json({ error: 'Erro ao excluir arquivos da reunião.' });
  }
});

/**
 * API: Renomear reunião (Edita o cabeçalho do arquivo Markdown)
 */
app.put('/api/meetings/:id', (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Título inválido.' });
  }

  const mdPath = path.join(mediaDir, `${id}.md`);

  try {
    if (fs.existsSync(mdPath)) {
      // Lê o conteúdo atual da ata
      let content = fs.readFileSync(mdPath, 'utf-8');
      const lines = content.split('\n');
      
      if (lines.length > 0 && lines[0].startsWith('# ')) {
        // Substitui a primeira linha
        lines[0] = `# ${title.trim()}`;
        content = lines.join('\n');
      } else {
        // Prepend o título se não houver um H1 no topo
        content = `# ${title.trim()}\n\n${content}`;
      }
      
      fs.writeFileSync(mdPath, content, 'utf-8');
    } else {
      // Se não houver ata ainda (vídeo-only ou em processamento), cria uma provisória
      const defaultContent = `# ${title.trim()}\n\n*Ata em processamento ou não disponível.*`;
      fs.writeFileSync(mdPath, defaultContent, 'utf-8');
    }

    console.log(`[Dashboard API] Reunião ${id} renomeada para: "${title}"`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[Dashboard API] Erro ao renomear reunião ${id}:`, err);
    res.status(500).json({ error: 'Erro ao renomear reunião.' });
  }
});

/**
 * API: Obter configurações (Verifica chave API e nome do bot)
 */
app.get('/api/settings', (req, res) => {
  const apiKey = process.env.GROQ_API_KEY || '';
  const isConfigured = apiKey && apiKey !== 'sua_chave_aqui';
  const botName = process.env.BOT_NAME || 'Notetaker Assistant';
  
  // Mascara a chave para segurança
  let maskedKey = '';
  if (isConfigured) {
    if (apiKey.length <= 8) {
      maskedKey = '••••';
    } else {
      maskedKey = apiKey.slice(0, 4) + '••••' + apiKey.slice(-4);
    }
  }

  res.json({
    hasGroqKey: isConfigured,
    maskedKey,
    botName
  });
});

/**
 * API: Salvar chave API do Groq no arquivo .env e na memória
 */
app.post('/api/settings/groq-key', (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ error: 'Chave API inválida.' });
  }

  try {
    const trimmedKey = apiKey.trim();
    
    // Atualiza na memória para uso imediato do servidor Express
    process.env.GROQ_API_KEY = trimmedKey;
    
    // Atualiza no arquivo .env
    const envPath = path.join(currentDir, '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }
    
    const lines = content.split('\n');
    let keyFound = false;
    
    const newLines = lines.map(line => {
      if (line.trim().startsWith('GROQ_API_KEY=')) {
        keyFound = true;
        return `GROQ_API_KEY=${trimmedKey}`;
      }
      return line;
    });
    
    if (!keyFound) {
      newLines.push(`GROQ_API_KEY=${trimmedKey}`);
    }
    
    fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8');
    console.log('[Dashboard API] Chave API do Groq salva com sucesso no arquivo .env.');
    
    res.json({ success: true });
  } catch (err) {
    console.error('[Dashboard API] Erro ao salvar chave API no .env:', err);
    res.status(500).json({ error: 'Erro ao salvar chave API no arquivo de configurações.' });
  }
});

/**
 * API: Salvar o nome do bot do Google Meet no .env e na memória
 */
app.post('/api/settings/bot-name', (req, res) => {
  const { botName } = req.body;

  if (!botName || !botName.trim()) {
    return res.status(400).json({ error: 'Nome de bot inválido.' });
  }

  try {
    const trimmedName = botName.trim();
    
    // Atualiza na memória para as próximas execuções
    process.env.BOT_NAME = trimmedName;
    
    // Atualiza no arquivo .env
    const envPath = path.join(currentDir, '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }
    
    const lines = content.split('\n');
    let nameFound = false;
    
    const newLines = lines.map(line => {
      if (line.trim().startsWith('BOT_NAME=')) {
        nameFound = true;
        return `BOT_NAME="${trimmedName}"`;
      }
      return line;
    });
    
    if (!nameFound) {
      newLines.push(`BOT_NAME="${trimmedName}"`);
    }
    
    fs.writeFileSync(envPath, newLines.join('\n'), 'utf-8');
    console.log(`[Dashboard API] Nome do bot salvo com sucesso no arquivo .env: "${trimmedName}"`);
    
    res.json({ success: true });
  } catch (err) {
    console.error('[Dashboard API] Erro ao salvar nome do bot no .env:', err);
    res.status(500).json({ error: 'Erro ao salvar o nome do bot no arquivo de configurações.' });
  }
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`[Dashboard Web] Servidor rodando em http://localhost:${PORT}`);
  console.log(`[Dashboard Web] Servindo pasta pública: ${publicDir}`);
  console.log('==================================================\n');
});
