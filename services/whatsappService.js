const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, AUTH_PATH } = require('../config/whatsapp');
const pool = require('../config/db');
const qrcode = require('qrcode');
const fs = require('fs');
const colors = require('colors');

const instances = {};
const qrCodes = {};
const reconnectAttempts = {};
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Cria uma nova instância do WhatsApp e gerencia a conexão
 * @param {string} sessionId - Identificador da instância
 * @param {boolean} isReconnect - Se é uma tentativa de reconexão
 * @param {boolean} fromRequest - Se a conexão foi iniciada via requisição (para exibir QR Code)
 */
const createWhatsAppClient = async (sessionId, isReconnect = false, fromRequest = false) => {
    try {
        if (!sessionId) return console.log(colors.red("❌ Erro: sessionId não fornecido!"));

        const sessionPath = `${AUTH_PATH}/${sessionId}`;
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

        if (reconnectAttempts[sessionId] >= MAX_RECONNECT_ATTEMPTS) {
            console.log(colors.red(`🚨 Máximo de tentativas atingido para ${sessionId}.`));
            await pool.query(`UPDATE whatsapp_instancias SET status = 'desconectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
            return;
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const client = makeWASocket({ version, auth: state, printQRInTerminal: false });

        instances[sessionId] = client;
        reconnectAttempts[sessionId] = 0;

        client.ev.on('creds.update', saveCreds);

        client.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && fromRequest) {
                qrCodes[sessionId] = await qrcode.toDataURL(qr);
            }

            if (connection === 'open') {
                console.log(colors.green(`✅ Conectado: ${sessionId}`));
                delete qrCodes[sessionId];
                reconnectAttempts[sessionId] = 0;
                await pool.query(`UPDATE whatsapp_instancias SET status = 'conectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
            }

            if (connection === 'close') {
                if (reconnectAttempts[sessionId] < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts[sessionId]++;
                    console.log(`🔄 Tentando reconectar ${sessionId} (${reconnectAttempts[sessionId]}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => createWhatsAppClient(sessionId, true), 5000);
                } else {
                    console.log(`🚨 Falha ao reconectar ${sessionId}. Máximo de tentativas atingido.`);
                    await pool.query(`UPDATE whatsapp_instancias SET status = 'desconectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
                }
            }
        });

        return client;
    } catch (error) {
        console.error(colors.red(`❌ Erro ao criar cliente WhatsApp: ${error.message}`));
    }
};

/**
  Obtém o QR Code gerado para uma instância específica
  @param {string} sessionId - Identificador da instância
  @returns {string|null} - QR Code em formato Base64 ou null se não existir
 */
const getQRCode = (sessionId) => {
    return qrCodes[sessionId] || null;
};

/**
 * Obtém o status de uma instância no banco de dados
 * @param {string} sessionId - Identificador da instância
 * @returns {object|null} - Dados da instância ou null se não encontrada
 */
const getInstanceStatus = async (sessionId) => {
    const result = await pool.query('SELECT * FROM whatsapp_instancias WHERE session_id = $1', [sessionId]);
    return result.rows[0] || null;
};

(async () => {
    const result = await pool.query("SELECT session_id FROM whatsapp_instancias WHERE status = 'conectado'");

    for (let row of result.rows) {
        const sessionId = row.session_id;
        console.log(colors.cyan(`🔄 Tentando reconectar instância: ${sessionId}`));

        let attempts = 0;
        let success = false;

        while (attempts < 3) {
            try {
                await createWhatsAppClient(sessionId, true);
                success = true;
                break;
            } catch (error) {
                attempts++;
                console.log(colors.yellow(`⚠️ Tentativa ${attempts}/3 falhou para ${sessionId}.`));
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        if (!success) {
            console.log(colors.red(`🚨 Falha ao reconectar ${sessionId}. Marcando como desconectado.`));
            await pool.query(`UPDATE whatsapp_instancias SET status = 'desconectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
        }
    }
})();

module.exports = {
    createWhatsAppClient,
    getQRCode,
    getInstanceStatus,
    instances
};
