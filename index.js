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

const createWhatsAppClient = async (sessionId, isReconnect = false, fromRequest = false) => {
    try {
        if (!sessionId) {
            console.log(colors.red("❌ Erro: sessionId não fornecido!"));
            return;
        }

        const sessionPath = path.join(AUTH_PATH, sessionId);
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

        if (reconnectAttempts[sessionId] && reconnectAttempts[sessionId] >= MAX_RECONNECT_ATTEMPTS) {
            console.log(colors.red(`🚨 Máximo de tentativas atingido para ${sessionId}. Marcando como desconectado.`));
            await pool.query(`UPDATE whatsapp_instancias SET status = 'desconectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
            return;
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        console.log("WhatsApp Version:", version);

        const client = makeWASocket({
            version: [2, 3000, 1020646053], 
            auth: state,
            browser: ["WhatsApp", "MacOS", "10.15.7"],
            printQRInTerminal: false
        });

        
        instances[sessionId] = client;
        reconnectAttempts[sessionId] = 0;

        client.ev.on('creds.update', saveCreds);

        client.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // 📌 Só exibir QR Code se a conexão foi iniciada por requisição
            if (qr && fromRequest) {
                qrCodes[sessionId] = await qrcode.toDataURL(qr);
                console.log(colors.cyan(`📲 QR Code gerado para ${sessionId}.`));
            }

            if (connection === 'open') {
                console.log(colors.green(`✅ Conexão estabelecida para instância ${sessionId}!`));
                delete qrCodes[sessionId];
                reconnectAttempts[sessionId] = 0;
                await pool.query(`UPDATE whatsapp_instancias SET status = 'conectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
            }

            if (connection === 'close') {
                if (reconnectAttempts[sessionId] < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts[sessionId]++;
                    console.log(colors.yellow(`🔄 Tentando reconectar ${sessionId} (${reconnectAttempts[sessionId]}/${MAX_RECONNECT_ATTEMPTS})...`));
                    setTimeout(() => createWhatsAppClient(sessionId, true), 5000);
                } else {
                    console.log(colors.red(`🚨 Falha ao reconectar ${sessionId}. Marcando como desconectado.`));
                    await pool.query(`UPDATE whatsapp_instancias SET status = 'desconectado', dt_ultima_atualizacao = NOW() WHERE session_id = $1`, [sessionId]);
                }
            }
        });

        return client;
    } catch (error) {
        console.error(colors.red(`❌ Erro ao criar cliente WhatsApp: ${error.message}`));
    }
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

    console.log(colors.blue(`🔌 Iniciando conexão para ${sessionId}...`));

    // Inicia a conexão e espera o QR Code ser gerado (caso necessário)
    await createWhatsAppClient(sessionId, false, true);

    setTimeout(() => {
        if (qrCodes[sessionId]) {
            console.log(colors.green(`✅ QR Code gerado para ${sessionId}.`));
            res.json({ sessionId, qr: qrCodes[sessionId] });
        } else {
            console.log(colors.yellow(`⚠️ Nenhum QR Code gerado para ${sessionId}, pode já estar conectado.`));
            res.json({ message: "Instância já conectada ou QR Code não necessário." });
        }
    }, 3000); // Espera 3 segundos para garantir que o QR Code seja gerado
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


const inviteLinks = {};
// Adicionar participante ao grupo
app.post('/api/whatsapp/grupos/adicionar', async (req, res) => {
    const { sessionId, groupId, participant } = req.body;
    
    if (!instances[sessionId]) {
        return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    }

    const client = instances[sessionId];

    try {
        if (!participant.endsWith("@s.whatsapp.net")) {
            return res.status(400).json({ error: "Número inválido. Deve ser no formato 5511999999999@s.whatsapp.net" });
        }

        // 🔍 Verifica se o número está no WhatsApp
        const [exists] = await client.onWhatsApp(participant);
        if (!exists?.exists) {
            return res.status(400).json({ error: "O número não está registrado no WhatsApp." });
        }

        console.log(colors.yellow(`⚠️ Verificando se ${participant} está salvo na agenda...`));

        // 🗂️ Obtém a lista de contatos da instância
        const contacts = client.store?.contacts || {};
        const contactExists = Object.keys(contacts).includes(participant);

        // 📌 Se o contato não existir, tenta enviar mensagem para salvar
        if (!contactExists) {
            console.log(colors.yellow(`⚠️ Contato ${participant} não encontrado na agenda, salvando...`));
            try {
                await client.sendMessage(participant, { text: "Olá! 😊" });
                console.log(colors.green(`✅ Contato ${participant} salvo com sucesso!`));
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (saveError) {
                console.log(colors.red(`❌ Erro ao salvar contato ${participant}: ${saveError.message}`));
                return res.status(500).json({ error: "Erro ao salvar contato antes de adicionar ao grupo." });
            }
        }

        // 🔄 Agora tenta adicionar ao grupo
        console.log(colors.yellow(`⚠️ Tentando adicionar ${participant} ao grupo ${groupId}...`));

        try {
            await client.groupParticipantsUpdate(groupId, [participant], 'add');
            console.log(colors.green(`✅ Participante ${participant} adicionado ao grupo ${groupId}!`));
            return res.json({ message: 'Participante adicionado com sucesso' });

        } catch (addError) {
            console.log(colors.red(`❌ Erro ao adicionar ${participant} ao grupo: ${addError.message}`));

            // 🔗 Se não puder adicionar, envia o link original (se já existir)
            if (addError.message.includes("bad-request")) {
                if (inviteLinks[groupId]) {
                    console.log(colors.green(`✅ Usando link de convite já existente: ${inviteLinks[groupId]}`));
                    return res.json({ message: 'Não foi possível adicionar o participante, mas um convite foi enviado.', inviteUrl: inviteLinks[groupId] });
                }

                console.log(colors.red(`❌ Nenhum link de convite encontrado para ${groupId}.`));
                return res.status(400).json({ error: "Não foi possível adicionar e não há convite salvo para este grupo." });
            }

            return res.status(400).json({ error: "Não foi possível adicionar o número ao grupo." });
        }

    } catch (error) {
        console.error(colors.red(`❌ Erro ao adicionar ${participant} ao grupo ${groupId}: ${error.message}`));
        res.status(500).json({ error: 'Erro ao adicionar participante ao grupo', details: error.toString() });
    }
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



app.post('/api/whatsapp/mensagem/lista', async (req, res) => {
    const { sessionId, number, title, description, buttonText, footerText, sections } = req.body;

    if (!instances[sessionId]) {
        return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    }

    try {
        const client = instances[sessionId];

        // Criando a estrutura correta da mensagem interativa de lista
        const listMessage = {
            listMessage: {
                title: title, // Título da lista
                description: description, // Texto principal
                buttonText: buttonText, // Texto do botão
                footer: footerText, // Rodapé da mensagem
                sections: sections // Estrutura das seções
            }
        };

        // Enviando a mensagem interativa para o número especificado
        await client.sendMessage(`${number}@s.whatsapp.net`, listMessage);

        res.json({ message: 'Mensagem com lista enviada com sucesso' });

    } catch (error) {
        console.error(colors.red(`❌ Erro ao enviar mensagem com lista: ${error.message}`));
        res.status(500).json({ error: 'Erro ao enviar mensagem com lista', details: error.toString() });
    }
});


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




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(colors.green(`Servidor rodando na porta ${PORT}`)));

module.exports = { instances };
