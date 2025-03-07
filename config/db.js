const { Pool } = require('pg');
require('dotenv').config(); // Carrega as variáveis do .env

// Configuração do pool de conexões
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || '178.156.151.200',
    database: process.env.DB_NAME || 'hyperion',
    password: process.env.DB_PASSWORD || 'orPHoLdFAsHObWEstaCyCHarI',
    port: process.env.DB_PORT || 5432,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false // SSL opcional
});

// Testa a conexão ao iniciar o servidor
pool.connect()
    .then(() => console.log('✅ Banco de dados conectado com sucesso!'))
    .catch(err => console.error('❌ Erro ao conectar ao banco de dados:', err.message));

module.exports = pool;
