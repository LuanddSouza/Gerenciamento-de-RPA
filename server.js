const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3000;
const execucoesAtivas = new Map();
const users = require('./users.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'segredo-super-simples',
  resave: false,
  saveUninitialized: true
}));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

// ROTAS
// Redireciona raiz
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// LOGIN
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = users.find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    return res.status(401).send('Login inválido');
  }

  req.session.user = user;

  res.redirect('/dashboard');
});

// DASHBOARD
app.get('/dashboard', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// LOGOUT
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// LISTA DE ROBÔS (mock)
app.get('/robos', authMiddleware, (req, res) => {
  res.json([
    {id: 'inicio', nome: 'Selecione um robô'},
    { id: 'Despesas', nome: 'Relatório e Conferência de Despesas' },
    { id: 'Estoque', nome: 'Relatório para Conferênciia de Estoque' }
  ]);
});

const estabelecimentos = require('./estabelecimentos.json');

app.get('/estabelecimentos', authMiddleware, (req, res) => {
  res.json(estabelecimentos);
});

//esperar robo terminar execução
async function esperarExecucao(webhookCallId) {
  const url = `https://api.roberty.app/prod/1/customer/robot/webhookResponse/${webhookCallId}`;

  let tentativas = 0;
  const maxTentativas = 1000; // (10s cada)

  while (tentativas < maxTentativas) {
    try {
      const response = await axios.get(url);

      const status = response.data?.status;

      if (status === 'DONE') {
        console.log('Robô finalizado com sucesso:', response.data);
        return {
          status: 'DONE',
          data: response.data
        };

      }

    } catch (err) {
      console.error('Erro ao consultar status:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data
      });

    }

    tentativas++;

    // espera 10 segundos
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  return {
    status: 'PROCESSANDO',
    webhookCallId
  };
}

//verifica status de execução do robô para o usuário
app.get('/status', authMiddleware, (req, res) => {
  const userId = req.session.user.username;

  res.json({
    executando: execucoesAtivas.get(userId) || false
  });
});


// EXECUTAR ROBÔ
app.post('/executar', authMiddleware, async (req, res) => {
  let { robo, estabelecimentos, data_inicio, data_fim } = req.body;
  const userId = req.session.user.username;

  if (!robo || !estabelecimentos || estabelecimentos.length === 0 || !data_inicio || !data_fim || robo == 'inicio') {
    return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  }

  if (execucoesAtivas.get(userId)) {
    return res.status(429).json({
      erro: 'Já existe um robô em execução para este usuário'
    });
  }

  data_inicio = data_inicio.split('-').reverse().join('/');
  data_fim = data_fim.split('-').reverse().join('/');

  console.log('Executando robô:', {
    usuario: req.session.user.username,
    robo,
    estabelecimentos,
    data_inicio,
    data_fim
  });

  // Escolhe token baseado no robô
  let token;
  console.log('ENDPOINT:', process.env.ENDPOINT);
  if (robo === 'Despesas') {
    token = process.env.TOKEN_DESPESAS;
  } else if (robo === 'Estoque') {
    token = process.env.TOKEN_ESTOQUE;
  } else {
    return res.status(400).json({ erro: 'Robô inválido' });
  }

  try {

    execucoesAtivas.set(userId, true);
    const estabelecimentosTexto = estabelecimentos.join(',');
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

    const webhookCallId = startResponse.data.webhookCallId;
    const resultado = await esperarExecucao(webhookCallId);

    return res.json({
      ok: true,
      resultado: resultado.data,
      status: resultado.status,
    });

  } catch (err) {
    console.error('Erro ao executar robô:', err.message);

    return res.status(500).json({
      erro: 'Erro ao executar robô'
    });
  } finally {
    execucoesAtivas.delete(userId);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});