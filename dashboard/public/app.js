let meetings = [];
let activeMeetingId = null;
let recordingState = {
  isRecording: false,
  activeSessionId: null,
  meetUrl: '',
  startTime: null,
  transcribing: []
};
let timerInterval = null;

// Elementos da UI - Gravação
const meetUrlInput = document.getElementById('meetUrlInput');
const btnToggleRecording = document.getElementById('btnToggleRecording');
const recordingTimerContainer = document.getElementById('recordingTimerContainer');
const timerText = document.getElementById('timerText');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');

// Elementos da UI - Listagem & Palco
const searchInput = document.getElementById('searchInput');
const dateFilterInput = document.getElementById('dateFilterInput');
const btnClearDateFilter = document.getElementById('btnClearDateFilter');
const meetingsList = document.getElementById('meetingsList');
const mainStage = document.getElementById('mainStage');
const stageEmpty = document.getElementById('stageEmpty');
const stageContent = document.getElementById('stageContent');

const videoPlayer = document.getElementById('videoPlayer');
const sessionTitle = document.getElementById('sessionTitle');
const sessionDate = document.getElementById('sessionDate');
const btnDownloadVideo = document.getElementById('btnDownloadVideo');
const btnDownloadMarkdown = document.getElementById('btnDownloadMarkdown');
const markdownRender = document.getElementById('markdownRender');

// Elementos da UI - Ações de Reunião
const btnEditTitle = document.getElementById('btnEditTitle');
const btnDeleteMeeting = document.getElementById('btnDeleteMeeting');

// Elementos da UI - Configurações da API e do Bot
const btnToggleSettings = document.getElementById('btnToggleSettings');
const settingsBody = document.getElementById('settingsBody');
const settingsToggleIcon = document.getElementById('settingsToggleIcon');
const groqKeyInput = document.getElementById('groqKeyInput');
const btnSaveGroqKey = document.getElementById('btnSaveGroqKey');
const groqKeyStatus = document.getElementById('groqKeyStatus');
const botNameInput = document.getElementById('botNameInput');
const btnSaveBotName = document.getElementById('btnSaveBotName');

/**
 * Inicialização
 */
document.addEventListener('DOMContentLoaded', () => {
  fetchMeetings();
  syncRecordingStatus();
  
  // Polling periódico do estado (a cada 2.5 segundos)
  setInterval(() => {
    syncRecordingStatus();
  }, 2500);

  // Ações de gravação
  btnToggleRecording.addEventListener('click', toggleRecording);
  
  // Evento de pesquisa e data
  searchInput.addEventListener('input', filterMeetings);
  dateFilterInput.addEventListener('input', filterMeetings);
  btnClearDateFilter.addEventListener('click', clearDateFilter);

  // Ações de reuniões (Edição/Exclusão)
  btnEditTitle.addEventListener('click', editActiveMeetingTitle);
  btnDeleteMeeting.addEventListener('click', deleteActiveMeeting);

  // Configurações
  btnToggleSettings.addEventListener('click', toggleSettingsPanel);
  btnSaveGroqKey.addEventListener('click', saveGroqApiKey);
  btnSaveBotName.addEventListener('click', saveBotName);
  fetchGroqKeySettings();
});

/**
 * Sincroniza o estado atual do gravador com o servidor
 */
async function syncRecordingStatus() {
  try {
    const response = await fetch('/api/recording/status');
    const newState = await response.json();
    
    // Detecta mudança de estado para atualizar a lista de reuniões
    const recordingStopped = recordingState.isRecording && !newState.isRecording;
    const isStillTranscribing = newState.transcribing.length > 0;
    
    // Atualiza estado local
    recordingState = newState;
    
    // Atualiza UI de acordo com o estado
    updateRecordingUI();

    // Se a gravação acabou de parar, recarrega a lista para mostrar o vídeo e seleciona a sessão
    if (recordingStopped) {
      console.log('[Dashboard] Gravação encerrada. Atualizando lista de reuniões...');
      await fetchMeetings();
      if (newState.transcribing.length > 0) {
        // Seleciona a sessão recém gravada automaticamente
        const latestSessionId = newState.transcribing[newState.transcribing.length - 1];
        selectMeeting(latestSessionId);
      }
    } else if (isStillTranscribing || meetings.some(m => newState.transcribing.includes(m.id))) {
      // Se há transcrições ativas, recarrega a lista periodicamente para detectar quando terminam
      await fetchMeetings();
      
      // Se a reunião atualmente selecionada terminou de transcrever, recarrega o markdown dela
      if (activeMeetingId && !newState.transcribing.includes(activeMeetingId)) {
        const meeting = meetings.find(m => m.id === activeMeetingId);
        if (meeting && meeting.hasMarkdown && !markdownRender.querySelector('.markdown-body-content')) {
          // Recarrega o conteúdo markdown
          selectMeeting(activeMeetingId);
        }
      }
    }

  } catch (error) {
    console.error('Erro ao sincronizar status de gravação:', error);
  }
}

/**
 * Atualiza a interface baseada no status de gravação
 */
function updateRecordingUI() {
  if (recordingState.isRecording) {
    // Modo: Gravando ou Aguardando admissão
    btnToggleRecording.className = 'btn-control btn-stop';
    btnToggleRecording.innerHTML = '<i class="fa-solid fa-square"></i> Parar Gravação';
    btnToggleRecording.disabled = false;
    
    meetUrlInput.value = recordingState.meetUrl;
    meetUrlInput.disabled = true;
    
    recordingTimerContainer.style.display = 'flex';

    if (recordingState.isAdmitted) {
      // Admitido na sala: Gravação ativa rodando
      statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      statusBadge.style.borderColor = '#ef4444';
      statusBadge.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.2)';
      statusText.textContent = 'Gravando Reunião...';
      statusText.style.color = '#fca5a5';

      // Inicia o timer local se não estiver rodando
      if (!timerInterval && recordingState.startTime) {
        const startTime = new Date(recordingState.startTime).getTime();
        timerInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          timerText.textContent = formatElapsedTime(elapsed);
        }, 1000);
      }
    } else {
      // No lobby: Aguardando aprovação pelo anfitrião
      statusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
      statusBadge.style.borderColor = '#f59e0b';
      statusBadge.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.2)';
      statusText.textContent = 'Aguardando admissão...';
      statusText.style.color = '#fde047';
      timerText.textContent = 'Conectando...';

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }
  } else {
    // Modo: Ocioso
    btnToggleRecording.className = 'btn-control btn-start';
    btnToggleRecording.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar Gravação';
    btnToggleRecording.disabled = false;
    
    meetUrlInput.disabled = false;
    recordingTimerContainer.style.display = 'none';
    
    statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
    statusBadge.style.borderColor = 'var(--success)';
    statusBadge.style.boxShadow = '0 0 15px var(--success-glow)';
    statusText.textContent = 'Sistema Ativo';
    statusText.style.color = 'var(--success)';

    // Para o timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerText.textContent = '00:00:00';
    }
  }
}

/**
 * Formata milissegundos para HH:MM:SS
 */
function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Alterna entre Iniciar e Parar a gravação
 */
async function toggleRecording() {
  btnToggleRecording.disabled = true;

  if (!recordingState.isRecording) {
    // Iniciar
    const url = meetUrlInput.value.trim();
    if (!url || !url.startsWith('http')) {
      alert('Por favor, insira um link válido do Google Meet.');
      btnToggleRecording.disabled = false;
      return;
    }

    try {
      const response = await fetch('/api/recording/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        meetUrlInput.value = '';
      }
    } catch (err) {
      alert('Erro ao iniciar a gravação: ' + err.message);
    }
  } else {
    // Parar
    try {
      const response = await fetch('/api/recording/stop', { method: 'POST' });
      const data = await response.json();
      if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      alert('Erro ao parar a gravação: ' + err.message);
    }
  }
  
  // Força sincronização imediata
  syncRecordingStatus();
}

/**
 * Busca a lista de reuniões do backend
 */
async function fetchMeetings() {
  try {
    const response = await fetch('/api/meetings');
    meetings = await response.json();
    renderMeetingsList(meetings);
  } catch (error) {
    console.error('Erro ao buscar reuniões:', error);
    meetingsList.innerHTML = `
      <div class="empty-list" style="color: #ef4444;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>Erro ao conectar ao servidor.</p>
      </div>
    `;
  }
}

/**
 * Renderiza os cards de reunião na barra lateral
 */
function renderMeetingsList(meetingsToRender) {
  if (meetingsToRender.length === 0) {
    meetingsList.innerHTML = `
      <div class="empty-list">
        <i class="fa-regular fa-folder-open"></i>
        <p>Nenhuma gravação encontrada.</p>
      </div>
    `;
    return;
  }

  meetingsList.innerHTML = '';
  meetingsToRender.forEach(meeting => {
    const card = document.createElement('div');
    card.className = `meeting-card ${meeting.id === activeMeetingId ? 'active' : ''}`;
    card.dataset.id = meeting.id;
    
    // Constrói os badges
    let badges = '';
    if (meeting.hasVideo) {
      badges += `<span class="badge badge-video"><i class="fa-solid fa-video"></i> Vídeo</span>`;
    }
    
    if (meeting.transcribing) {
      badges += `<span class="badge badge-transcribing"><i class="fa-solid fa-gears fa-spin"></i> Processando...</span>`;
    } else if (meeting.hasMarkdown) {
      badges += `<span class="badge badge-md"><i class="fa-solid fa-file-invoice"></i> Ata</span>`;
    }

    card.innerHTML = `
      <h3>${meeting.title}</h3>
      <div class="date">
        <i class="fa-regular fa-calendar"></i> ${meeting.date}
      </div>
      <div class="meeting-meta-badges">
        ${badges}
      </div>
    `;

    card.addEventListener('click', () => selectMeeting(meeting.id));
    meetingsList.appendChild(card);
  });
}

/**
 * Filtra a lista com base no termo de busca e na data selecionada
 */
function filterMeetings() {
  const query = searchInput.value.toLowerCase().trim();
  const dateVal = dateFilterInput.value; // YYYY-MM-DD ou vazio

  // Exibe/oculta botão de limpar filtro de data
  if (dateVal) {
    btnClearDateFilter.style.display = 'block';
  } else {
    btnClearDateFilter.style.display = 'none';
  }

  const filtered = meetings.filter(m => {
    const matchesQuery = m.title.toLowerCase().includes(query) || m.date.toLowerCase().includes(query);
    const matchesDate = !dateVal || m.id.includes(dateVal);
    return matchesQuery && matchesDate;
  });
  
  renderMeetingsList(filtered);
}

/**
 * Limpa o filtro de data
 */
function clearDateFilter() {
  dateFilterInput.value = '';
  btnClearDateFilter.style.display = 'none';
  filterMeetings();
}

/**
 * Alterna a exibição do painel de configurações da API
 */
function toggleSettingsPanel() {
  const isHidden = settingsBody.style.display === 'none';
  if (isHidden) {
    settingsBody.style.display = 'flex';
    settingsToggleIcon.style.transform = 'rotate(0deg)';
  } else {
    settingsBody.style.display = 'none';
    settingsToggleIcon.style.transform = 'rotate(180deg)';
  }
}

/**
 * Busca as configurações da API e do Bot no backend
 */
async function fetchGroqKeySettings() {
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    
    // Status da Chave Groq
    if (data.hasGroqKey) {
      groqKeyStatus.textContent = `Configurada: ${data.maskedKey}`;
      groqKeyStatus.style.color = '#34d399'; // Verde claro
    } else {
      groqKeyStatus.textContent = 'Chave API não configurada.';
      groqKeyStatus.style.color = '#fca5a5'; // Vermelho claro
    }
    
    // Nome do Bot
    if (data.botName) {
      botNameInput.value = data.botName;
    }
  } catch (err) {
    console.error('Erro ao buscar configurações:', err);
    groqKeyStatus.textContent = 'Erro ao consultar status.';
  }
}

/**
 * Salva a chave da API do Groq no servidor
 */
async function saveGroqApiKey() {
  const apiKey = groqKeyInput.value.trim();
  if (!apiKey) {
    alert('Por favor, insira uma chave API válida.');
    return;
  }

  btnSaveGroqKey.disabled = true;
  groqKeyStatus.textContent = 'Salvando...';
  groqKeyStatus.style.color = 'var(--text-muted)';

  try {
    const response = await fetch('/api/settings/groq-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    const data = await response.json();

    if (data.error) {
      alert(data.error);
    } else {
      groqKeyInput.value = '';
      alert('Chave API do Groq salva com sucesso!');
    }
  } catch (err) {
    alert('Erro ao salvar chave: ' + err.message);
  } finally {
    btnSaveGroqKey.disabled = false;
    fetchGroqKeySettings();
  }
}

/**
 * Salva o nome de exibição do bot do Google Meet no servidor
 */
async function saveBotName() {
  const botName = botNameInput.value.trim();
  if (!botName) {
    alert('Por favor, insira um nome válido para o bot.');
    return;
  }

  btnSaveBotName.disabled = true;

  try {
    const response = await fetch('/api/settings/bot-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botName })
    });
    const data = await response.json();

    if (data.error) {
      alert(data.error);
    } else {
      alert('Nome do bot salvo com sucesso!');
    }
  } catch (err) {
    alert('Erro ao salvar nome do bot: ' + err.message);
  } finally {
    btnSaveBotName.disabled = false;
    fetchGroqKeySettings();
  }
}

/**
 * Edita o título da reunião ativa
 */
async function editActiveMeetingTitle() {
  if (!activeMeetingId) return;
  
  const currentTitle = sessionTitle.textContent;
  const newTitle = prompt('Digite o novo título para a reunião:', currentTitle);
  
  if (newTitle === null) return; // Cancelou
  
  const trimmedTitle = newTitle.trim();
  if (!trimmedTitle) {
    alert('O título não pode ser vazio.');
    return;
  }

  try {
    const response = await fetch(`/api/meetings/${activeMeetingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmedTitle })
    });
    const data = await response.json();
    
    if (data.error) {
      alert(data.error);
    } else {
      sessionTitle.textContent = trimmedTitle;
      // Atualiza na memória local para refletir na busca
      const mIdx = meetings.findIndex(m => m.id === activeMeetingId);
      if (mIdx !== -1) {
        meetings[mIdx].title = trimmedTitle;
      }
      // Re-renderiza a lista para aplicar o novo nome
      renderMeetingsList(meetings);
    }
  } catch (err) {
    alert('Erro ao renomear reunião: ' + err.message);
  }
}

/**
 * Exclui a reunião ativa
 */
async function deleteActiveMeeting() {
  if (!activeMeetingId) return;
  
  const confirmed = confirm('Tem certeza que deseja excluir permanentemente esta gravação e sua ata correspondente?');
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/meetings/${activeMeetingId}`, {
      method: 'DELETE'
    });
    const data = await response.json();

    if (data.error) {
      alert(data.error);
    } else {
      alert('Gravação excluída com sucesso!');
      // Reseta UI
      stageContent.style.display = 'none';
      stageEmpty.style.display = 'flex';
      videoPlayer.src = '';
      activeMeetingId = null;
      
      // Recarrega a lista
      await fetchMeetings();
    }
  } catch (err) {
    alert('Erro ao excluir reunião: ' + err.message);
  }
}

/**
 * Seleciona e exibe uma reunião no palco principal
 */
async function selectMeeting(id) {
  activeMeetingId = id;
  
  // Atualiza classe ativa na sidebar
  document.querySelectorAll('.meeting-card').forEach(card => {
    if (card.dataset.id === id) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  const meeting = meetings.find(m => m.id === id);
  if (!meeting) return;

  // Mostra palco de conteúdo e oculta estado vazio
  stageEmpty.style.display = 'none';
  stageContent.style.display = 'block';

  // Configura Info Cabeçalho
  sessionTitle.textContent = meeting.title;
  sessionDate.textContent = meeting.date;

  // Configura Player de Vídeo (se houver)
  if (meeting.hasVideo) {
    videoPlayer.src = meeting.videoUrl;
    videoPlayer.style.display = 'block';
    videoPlayer.load();
    btnDownloadVideo.href = meeting.videoUrl;
    btnDownloadVideo.style.display = 'flex';
  } else {
    videoPlayer.src = '';
    videoPlayer.style.display = 'none';
    btnDownloadVideo.style.display = 'none';
  }

  // Verifica se o markdown está processando ou está disponível
  if (meeting.transcribing || recordingState.transcribing.includes(id)) {
    btnDownloadMarkdown.style.display = 'none';
    markdownRender.innerHTML = `
      <div class="empty-list" style="color: var(--text-muted); padding: 60px 0;">
        <i class="fa-solid fa-gears fa-spin" style="font-size: 3.5rem; margin-bottom: 20px; color: var(--primary);"></i>
        <h3>Transcrição em Andamento</h3>
        <p>A inteligência artificial está fatiando o áudio e gerando a ata resumida da reunião no Groq. O vídeo já pode ser assistido ao lado!</p>
      </div>
    `;
  } else if (meeting.hasMarkdown) {
    btnDownloadMarkdown.href = meeting.markdownUrl;
    btnDownloadMarkdown.style.display = 'flex';
    
    // Busca e renderiza o conteúdo markdown da ata
    try {
      markdownRender.innerHTML = '<div style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Carregando ata...</div>';
      const mdResponse = await fetch(`/api/meetings/${id}/markdown`);
      const mdText = await mdResponse.text();
      
      // Renderiza Markdown para HTML usando marked.js e insere uma classe de marcação
      markdownRender.innerHTML = `<div class="markdown-body-content">${marked.parse(mdText)}</div>`;
    } catch (err) {
      console.error('Erro ao buscar conteúdo da ata:', err);
      markdownRender.innerHTML = '<div style="color: #ef4444;">Erro ao renderizar a ata da reunião.</div>';
    }
  } else {
    btnDownloadMarkdown.style.display = 'none';
    markdownRender.innerHTML = '<div style="color: var(--text-muted);">Esta gravação não possui ata de transcrição.</div>';
  }
}
