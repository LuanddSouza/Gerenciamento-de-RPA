const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');

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

// DASHBOARD protegido
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

// EXECUTAR ROBÔ
app.post('/executar', authMiddleware, async (req, res) => {
  const { robo, estabelecimento, data_inicio, data_fim } = req.body;

  if (!robo || !estabelecimento || !data_inicio || !data_fim) {
    return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  }

  console.log('Executando robô:', {
    usuario: req.session.user.username,
    robo,
    estabelecimento,
    data_inicio,
    data_fim
  });

  let token;

  if (robo === 'Despesas') {
    token = process.env.TOKEN_DESPESAS;
  } else if (robo === 'Estoque') {
    token = process.env.TOKEN_ESTOQUE;

    try {
      await axios.post(
        process.env.ENDPOINT,
        {
          estabelecimento,
          data_inicio,
          data_fim
        },
        {
          headers: {
            'x_roberty_token': process.env.TOKEN_DESPESAS,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      res.json({
        ok: true,
        mensagem: 'Robô executado com sucesso'
      });

    } catch (err) {
      console.error('Erro:', err.message);
    }

    res.status(500).json({
      erro: 'Erro ao executar robô'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});