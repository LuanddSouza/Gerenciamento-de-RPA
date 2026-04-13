const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3000;

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
    { id: 'Despesas', nome: 'Relatório e Conferência de Despesas' },
    { id: 'Estoque', nome: 'Relatório para Conferênciia de Estoque' }
  ]);
});

// LISTA DE ESTABELECIMENTOS (mock)
app.get('/estabelecimentos', authMiddleware, (req, res) => {
  res.json([
    { "id": 3, "nome": "NUTREPAMPA CEREALISTA" },
    { "id": 1, "nome": "NUTREPAMPA MATRIZ" },
    { "id": 5, "nome": "JOST - PROVEMIX" },
    { "id": 6, "nome": "NUTREPAMPA TEUTÔNIA" },
    { "id": 7, "nome": "NUTREPAMPA SANTA CATARINA" },
    { "id": 8, "nome": "NUTREPAMPA MT" },
    { "id": 500, "nome": "EEM PARTICIPACOES LTDA" },
    { "id": 700, "nome": "PROVEMIX - RS" },
    { "id": 800, "nome": "PROVEMIX CANDEIAS DO JAMARI" },
    { "id": 801, "nome": "CENTRO DISTRIBUIÇÃO PROVEMIX" },
    { "id": 802, "nome": "PROVEMIX VILHENA" },
    { "id": 900, "nome": "BELA UNIÃO INVESTIMENTOS" },
    { "id": 1000, "nome": "CONFINAMENTO JEF" },
    { "id": 1001, "nome": "PRODUTOR RURAL CONFINAMENTO" }
  ]
  );
});

//esperar robo terminar execução
async function esperarExecucao(webhookCallId) {
  const url = `https://api.roberty.app/prod/1/customer/robot/webhookResponse/${webhookCallId}`;

  let tentativas = 0;
  const maxTentativas = 40; // (8s cada)

  while (tentativas < maxTentativas) {
    try {
      const response = await axios.get(url);

      const status = response.data?.status;
      console.log(`Tentativa ${tentativas + 1}:`, status);

      if (status === 'DONE') {
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

    // espera 8 segundos
    await new Promise(resolve => setTimeout(resolve, 8000));
  }

  return {
    status: 'PROCESSANDO',
    webhookCallId
  };
}


// EXECUTAR ROBÔ
app.post('/executar', authMiddleware, async (req, res) => {
  let { robo, estabelecimento, data_inicio, data_fim } = req.body;

  if (!robo || !estabelecimento || !data_inicio || !data_fim) {
    return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  }
  console.log('Data antes da formatação: ', { data_inicio, data_fim });
  data_inicio = data_inicio.split('-').reverse().join('/');
  data_fim = data_fim.split('-').reverse().join('/');

  console.log('Executando robô:', {
    usuario: req.session.user.username,
    robo,
    estabelecimento,
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
    const startResponse = await axios.post(
      process.env.ENDPOINT,
      {
        estabelecimento,
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
      resultado: resultado.response,
      status: resultado.status,
    });

  } catch (err) {
    console.error('Erro ao executar robô:', err.message);

    return res.status(500).json({
      erro: 'Erro ao executar robô'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});