const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const path = require('path');
const pool = require('./config/db');
const qrcode = require('qrcode');
const fs = require('fs');
const colors = require('colors');

const app = express();
app.use(express.json());

const instances = {};
const qrCodes = {}; // Armazena QR Codes temporariamente
const reconnectAttempts = {}; // Armazena tentativas de reconexão
const MAX_RECONNECT_ATTEMPTS = 5; // Define um limite de tentativas
const AUTH_PATH = path.join(__dirname, 'connect_instancias');
if (!fs.existsSync(AUTH_PATH)) fs.mkdirSync(AUTH_PATH);

const createWhatsAppClient = async (sessionId, isReconnect = false) => {
    if (!isReconnect && reconnectAttempts[sessionId] && reconnectAttempts[sessionId] >= MAX_RECONNECT_ATTEMPTS) {
        console.log(colors.red(`🚨 Máximo de tentativas atingido para ${sessionId}. Marcando como desconectado.`));
        await pool.query(`UPDATE whatsapp_instancias SET status = 'desconectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
        return;
    }

    const sessionPath = path.join(AUTH_PATH, sessionId);
    if (!isReconnect && fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const client = makeWASocket({
        auth: state,
        version,
        browser: ['Chrome', 'Chrome 110', 'Windows'],
        printQRInTerminal: false
    });

    instances[sessionId] = client;
    reconnectAttempts[sessionId] = 0;
    let responded = false;

    client.ev.on('creds.update', saveCreds);
    client.ev.on('connection.update', async (update) => {
        console.log(colors.cyan(`📡 Evento de conexão: ${JSON.stringify(update, null, 2)}`));
        const { connection, lastDisconnect, qr } = update;
        if (qr && !responded && !isReconnect) {
            responded = true;
            const qrBase64 = await qrcode.toDataURL(qr);
            qrCodes[sessionId] = qrBase64;
            setTimeout(() => console.log(colors.cyan(`📲 QR Code gerado para ${sessionId}.`)), 2000);
        }
        if (connection === 'open') {
            console.log(colors.green(`✅ Conexão iniciada para instância ${sessionId}!`));
            delete qrCodes[sessionId];
            reconnectAttempts[sessionId] = 0;
            await pool.query(`UPDATE whatsapp_instancias SET status = 'conectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log(colors.yellow(`🔄 Tentando reconectar instância ${sessionId}...`));
                createWhatsAppClient(sessionId, true);
            } else {
                console.log(colors.red(`⚠️ Usuário da instância ${sessionId} deslogado. Escaneie o QR Code novamente.`));
            }
        }
    });

    client.ev.on('messages.upsert', async (m) => {
        console.log(colors.magenta(`📩 Nova mensagem: ${JSON.stringify(m, null, 2)}`));
    });

    return client;
};
// Criar uma nova instância no banco
app.post('/api/whatsapp/instancia', async (req, res) => {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome da instância é obrigatório' });
    try {
        await pool.query(
            `INSERT INTO whatsapp_instancias (session_id, status) 
             VALUES ($1, 'desconectado') 
             ON CONFLICT (session_id) DO NOTHING`,
            [nome]
        );
        res.json({ message: 'Instância criada. Agora conecte o WhatsApp.', sessionId: nome });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar instância' });
    }
});

// Conectar um WhatsApp à instância e obter QR Code
app.post('/api/whatsapp/conectar', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId é obrigatório' });
    
    await createWhatsAppClient(sessionId, false);
    setTimeout(() => {
        if (qrCodes[sessionId]) {
            res.json({ sessionId, qr: qrCodes[sessionId] });
        } else {
            res.status(500).json({ error: 'QR Code não gerado a tempo' });
        }
    }, 2000);
});

// Obter QR Code temporário
app.get('/api/whatsapp/qrcode/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!qrCodes[sessionId]) {
        return res.status(404).json({ error: 'QR Code não encontrado ou instância já conectada.' });
    }
    res.json({ sessionId, qr: qrCodes[sessionId] });
});

// Obter o status da instância
app.get('/api/whatsapp/status/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const result = await pool.query('SELECT * FROM whatsapp_instancias WHERE session_id = $1', [sessionId]);
    res.json(result.rows[0] || { error: 'Instância não encontrada' });
});

// Reconectar instâncias ao iniciar o servidor
(async () => {
    const result = await pool.query("SELECT session_id FROM whatsapp_instancias WHERE status = 'conectado'");
    for (let row of result.rows) {
        console.log(colors.cyan(`Reconectando instância: ${row.session_id}`));
        await createWhatsAppClient(row.session_id, true);
    }
})();

// Obter todos os grupos da instância
app.get('/api/whatsapp/grupos/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    const groups = await instances[sessionId].groupFetchAllParticipating();
    res.json(groups);
});

// Criar um grupo
app.post('/api/whatsapp/grupos', async (req, res) => {
    const { sessionId, groupName, participants } = req.body;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    const response = await instances[sessionId].groupCreate(groupName, participants);
    res.json(response);
});

// Adicionar participante a um grupo
app.post('/api/whatsapp/grupos/adicionar', async (req, res) => {
    const { sessionId, groupId, participant } = req.body;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    await instances[sessionId].groupParticipantsUpdate(groupId, [participant], 'add');
    res.json({ message: 'Participante adicionado com sucesso' });
});

// Enviar mensagem apenas...
app.post('/api/whatsapp/mensagem', async (req, res) => {
    const { sessionId, to, message, mentions } = req.body;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    await instances[sessionId].sendMessage(to, { text: message });
    res.json({ message: 'Mensagem enviada com sucesso' });
});

// Enviar mensagem com Menção
app.post('/api/whatsapp/mensagem/mencao', async (req, res) => {
    const { sessionId, to, message, mentions } = req.body;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    try {
        const response = await instances[sessionId].sendMessage(to, {
            text: message,
            mentions: mentions // Lista de participantes mencionados
        });
        res.json({ message: 'Mensagem enviada com sucesso', response });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao enviar mensagem', details: error.toString() });
    }
});


// Obter informações de um grupo específico
app.get('/api/whatsapp/grupo/:sessionId/:groupId', async (req, res) => {
    const { sessionId, groupId } = req.params;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    try {
        const groupMetadata = await instances[sessionId].groupMetadata(groupId);
        res.json(groupMetadata);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar informações do grupo', details: error.toString() });
    }
});

// Obter todos os contatos da instância
app.get('/api/whatsapp/contatos/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    try {
        await instances[sessionId].waitForSocketOpen();
        const contacts = instances[sessionId].store?.contacts || {};
        res.json(contacts);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar contatos', details: error.toString() });
    }
});

// Obter informações detalhadas de um único contato
app.get('/api/whatsapp/contato/:sessionId/:contactId', async (req, res) => {
    const { sessionId, contactId } = req.params;
    if (!instances[sessionId]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    
    try {
        await instances[sessionId].waitForSocketOpen();
        const contact = await instances[sessionId].fetchStatus(contactId);
        const profilePicUrl = await instances[sessionId].profilePictureUrl(contactId, 'image').catch(() => null);
        res.json({ ...contact, profilePicUrl });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar informações do contato', details: error.toString() });
    }
});


(async () => {
    const result = await pool.query("SELECT session_id FROM whatsapp_instancias WHERE status = 'conectado'");
    for (let row of result.rows) {
        console.log(colors.cyan(`Reconectando instância: ${row.session_id}`));
        await createWhatsAppClient(row.session_id, true);
    }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(colors.green(`Servidor rodando na porta ${PORT}`)));

module.exports = { instances };
