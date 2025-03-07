const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Criar uma nova instância
router.post('/instancia', whatsappController.createInstance);

// Conectar uma instância e obter QR Code
router.post('/conectar', whatsappController.connectInstance);

// Obter status da instância
router.get('/status/:nm_instancia', whatsappController.getInstanceStatus);

// Enviar mensagem para um contato (PV)
router.post('/mensagem/pv', whatsappController.sendPrivateMessage);

// Enviar mensagem para um grupo
router.post('/mensagem/grupo', whatsappController.sendGroupMessage);

// Enviar mensagem com menção para um contato (PV)
router.post('/mensagem/mencao/pv', whatsappController.sendPrivateMentionMessage);

// Enviar mensagem com menção para um grupo
router.post('/mensagem/mencao/grupo', whatsappController.sendGroupMentionMessage);

// Adicionar participante a um grupo
router.post('/grupos/adicionar', whatsappController.addParticipantToGroup);

// Obter todos os grupos da instância
router.get('/grupos/:nm_instancia', whatsappController.getGroups);

// Obter informações de um grupo específico
router.get('/grupo/:nm_instancia/:groupId', whatsappController.getGroupDetails);

// Obter todos os contatos da instância
router.get('/contatos/:nm_instancia', whatsappController.getContacts);

// Obter informações detalhadas de um contato
router.get('/contato/:nm_instancia/:contactId', whatsappController.getContactDetails);

// Enviar mensagem interativa (lista)
router.post('/mensagem/lista', whatsappController.sendListMessage);

module.exports = router;
