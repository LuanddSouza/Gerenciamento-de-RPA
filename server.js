const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3000;

const users = require('./users.json');
const estabelecimentos = require('./estabelecimentos.json');

// cooldown por usuário
const cooldownUsuarios = new Map();
const TEMPO_COOLDOWN = 10 * 60 * 1000; // 10 minutos

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'segredo-super-simples',
  resave: false,
  saveUninitialized: false
}));

// arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// middleware auth
function authMiddleware(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }

  next();
}

// raiz
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// login
app.post('/login', (req, res) => {

  const { username, password } = req.body;

  const user = users.find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    return res.redirect('/login.html?erro=1');
  }

  req.session.user = user;

  res.redirect('/dashboard');
});

// dashboard
app.get('/dashboard', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// logout
app.get('/logout', (req, res) => {

  req.session.destroy(() => {
    res.redirect('/login.html');
  });

});

// lista robôs
app.get('/robos', authMiddleware, (req, res) => {

  res.json([
    { id: 'inicio', nome: 'Selecione um robô' },
    { id: 'Despesas', nome: 'Relatório e Conferência de Despesas' },
    { id: 'Estoque', nome: 'Relatório para Conferência de Estoque' }
  ]);

});

// estabelecimentos
app.get('/estabelecimentos', authMiddleware, (req, res) => {
  res.json(estabelecimentos);
});

// executar robô
app.post('/executar', authMiddleware, async (req, res) => {

  let {
    robo,
    estabelecimentos,
    data_inicio,
    data_fim
  } = req.body;

  const userId = req.session.user.username;

  // validação
  if (
    !robo ||
    !estabelecimentos ||
    estabelecimentos.length === 0 ||
    !data_inicio ||
    !data_fim ||
    robo === 'inicio'
  ) {

    return res.status(400).json({
      erro: 'Campos obrigatórios faltando'
    });

  }

  // verifica cooldown
  const ultimoUso = cooldownUsuarios.get(userId);

  if (ultimoUso) {

    const tempoPassado = Date.now() - ultimoUso;

    if (tempoPassado < TEMPO_COOLDOWN) {

      const restanteMs = TEMPO_COOLDOWN - tempoPassado;

      const minutos = Math.ceil(restanteMs / 60000);

      return res.status(429).json({
        erro: `Aguarde ${minutos} minuto(s) para executar novamente`,
        restanteMs
      });

    }

  }

  // formatar datas
  data_inicio = data_inicio.split('-').reverse().join('/');
  data_fim = data_fim.split('-').reverse().join('/');

  console.log('Executando robô:', {
    usuario: userId,
    robo,
    estabelecimentos,
    data_inicio,
    data_fim
  });

  // token por robô
  let token;

  if (robo === 'Despesas') {

    token = process.env.TOKEN_DESPESAS;

  } else if (robo === 'Estoque') {

    token = process.env.TOKEN_ESTOQUE;

  } else {

    return res.status(400).json({
      erro: 'Robô inválido'
    });

  }

  try {

    const estabelecimentosTexto = estabelecimentos.join(',');

    // dispara execução
    const startResponse = await axios.post(
      process.env.ENDPOINT,
      {
        estabelecimentos: estabelecimentosTexto,
        data_inicio,
        data_fim
      },
      {
        headers: {
          'x-roberty-token': token,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // registra cooldown
    cooldownUsuarios.set(userId, Date.now());

    console.log('Robô iniciado com sucesso:', {
      usuario: userId,
      webhookCallId: startResponse.data.webhookCallId
    });

    return res.json({
      ok: true,
      mensagem: 'Robô iniciado com sucesso',
      webhookCallId: startResponse.data.webhookCallId
    });

  } catch (err) {

    console.error('Erro ao executar robô:', {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data
    });

    return res.status(500).json({
      erro: 'Erro ao executar robô'
    });

  }

});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});