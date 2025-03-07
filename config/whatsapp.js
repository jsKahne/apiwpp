const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const colors = require('colors');

// Caminho onde as credenciais de autenticação das instâncias serão armazenadas
const AUTH_PATH = path.join(__dirname, '../connect_instancias');

// Criando a pasta se não existir
if (!fs.existsSync(AUTH_PATH)) {
    fs.mkdirSync(AUTH_PATH, { recursive: true });
    console.log(colors.green('📂 Diretório de autenticação criado em:'), AUTH_PATH);
}

// Exportando as configurações do WhatsApp para reutilização no projeto
module.exports = {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    AUTH_PATH
};
