const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const whatsappRoutes = require('./routes/whatsappRoutes');

const app = express();

// Middlewares
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

// Rotas
app.use('/api/whatsapp', whatsappRoutes);

// Rota de teste
app.get('/', (req, res) => {
    res.send('🚀 API do WhatsApp está rodando!');
});

module.exports = app;
