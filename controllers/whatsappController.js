const { createWhatsAppClient, getQRCode, getInstanceStatus, instances } = require('../services/whatsappService');
const pool = require('../config/db');

/**
 * Cria uma nova instância no banco de dados
 */
exports.createInstance = async (req, res) => {
    const { nm_instancia } = req.body;
    if (!nm_instancia) return res.status(400).json({ error: 'Nome da instância é obrigatório' });

    try {
        await pool.query(`
            INSERT INTO whatsapp_instancias (session_id, status) 
            VALUES ($1, 'desconectado') 
            ON CONFLICT (session_id) DO NOTHING`, 
            [nm_instancia]
        );
        res.json({ message: 'Instância criada. Agora conecte o WhatsApp.', nm_instancia });
    } catch (error) {
        console.error('❌ Erro ao criar instância:', error.message);
        res.status(500).json({ error: 'Erro ao criar instância' });
    }
};

/**
 * Conecta uma instância ao WhatsApp e retorna o QR Code se necessário
 */
exports.connectInstance = async (req, res) => {
    const { nm_instancia } = req.body;
    if (!nm_instancia) return res.status(400).json({ error: 'nm_instancia obrigatório' });

    console.log(`🔌 Iniciando conexão para ${nm_instancia}...`);

    try {
        await createWhatsAppClient(nm_instancia, false, true);

        setTimeout(() => {
            const qrCode = getQRCode(nm_instancia);
            if (qrCode) {
                res.json({ nm_instancia, qr: qrCode });
            } else {
                res.json({ message: "Instância já conectada ou QR Code não necessário." });
            }
        }, 3000);
    } catch (error) {
        console.error(`❌ Erro ao conectar instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao conectar instância' });
    }
};

/**
 * Obtém o status de uma instância
 */
exports.getInstanceStatus = async (req, res) => {
    const { nm_instancia } = req.params;
    try {
        const status = await getInstanceStatus(nm_instancia);
        if (status) {
            res.json(status);
        } else {
            res.status(404).json({ error: 'Instância não encontrada' });
        }
    } catch (error) {
        console.error(`❌ Erro ao buscar status da instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar status da instância' });
    }
};

/**
 * Formata o número automaticamente para WhatsApp
 */
const formatNumber = (number, isGroup = false) => {
    if (isGroup) return number.includes('@g.us') ? number : `${number}@g.us`;
    return number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
};

/**
 * Envia uma mensagem para um contato (PV)
 */
exports.sendPrivateMessage = async (req, res) => {
    const { nm_instancia, number, message } = req.body;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        const formattedNumber = formatNumber(number, false);
        await instances[nm_instancia].sendMessage(formattedNumber, { text: message });
        res.json({ message: 'Mensagem enviada com sucesso para PV' });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem privada na instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao enviar mensagem privada' });
    }
};
/**
 * Obter todos os grupos da instância
 */
exports.getGroups = async (req, res) => {
    const { nm_instancia } = req.params;
    if (!instances[nm_instancia]) {
        return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    }

    try {
        const groups = await instances[nm_instancia].groupFetchAllParticipating();
        res.json(groups);
    } catch (error) {
        console.error(`❌ Erro ao buscar grupos na instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar grupos' });
    }
};


/**
 * Envia uma mensagem para um grupo
 */
exports.sendGroupMessage = async (req, res) => {
    const { nm_instancia, groupId, message } = req.body;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        const formattedGroupId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;
        await instances[nm_instancia].sendMessage(formattedGroupId, { text: message });
        res.json({ message: 'Mensagem enviada com sucesso para grupo' });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem para grupo na instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao enviar mensagem para grupo' });
    }
};


/**
 * Envia uma mensagem com menção para um contato (PV)
 */
exports.sendPrivateMentionMessage = async (req, res) => {
    const { nm_instancia, number, message, mentions } = req.body;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        const formattedNumber = formatNumber(number, false);
        await instances[nm_instancia].sendMessage(formattedNumber, { text: message, mentions });
        res.json({ message: 'Mensagem com menção enviada para PV' });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem com menção privada na instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao enviar mensagem com menção privada' });
    }
};

/**
 * Envia uma mensagem com menção para um grupo
 */
exports.sendGroupMentionMessage = async (req, res) => {
    const { nm_instancia, groupId, message, mentions } = req.body;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        const formattedNumber = formatNumber(groupId, true);
        await instances[nm_instancia].sendMessage(formattedNumber, { text: message, mentions });
        res.json({ message: 'Mensagem com menção enviada para grupo' });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem com menção para grupo na instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao enviar mensagem com menção para grupo' });
    }
};


/**
 * Adicionar participante ao grupo
 */
exports.addParticipantToGroup = async (req, res) => {
    const { nm_instancia, groupId, participant } = req.body;
    
    if (!instances[nm_instancia]) {
        return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });
    }

    const client = instances[nm_instancia];

    try {
        const formattedParticipant = formatNumber(participant, false);

        // Verifica se o número está no WhatsApp
        const [exists] = await client.onWhatsApp(formattedParticipant);
        if (!exists?.exists) {
            return res.status(400).json({ error: "O número não está registrado no WhatsApp." });
        }

        // Tenta adicionar ao grupo
        try {
            await client.groupParticipantsUpdate(formatNumber(groupId, true), [formattedParticipant], 'add');
            return res.json({ message: 'Participante adicionado com sucesso' });
        } catch (addError) {
            console.error(`❌ Erro ao adicionar ${formattedParticipant} ao grupo ${groupId}:`, addError.message);
            return res.status(400).json({ error: 'Não foi possível adicionar o participante ao grupo' });
        }

    } catch (error) {
        console.error(`❌ Erro ao adicionar participante ao grupo ${groupId}:`, error.message);
        res.status(500).json({ error: 'Erro ao adicionar participante ao grupo' });
    }
};

/**
 * Obter informações de um grupo específico
 */
exports.getGroupDetails = async (req, res) => {
    const { nm_instancia, groupId } = req.params;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        const groupMetadata = await instances[nm_instancia].groupMetadata(formatNumber(groupId, true));
        res.json(groupMetadata);
    } catch (error) {
        console.error(`❌ Erro ao buscar informações do grupo ${groupId}:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar informações do grupo' });
    }
};

/**
 * Obter todos os contatos da instância
 */
exports.getContacts = async (req, res) => {
    const { nm_instancia } = req.params;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        await instances[nm_instancia].waitForSocketOpen();
        const contacts = instances[nm_instancia].store?.contacts || {};
        res.json(contacts);
    } catch (error) {
        console.error(`❌ Erro ao buscar contatos na instância ${nm_instancia}:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar contatos' });
    }
};

/**
 * Obter informações detalhadas de um único contato
 */
exports.getContactDetails = async (req, res) => {
    const { nm_instancia, contactId } = req.params;
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        await instances[nm_instancia].waitForSocketOpen();
        const contact = await instances[nm_instancia].fetchStatus(formatNumber(contactId, false));
        const profilePicUrl = await instances[nm_instancia].profilePictureUrl(formatNumber(contactId, false), 'image').catch(() => null);
        res.json({ ...contact, profilePicUrl });
    } catch (error) {
        console.error(`❌ Erro ao buscar informações do contato ${contactId}:`, error.message);
        res.status(500).json({ error: 'Erro ao buscar informações do contato' });
    }
};

/**
 * Enviar mensagem interativa (lista)
 */
exports.sendListMessage = async (req, res) => {
    const { nm_instancia, number, title, description, buttonText, footerText, sections } = req.body;
    
    if (!instances[nm_instancia]) return res.status(404).json({ error: 'Instância não encontrada ou desconectada' });

    try {
        const client = instances[nm_instancia];
        const formattedNumber = formatNumber(number, false);

        const listMessage = {
            listMessage: {
                title: title,
                description: description,
                buttonText: buttonText,
                footer: footerText,
                sections: sections
            }
        };

        await client.sendMessage(formattedNumber, listMessage);
        res.json({ message: 'Mensagem interativa enviada com sucesso' });

    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem interativa:`, error.message);
        res.status(500).json({ error: 'Erro ao enviar mensagem interativa' });
    }
};