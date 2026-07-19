import { launchBrowser } from './src/browser.js';
import { startRecording, stopRecording } from './src/recorder.js';
import { processAudioPipeline } from './src/audio.js';
import { transcribeAndSummarize } from './src/groq.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Validação dos argumentos
const meetUrl = process.argv[2] || process.env.MEET_URL;
if (!meetUrl) {
  console.error('\nErro: Link do Google Meet não fornecido.');
  console.log('Uso: npm run gravar "https://meet.google.com/abc-defg-hij" ou defina a variável MEET_URL\n');
  process.exit(1);
}

// Criação do ID único para a sessão de gravação
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const sessionId = `reuniao_${timestamp}`;

const tempDir = path.join(process.cwd(), 'temp');
const rawVideoPath = path.join(tempDir, 'raw.mp4');

const mediaDir = path.join(process.cwd(), 'dashboard', 'public', 'media');
const finalVideoPath = path.join(mediaDir, `${sessionId}.mp4`);
const finalMarkdownPath = path.join(mediaDir, `${sessionId}.md`);

// Garante as pastas necessárias
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

let ffmpegProcess = null;
let browserInstance = null;
let shuttingDown = false;

async function run() {
  try {
    console.log('==================================================');
    console.log(`[Notetaker] Iniciando Gravação: ${sessionId}`);
    console.log(`[Notetaker] Link: ${meetUrl}`);
    console.log('==================================================\n');

    // 1. Inicia o Gravador FFmpeg
    ffmpegProcess = await startRecording(rawVideoPath);

    // 2. Inicia o Puppeteer e entra no Meet
    const { browser } = await launchBrowser(meetUrl);
    browserInstance = browser;

    console.log('\n--------------------------------------------------');
    console.log('>>> GRAVAÇÃO EM ANDAMENTO <<<');
    console.log('Pressione a tecla [ENTER] neste terminal para encerrar a gravação de forma segura.');
    console.log('--------------------------------------------------\n');

    // Configura entrada padrão para escuta ativa
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Aguarda o pressionar da tecla Enter
    await new Promise((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });

    console.log('\n[Notetaker] Comando de parada recebido via teclado.');
    await handleShutdown('Teclado (ENTER)');

  } catch (error) {
    console.error('[Notetaker] Erro fatal durante a gravação:', error);
    await cleanup();
    process.exit(1);
  }
}

// Manipulador de finalização reutilizável
async function handleShutdown(reason) {
  if (shuttingDown) {
    console.log('\n[Notetaker] Processamento pós-reunião já está em andamento. Aguarde a conclusão...');
    return;
  }
  shuttingDown = true;
  
  console.log('\n\n==================================================');
  console.log(`[Notetaker] INICIANDO ENCERRAMENTO SEGURO (Origem: ${reason})`);
  console.log('Iniciando encerramento seguro e pós-processamento...');
  console.log('==================================================\n');

  try {
    // 1. Parar a gravação de forma limpa (salva metadados do MP4)
    if (ffmpegProcess) {
      await stopRecording(ffmpegProcess);
    }

    // 2. Fechar navegador Puppeteer
    if (browserInstance) {
      console.log('[Notetaker] Fechando navegador...');
      await browserInstance.close();
    }

    console.log('[Notetaker] Gravação bruta concluída. Iniciando pipeline de áudio...');

    // 3. Executa o pipeline de áudio (extração, 1.5x speed, silenceremove, chunking)
    const chunks = await processAudioPipeline(rawVideoPath, tempDir);

    if (chunks.length > 0) {
      // 4. Executa a transcrição e resumo inteligente via Groq Whisper/LLM
      const markdownContent = await transcribeAndSummarize(chunks);

      // Salva o documento final Markdown
      fs.writeFileSync(finalMarkdownPath, markdownContent, 'utf-8');
      console.log(`[Notetaker] Ata Markdown salva em: ${finalMarkdownPath}`);
    } else {
      console.log('[Notetaker] AVISO: Nenhum áudio foi detectado/processado. O arquivo markdown não foi gerado.');
    }

    // 5. Move o vídeo gravado de temp/ para a pasta de mídia do dashboard
    if (fs.existsSync(rawVideoPath)) {
      console.log('[Notetaker] Movendo vídeo final para a pasta de mídia...');
      fs.copyFileSync(rawVideoPath, finalVideoPath);
      fs.unlinkSync(rawVideoPath);
      console.log(`[Notetaker] Vídeo final salvo em: ${finalVideoPath}`);
    }

    console.log('\n==================================================');
    console.log('>>> PROCESSAMENTO FINALIZADO COM SUCESSO <<<');
    console.log(`- Vídeo: media/${sessionId}.mp4`);
    console.log(`- Ata: media/${sessionId}.md`);
    console.log('\nVocê já pode acessar seu Dashboard Web!');
    console.log('==================================================\n');

  } catch (error) {
    console.error('[Notetaker] Erro durante o pós-processamento:', error);
  } finally {
    await cleanup();
    process.exit(0);
  }
}

// Tratamento de encerramento gracioso via Sinais (Ctrl+C / SIGINT / SIGTERM)
process.on('SIGINT', async () => {
  await handleShutdown('Sinal SIGINT (Ctrl+C)');
});

process.on('SIGTERM', async () => {
  await handleShutdown('Sinal SIGTERM');
});

// Limpeza de arquivos temporários excedentes
async function cleanup() {
  console.log('[Notetaker] Limpando arquivos temporários...');
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[Notetaker] Erro ao limpar pasta temporária:', err.message);
  }
}

// Inicia o app
run();
