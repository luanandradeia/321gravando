import Groq from 'groq-sdk';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Transcreve chunks de áudio sequencialmente usando o Groq Whisper, cruza com a timeline de oradores (se houver) e gera um resumo inteligente.
 * @param {string[]} chunkPaths - Lista de caminhos dos arquivos mp3 a serem transcritos.
 * @param {string} [timelinePath] - Caminho opcional do arquivo JSON com a timeline de oradores.
 * @returns {Promise<string>} - Ata de Reunião formatada em Markdown com oradores identificados.
 */
export async function transcribeAndSummarize(chunkPaths, timelinePath) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'sua_chave_aqui') {
    throw new Error('Chave GROQ_API_KEY não foi configurada no arquivo .env.');
  }

  const groq = new Groq({ apiKey });
  let segmentsList = [];

  // Tenta carregar a timeline do orador se existir
  let timeline = [];
  if (timelinePath && fs.existsSync(timelinePath)) {
    try {
      timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf-8'));
      console.log(`[Groq] Timeline carregada para diarização visual. Registros de fala: ${timeline.length}`);
    } catch (e) {
      console.error('[Groq] Erro ao analisar a timeline para diarização:', e.message);
    }
  }

  console.log(`[Groq] Iniciando transcrição de ${chunkPaths.length} chunk(s) com Whisper-large-v3...`);

  // Cada chunk tem ~900 segundos (segment_time do ffmpeg) de áudio processado (acelerado em 1.5x)
  const CHUNK_DURATION_PROCESSED = 900; 

  for (let i = 0; i < chunkPaths.length; i++) {
    const chunkPath = chunkPaths[i];
    console.log(`[Groq] Transcrevendo chunk ${i + 1}/${chunkPaths.length} (${chunkPath})...`);
    
    try {
      // Usamos response_format: 'verbose_json' para obter timestamps por segmento
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(chunkPath),
        model: 'whisper-large-v3',
        language: 'pt',
        response_format: 'verbose_json'
      });
      
      if (transcription && transcription.segments) {
        // Offset de tempo de áudio processado para este chunk
        const chunkOffsetProcessed = i * CHUNK_DURATION_PROCESSED;

        transcription.segments.forEach(seg => {
          // Ajusta os tempos do segmento no áudio processado
          const startProcessed = seg.start + chunkOffsetProcessed;
          const endProcessed = seg.end + chunkOffsetProcessed;

          // Converte para o tempo de gravação real (multiplicando por 1.5 devido à aceleração linear)
          const startReal = startProcessed * 1.5;
          const endReal = endProcessed * 1.5;

          segmentsList.push({
            start: startReal,
            end: endReal,
            text: seg.text
          });
        });
      }
    } catch (err) {
      console.error(`[Groq] Erro ao transcrever o chunk ${chunkPath}:`, err.message);
      // Fallback simples para não quebrar todo o processamento
      segmentsList.push({
        start: i * CHUNK_DURATION_PROCESSED * 1.5,
        end: (i + 1) * CHUNK_DURATION_PROCESSED * 1.5,
        text: `[ERRO NA TRANSCRIÇÃO DO CHUNK ${i + 1}]`
      });
    }
  }

  // Ordena os segmentos por tempo de início
  segmentsList.sort((a, b) => a.start - b.start);

  // Algoritmo de cruzamento (Diarização): Atribui oradores
  const diarizedSegments = segmentsList.map(seg => {
    const midTime = (seg.start + seg.end) / 2;
    let matchingSpeaker = 'Orador Desconhecido';

    // Procura na timeline quem estava com o microfone ativo no segundo midTime
    if (timeline.length > 0) {
      const match = timeline.find(entry => midTime >= entry.start && midTime <= entry.end);
      if (match && match.speaker) {
        matchingSpeaker = match.speaker;
      }
    }

    return {
      speaker: matchingSpeaker,
      start: seg.start,
      end: seg.end,
      text: seg.text
    };
  });

  // Agrupa segmentos consecutivos do mesmo orador para criar diálogos fluídos
  let groupedDialogues = [];
  if (diarizedSegments.length > 0) {
    let currentGroup = {
      speaker: diarizedSegments[0].speaker,
      start: diarizedSegments[0].start,
      end: diarizedSegments[0].end,
      texts: [diarizedSegments[0].text]
    };

    for (let i = 1; i < diarizedSegments.length; i++) {
      const seg = diarizedSegments[i];
      if (seg.speaker === currentGroup.speaker) {
        currentGroup.texts.push(seg.text);
        currentGroup.end = seg.end;
      } else {
        groupedDialogues.push(currentGroup);
        currentGroup = {
          speaker: seg.speaker,
          start: seg.start,
          end: seg.end,
          texts: [seg.text]
        };
      }
    }
    groupedDialogues.push(currentGroup);
  }

  // Função auxiliar para formatar segundos em HH:MM:SS ou MM:SS
  const formatTime = (seconds) => {
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    
    const minsStr = mins.toString().padStart(2, '0');
    const secsStr = secs.toString().padStart(2, '0');

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${minsStr}:${secsStr}`;
    }
    return `${minsStr}:${secsStr}`;
  };

  // Constrói a transcrição estruturada textual com oradores e timestamps formatados
  const formattedTranscriptLines = groupedDialogues.map(d => {
    const timeLabel = formatTime(d.start);
    const textJoined = d.texts.join(' ').trim();
    return `[${timeLabel}] **${d.speaker}**:\n${textJoined}`;
  });

  const completeStructuredTranscript = formattedTranscriptLines.join('\n\n');
  console.log('[Groq] Transcrição com oradores estruturada. Iniciando inteligência de resumo...');

  if (!completeStructuredTranscript.trim()) {
    return '# Ata de Reunião\n\nNão foi possível obter áudio suficiente para transcrever.';
  }

  // Modelos recomendados do Groq para processamento de texto
  const modelToUse = 'llama-3.3-70b-specdec'; 
  
  try {
    console.log(`[Groq] Gerando ata estruturada com o modelo: ${modelToUse}...`);
    
    const chatCompletion = await groq.chat.completions.create({
      model: modelToUse,
      messages: [
        {
          role: 'system',
          content: `Você é um Notetaker profissional e redator de atas de reuniões corporativas de alto nível. 
Sua tarefa é ler a transcrição estruturada com marcas de tempo e nomes de oradores (obtida de uma reunião gravada) e criar um documento em Markdown profissional, elegante, rico em detalhes e fácil de ler (em Português do Brasil).

Estruture o documento exatamente nas seguintes seções:
1. **Título da Reunião** (Use um nome contextual baseado no tema abordado)
2. **Data & Horário** (Se não for óbvio, coloque a data atual)
3. **Resumo Executivo** (Um parágrafo de síntese da reunião)
4. **Tópicos Abordados & Discussões** (Detalhamento dos assuntos conversados em tópicos, explicando quem disse o quê e detalhando as discussões técnicas de forma completa)
5. **Decisões Tomadas** (Lista de pontos acordados)
6. **Ações & Próximos Passos** (Lista de tarefas atribuídas, com responsáveis claros)`
        },
        {
          role: 'user',
          content: `Transcrições estruturadas da reunião com identificação de oradores:\n\n${completeStructuredTranscript}`
        }
      ],
      temperature: 0.3
    });

    const structuredAta = chatCompletion.choices[0]?.message?.content || 'Erro ao gerar o resumo.';
    
    // Compila o arquivo final anexando a transcrição estruturada no final para referência
    const finalMarkdown = `${structuredAta}\n\n---\n\n## Transcrição Detalhada da Reunião (Diarizada)\n\n${completeStructuredTranscript}`;
    
    console.log('[Groq] Ata de reunião e resumo gerados com sucesso!');
    return finalMarkdown;

  } catch (err) {
    console.error('[Groq] Erro ao gerar o resumo estruturado:', err.message);
    
    // Fallback caso a API do Llama falhe (salva a transcrição estruturada)
    const fallbackMarkdown = `# Ata da Reunião (Apenas Transcrição)\n\n*Aviso: Ocorreu um erro ao gerar a ata resumida via LLM. Abaixo está a transcrição estruturada dos oradores.*\n\n## Transcrição\n\n${completeStructuredTranscript}`;
    return fallbackMarkdown;
  }
}
