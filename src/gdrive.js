import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Carrega a configuração do Google Drive a partir dos parâmetros fornecidos,
 * variáveis de ambiente ou arquivo de configuração persistente.
 * @param {Object} [customConfig] - Configurações opcionais passadas explicitamente.
 * @returns {Object} Configuração consolidada do Google Drive.
 */
export function getDriveConfig(customConfig = {}) {
  // 1. Tenta pegar de customConfig
  let keyFile = customConfig.GDRIVE_KEY_FILE || process.env.GDRIVE_KEY_FILE || '';
  let serviceAccountJson = customConfig.GDRIVE_SERVICE_ACCOUNT_JSON || process.env.GDRIVE_SERVICE_ACCOUNT_JSON || '';
  let parentFolderId = customConfig.GDRIVE_PARENT_FOLDER_ID || process.env.GDRIVE_PARENT_FOLDER_ID || '';
  let enabled = customConfig.GDRIVE_ENABLED !== undefined 
    ? (customConfig.GDRIVE_ENABLED === true || customConfig.GDRIVE_ENABLED === 'true')
    : (process.env.GDRIVE_ENABLED === 'true' || process.env.GDRIVE_ENABLED === '1');

  // 2. Se houver config.json em dashboard/public/media, verifica se tem overrides
  const configFilePath = path.join(process.cwd(), 'dashboard', 'public', 'media', 'config.json');
  if (fs.existsSync(configFilePath)) {
    try {
      const persistedConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      if (persistedConfig.GDRIVE_KEY_FILE && !customConfig.GDRIVE_KEY_FILE) {
        keyFile = persistedConfig.GDRIVE_KEY_FILE;
      }
      if (persistedConfig.GDRIVE_SERVICE_ACCOUNT_JSON && !customConfig.GDRIVE_SERVICE_ACCOUNT_JSON) {
        serviceAccountJson = persistedConfig.GDRIVE_SERVICE_ACCOUNT_JSON;
      }
      if (persistedConfig.GDRIVE_PARENT_FOLDER_ID && !customConfig.GDRIVE_PARENT_FOLDER_ID) {
        parentFolderId = persistedConfig.GDRIVE_PARENT_FOLDER_ID;
      }
      if (persistedConfig.GDRIVE_ENABLED !== undefined && customConfig.GDRIVE_ENABLED === undefined) {
        enabled = (persistedConfig.GDRIVE_ENABLED === true || persistedConfig.GDRIVE_ENABLED === 'true');
      }
    } catch (e) {
      // Ignora erro de leitura silenciosamente
    }
  }

  // Se nenhum arquivo específico foi configurado, mas existe gdrive-credentials.json na raiz ou em media/, usa como padrão
  if (!keyFile && !serviceAccountJson) {
    const defaultCredentialsRoot = path.join(process.cwd(), 'gdrive-credentials.json');
    const defaultCredentialsMedia = path.join(process.cwd(), 'dashboard', 'public', 'media', 'gdrive-credentials.json');
    
    if (fs.existsSync(defaultCredentialsRoot)) {
      keyFile = defaultCredentialsRoot;
    } else if (fs.existsSync(defaultCredentialsMedia)) {
      keyFile = defaultCredentialsMedia;
    }
  }

  return {
    enabled,
    keyFile,
    serviceAccountJson,
    parentFolderId,
    clientId: customConfig.GDRIVE_CLIENT_ID || process.env.GDRIVE_CLIENT_ID || '',
    clientSecret: customConfig.GDRIVE_CLIENT_SECRET || process.env.GDRIVE_CLIENT_SECRET || '',
    refreshToken: customConfig.GDRIVE_REFRESH_TOKEN || process.env.GDRIVE_REFRESH_TOKEN || ''
  };
}

/**
 * Cria e autentica a instância do cliente Google Drive.
 * @param {Object} [customConfig] - Configuração opcional.
 * @returns {Promise<{ drive: any, authEmail: string, authType: string, config: Object }>}
 */
export async function getDriveClient(customConfig = {}) {
  const config = getDriveConfig(customConfig);
  const SCOPES = ['https://www.googleapis.com/auth/drive'];

  let authClient = null;
  let authEmail = '';
  let authType = '';

  // 1. Prioridade: Service Account JSON em texto/objeto
  if (config.serviceAccountJson) {
    try {
      const credentials = typeof config.serviceAccountJson === 'string'
        ? JSON.parse(config.serviceAccountJson)
        : config.serviceAccountJson;
      
      authClient = new google.auth.GoogleAuth({
        credentials,
        scopes: SCOPES
      });
      authEmail = credentials.client_email || 'Service Account';
      authType = 'Service Account (JSON)';
    } catch (err) {
      throw new Error(`Erro ao analisar GDRIVE_SERVICE_ACCOUNT_JSON: ${err.message}`);
    }
  }
  // 2. Arquivo de Chave de Service Account
  else if (config.keyFile) {
    let resolvedKeyPath = config.keyFile;
    if (!path.isAbsolute(resolvedKeyPath)) {
      resolvedKeyPath = path.join(process.cwd(), config.keyFile);
    }

    if (!fs.existsSync(resolvedKeyPath)) {
      throw new Error(`Arquivo de credenciais do Google Drive não encontrado: ${resolvedKeyPath}`);
    }

    try {
      const keyFileContent = JSON.parse(fs.readFileSync(resolvedKeyPath, 'utf-8'));
      authEmail = keyFileContent.client_email || 'Service Account';
    } catch (e) {
      authEmail = 'Service Account';
    }

    authClient = new google.auth.GoogleAuth({
      keyFile: resolvedKeyPath,
      scopes: SCOPES
    });
    authType = 'Service Account (Arquivo)';
  }
  // 3. OAuth2 com Refresh Token
  else if (config.clientId && config.clientSecret && config.refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: config.refreshToken });
    authClient = oauth2Client;
    authEmail = 'Conta OAuth2';
    authType = 'OAuth2';
  } else {
    throw new Error('Nenhuma credencial do Google Drive foi configurada (Service Account JSON, Arquivo ou OAuth2).');
  }

  const drive = google.drive({ version: 'v3', auth: authClient });
  return { drive, authEmail, authType, config };
}

/**
 * Testa a conexão com o Google Drive e verifica as permissões.
 * @param {Object} [customConfig] - Configuração opcional.
 * @returns {Promise<{ success: boolean, message: string, email?: string, rootFolderId?: string, rootFolderName?: string, rootFolderLink?: string, authType?: string }>}
 */
export async function testDriveConnection(customConfig = {}) {
  try {
    const { drive, authEmail, authType, config } = await getDriveClient(customConfig);

    // Testa permissão buscando informações sobre a pasta raiz ou criando
    const rootFolder = await ensureRootFolder(drive, config.parentFolderId);

    return {
      success: true,
      message: `Conexão bem-sucedida com o Google Drive via ${authType}!`,
      email: authEmail,
      rootFolderId: rootFolder.id,
      rootFolderName: rootFolder.name,
      rootFolderLink: rootFolder.webViewLink,
      authType
    };
  } catch (err) {
    console.error('[Google Drive Test] Falha no teste de conexão:', err.message);
    return {
      success: false,
      message: `Falha ao conectar com o Google Drive: ${err.message}`
    };
  }
}

/**
 * Garante a existência da pasta principal '321gravando' ou utiliza a pasta especificada no ID.
 * @param {any} drive - Instância autenticada do Google Drive API.
 * @param {string} [parentFolderId] - ID opcional de uma pasta existente.
 * @param {string} [folderName='321gravando'] - Nome da pasta principal.
 * @returns {Promise<{ id: string, name: string, webViewLink: string }>}
 */
export async function ensureRootFolder(drive, parentFolderId = null, folderName = '321gravando') {
  // Se o usuário especificou um ID de pasta raiz no .env/dashboard
  if (parentFolderId && parentFolderId.trim()) {
    const targetId = parentFolderId.trim();
    try {
      const response = await drive.files.get({
        fileId: targetId,
        fields: 'id, name, mimeType, webViewLink, trashed'
      });

      if (response.data && !response.data.trashed) {
        return {
          id: response.data.id,
          name: response.data.name,
          webViewLink: response.data.webViewLink
        };
      }
    } catch (err) {
      console.warn(`[Google Drive] Não foi possível acessar a pasta com ID "${targetId}": ${err.message}. Buscando/Criando pasta "${folderName}"...`);
    }
  }

  // Busca se já existe uma pasta chamada '321gravando' que não está na lixeira
  try {
    const searchResponse = await drive.files.list({
      q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, webViewLink)',
      spaces: 'drive'
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      const found = searchResponse.data.files[0];
      return {
        id: found.id,
        name: found.name,
        webViewLink: found.webViewLink
      };
    }

    // Se não encontrou, cria a pasta '321gravando'
    console.log(`[Google Drive] Criando pasta raiz principal "${folderName}" no Google Drive...`);
    const createResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id, name, webViewLink'
    });

    return {
      id: createResponse.data.id,
      name: createResponse.data.name,
      webViewLink: createResponse.data.webViewLink
    };
  } catch (err) {
    throw new Error(`Erro ao garantir pasta raiz no Google Drive: ${err.message}`);
  }
}

/**
 * Cria a subpasta específica para uma reunião dentro da pasta raiz.
 * @param {any} drive - Instância do Drive API.
 * @param {string} rootFolderId - ID da pasta '321gravando'.
 * @param {string} folderName - Nome da pasta da reunião (ex: '2026-08-18_19-30 - Alinhamento Semanal').
 * @returns {Promise<{ id: string, name: string, webViewLink: string }>}
 */
export async function createMeetingFolder(drive, rootFolderId, folderName) {
  try {
    // Sanitiza o nome da pasta para evitar quebras
    const safeFolderName = folderName.replace(/[\\/:*?"<>|]/g, '-').trim();

    console.log(`[Google Drive] Criando subpasta da reunião: "${safeFolderName}" (Parent: ${rootFolderId})...`);
    const response = await drive.files.create({
      requestBody: {
        name: safeFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId]
      },
      fields: 'id, name, webViewLink'
    });

    return {
      id: response.data.id,
      name: response.data.name,
      webViewLink: response.data.webViewLink
    };
  } catch (err) {
    throw new Error(`Erro ao criar subpasta da reunião no Google Drive: ${err.message}`);
  }
}

/**
 * Faz upload de um arquivo via streaming para uma pasta do Google Drive.
 * @param {any} drive - Instância do Drive API.
 * @param {string} folderId - ID da pasta destino.
 * @param {string} filePath - Caminho local do arquivo.
 * @param {string} mimeType - MIME Type do arquivo (ex: 'video/mp4' ou 'text/markdown').
 * @param {string} fileName - Nome com o qual o arquivo será salvo no Drive.
 * @returns {Promise<{ id: string, name: string, webViewLink: string, size: string }>}
 */
export async function uploadFileStream(drive, folderId, filePath, mimeType, fileName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado para upload: ${filePath}`);
  }

  const fileStats = fs.statSync(filePath);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
  console.log(`[Google Drive] Iniciando upload via stream de "${fileName}" (${fileSizeMB} MB)...`);

  const fileMetadata = {
    name: fileName,
    parents: [folderId]
  };

  const media = {
    mimeType,
    body: fs.createReadStream(filePath)
  };

  try {
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink, size'
    });

    console.log(`[Google Drive] Upload concluído: "${fileName}" (ID: ${response.data.id})`);
    return {
      id: response.data.id,
      name: response.data.name,
      webViewLink: response.data.webViewLink,
      webContentLink: response.data.webContentLink,
      size: response.data.size
    };
  } catch (err) {
    throw new Error(`Erro ao fazer upload do arquivo "${fileName}": ${err.message}`);
  }
}

/**
 * Lê o arquivo de metadados do Google Drive de uma reunião local.
 * @param {string} mediaDir - Diretório da pasta media.
 * @param {string} sessionId - ID da sessão da reunião.
 * @returns {Object|null}
 */
export function getMeetingDriveMetadata(mediaDir, sessionId) {
  const metaPath = path.join(mediaDir, `${sessionId}.drive.json`);
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Salva o arquivo de metadados do Google Drive para uma reunião local.
 * @param {string} mediaDir - Diretório da pasta media.
 * @param {string} sessionId - ID da sessão da reunião.
 * @param {Object} metadata - Dados do Google Drive a persistir.
 */
export function saveMeetingDriveMetadata(mediaDir, sessionId, metadata) {
  const metaPath = path.join(mediaDir, `${sessionId}.drive.json`);
  try {
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (e) {
    console.error(`[Google Drive] Erro ao salvar metadados em ${metaPath}:`, e.message);
  }
}

/**
 * Orquestra o fluxo completo de sincronização de uma reunião com o Google Drive.
 * Cria a pasta da reunião dentro de '321gravando' e envia o MP4 e o Markdown.
 * @param {Object} params - Parâmetros da sincronização.
 * @param {string} params.sessionId - ID da reunião (ex: 'reuniao_2026-08-18T19-30-00').
 * @param {string} params.title - Título amigável da reunião.
 * @param {string} params.mediaDir - Diretório onde os arquivos locais estão salvos.
 * @param {string} [params.mp4Path] - Caminho completo do arquivo de vídeo MP4.
 * @param {string} [params.mdPath] - Caminho completo da ata Markdown.
 * @param {Object} [params.customConfig] - Configurações opcionais de conexão.
 * @returns {Promise<Object>} Resultado da sincronização com links e status.
 */
export async function syncMeetingToDrive({
  sessionId,
  title,
  mediaDir,
  mp4Path,
  mdPath,
  customConfig = {}
}) {
  const config = getDriveConfig(customConfig);

  if (!config.enabled && !customConfig.force) {
    console.log('[Google Drive] Sincronização com Google Drive desabilitada (GDRIVE_ENABLED=false).');
    return {
      synced: false,
      reason: 'Google Drive desabilitado nas configurações.'
    };
  }

  console.log(`\n==================================================`);
  console.log(`[Google Drive] Iniciando sincronização da reunião: ${sessionId}`);
  console.log(`[Google Drive] Título: ${title || sessionId}`);
  console.log(`==================================================\n`);

  // Registra status inicial de upload
  saveMeetingDriveMetadata(mediaDir, sessionId, {
    status: 'syncing',
    startedAt: new Date().toISOString(),
    folderUrl: null,
    videoUrl: null,
    markdownUrl: null,
    error: null
  });

  try {
    const { drive, authEmail } = await getDriveClient(customConfig);

    // 1. Garante ou localiza a pasta raiz '321gravando'
    const rootFolder = await ensureRootFolder(drive, config.parentFolderId);
    console.log(`[Google Drive] Pasta raiz "321gravando" pronta: ${rootFolder.id}`);

    // 2. Formata o nome da pasta da reunião (ex: "2026-08-18_19-30 - Planejamento Estratégico")
    let folderDisplayName = sessionId.replace('reuniao_', '');
    if (title && title !== sessionId && !title.startsWith('reuniao_')) {
      folderDisplayName = `${folderDisplayName} - ${title}`;
    }

    // 3. Cria a subpasta da reunião dentro de '321gravando'
    const meetingFolder = await createMeetingFolder(drive, rootFolder.id, folderDisplayName);
    console.log(`[Google Drive] Pasta da reunião criada no Drive: ${meetingFolder.webViewLink}`);

    let videoUploadResult = null;
    let markdownUploadResult = null;

    // 4. Upload do arquivo de Ata Markdown (.md)
    const targetMdPath = mdPath || path.join(mediaDir, `${sessionId}.md`);
    if (fs.existsSync(targetMdPath)) {
      const mdFileName = `${title ? title.replace(/[\\/:*?"<>|]/g, '-') : sessionId}.md`;
      markdownUploadResult = await uploadFileStream(
        drive,
        meetingFolder.id,
        targetMdPath,
        'text/markdown',
        mdFileName
      );
    } else {
      console.log(`[Google Drive] Arquivo Markdown não encontrado em ${targetMdPath}. Pulando envio de ata.`);
    }

    // 5. Upload do arquivo de Vídeo MP4 (.mp4)
    const targetMp4Path = mp4Path || path.join(mediaDir, `${sessionId}.mp4`);
    if (fs.existsSync(targetMp4Path)) {
      const videoFileName = `${sessionId}.mp4`;
      videoUploadResult = await uploadFileStream(
        drive,
        meetingFolder.id,
        targetMp4Path,
        'video/mp4',
        videoFileName
      );
    } else {
      console.log(`[Google Drive] Arquivo MP4 não encontrado em ${targetMp4Path}. Pulando envio de vídeo.`);
    }

    // 6. Persiste os metadados finais de sincronização
    const driveMetadata = {
      status: 'synced',
      syncedAt: new Date().toISOString(),
      authEmail,
      folderId: meetingFolder.id,
      folderName: meetingFolder.name,
      folderUrl: meetingFolder.webViewLink,
      videoFileId: videoUploadResult ? videoUploadResult.id : null,
      videoUrl: videoUploadResult ? videoUploadResult.webViewLink : null,
      markdownFileId: markdownUploadResult ? markdownUploadResult.id : null,
      markdownUrl: markdownUploadResult ? markdownUploadResult.webViewLink : null,
      error: null
    };

    saveMeetingDriveMetadata(mediaDir, sessionId, driveMetadata);

    console.log(`\n==================================================`);
    console.log(`[Google Drive] SUCESSO: Reunião sincronizada no Google Drive!`);
    console.log(`- Pasta no Drive: ${meetingFolder.webViewLink}`);
    if (videoUploadResult) console.log(`- Vídeo no Drive: ${videoUploadResult.webViewLink}`);
    if (markdownUploadResult) console.log(`- Ata no Drive: ${markdownUploadResult.webViewLink}`);
    console.log(`==================================================\n`);

    return {
      synced: true,
      ...driveMetadata
    };

  } catch (err) {
    console.error(`[Google Drive] Erro durante a sincronização da sessão ${sessionId}:`, err);

    const errorMetadata = {
      status: 'error',
      failedAt: new Date().toISOString(),
      error: err.message,
      folderUrl: null,
      videoUrl: null,
      markdownUrl: null
    };

    saveMeetingDriveMetadata(mediaDir, sessionId, errorMetadata);

    return {
      synced: false,
      error: err.message
    };
  }
}
