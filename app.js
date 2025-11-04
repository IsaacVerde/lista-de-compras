// 1. IMPORTAÇÕES E CONFIGURAÇÃO
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const flash = require('connect-flash'); // <-- PACOTE NOVO
const saltRounds = 10;

const app = express();
app.enable('trust proxy');
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ------------------------------------------------------------------
//           CONFIGURAÇÃO DE SESSÃO E PASSPORT
// ------------------------------------------------------------------

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(flash()); // <-- USA O connect-flash

app.use(passport.initialize());
app.use(passport.session());

// ------------------------------------------------------------------
//           CONFIGURAÇÃO DO BANCO DE DADOS
// ------------------------------------------------------------------

const db = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

console.log('Conectado ao Vercel Postgres.');

// 3. CRIAÇÃO DAS TABELAS (Verifica ao iniciar)
const criarTabelas = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        password TEXT,
        googleId TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS itens (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        quantidade INTEGER NOT NULL DEFAULT 1,
        categoria TEXT,
        comprado INTEGER DEFAULT 0,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("Tabelas 'users' e 'itens' verificadas/criadas com sucesso.");
  } catch (err) {
    console.error("Erro ao criar tabelas:", err.message);
  }
};
criarTabelas();

// ------------------------------------------------------------------
//           LÓGICA DO PASSPORT (Estratégias)
// ------------------------------------------------------------------

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return done(null, false, { message: 'Email não encontrado.' });
    }
    const user = result.rows[0];
    if (!user.password) {
      return done(null, false, { message: 'Este email foi registado com o Google.' });
    }
    
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) throw err;
      if (isMatch) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Email ou senha incorretos.' }); // Mensagem genérica
      }
    });
  } catch (err) {
    return done(err);
  }
}));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const result = await db.query("SELECT * FROM users WHERE googleId = $1", [profile.id]);
      if (result.rows.length > 0) {
        return done(null, result.rows[0]);
      } else {
        const emailResult = await db.query("SELECT * FROM users WHERE email = $1", [profile.emails[0].value]);
        if (emailResult.rows.length > 0) {
          const updatedUser = await db.query("UPDATE users SET googleId = $1 WHERE email = $2 RETURNING *", [profile.id, profile.emails[0].value]);
          return done(null, updatedUser.rows[0]);
        } else {
          const newUserResult = await db.query(
            "INSERT INTO users (email, googleId) VALUES ($1, $2) RETURNING *",
            [profile.emails[0].value, profile.id]
          );
          return done(null, newUserResult.rows[0]);
        }
      }
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

// ------------------------------------------------------------------
//           ROTAS DE AUTENTICAÇÃO (Atualizadas)
// ------------------------------------------------------------------

// A rota GET /login foi REMOVIDA.

// A página de registo continua separada (é mais limpo)
app.get('/register', (req, res) => {
  res.render('register.ejs');
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (checkResult.rows.length > 0) {
      return res.redirect('/register'); // Idealmente com flash message
    }
    
    bcrypt.hash(password, saltRounds, async (err, hash) => {
      if (err) throw err;
      const result = await db.query(
        "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
        [email, hash]
      );
      const user = result.rows[0];
      req.login(user, (err) => { // Faz o login automático após o registo
        if (err) return next(err);
        res.redirect('/');
      });
    });
  } catch (err) {
    console.error(err);
    res.redirect('/register');
  }
});

// POST /login agora redireciona para '/' em caso de falha
app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/', // <-- Redireciona para a home
  failureFlash: true    // <-- Ativa a mensagem de erro
}));

// GET /logout agora redireciona para '/'
app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// Rotas do Google
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback', 
  passport.authenticate('google', {
    successRedirect: '/',
    failureRedirect: '/' // <-- Redireciona para a home
  })
);

// ------------------------------------------------------------------
//           ROTAS DO APP
// ------------------------------------------------------------------

// Objeto de Categorias e Subcategorias
const categorias = {
  "Hortifruti": ["Frutas", "Verduras", "Legumes"],
  "Carnes e Peixes": ["Carne Bovina", "Aves", "Carne Suína", "Peixes", "Frutos do Mar"],
  "Laticínios e Frios": ["Leite", "Queijos", "Iogurtes", "Manteiga", "Presunto", "Ovos"],
  "Padaria": ["Pães", "Bolos", "Biscoitos"],
  "Mercearia": ["Arroz", "Feijão", "Massas", "Óleos", "Temperos", "Molhos", "Enlatados"],
  "Congelados": ["Pratos Prontos", "Salgados", "Polpas de Fruta", "Sorvetes"],
  "Bebidas": ["Água", "Sucos", "Refrigerantes", "Cervejas", "Vinhos"],
  "Limpeza": ["Sabão em Pó", "Detergente", "Desinfetante", "Água Sanitária"],
  "Higiene Pessoal": ["Shampoo", "Condicionador", "Sabonete", "Papel Higiênico"],
  "Utilitários": ["Papel Toalha", "Filtro de Café", "Sacos de Lixo"],
  "Outros": ["Outros"]
};

// Mapeamento de cores
const categoriasCores = {
  "Frutas": "cat-frutas", "Verduras": "cat-verduras", "Legumes": "cat-verduras",
  "Carne Bovina": "cat-carnes", "Aves": "cat-carnes", "Carne Suína": "cat-carnes", "Peixes": "cat-peixes", "Frutos do Mar": "cat-peixes",
  "Leite": "cat-laticinios", "Queijos": "cat-laticinios", "Iogurtes": "cat-laticinios", "Manteiga": "cat-laticinios", "Presunto": "cat-laticinios", "Ovos": "cat-laticinios",
  "Pães": "cat-padaria", "Bolos": "cat-padaria", "Biscoitos": "cat-padaria",
  "Arroz": "cat-mercearia", "Feijão": "cat-mercearia", "Massas": "cat-mercearia", "Óleos": "cat-mercearia", "Temperos": "cat-mercearia", "Molhos": "cat-mercearia", "Enlatados": "cat-mercearia",
  "Pratos Prontos": "cat-congelados", "Salgados": "cat-congelados", "Polpas de Fruta": "cat-congelados", "Sorvetes": "cat-congelados",
  "Água": "cat-bebidas", "Sucos": "cat-bebidas", "Refrigerantes": "cat-bebidas", "Cervejas": "cat-bebidas", "Vinhos": "cat-bebidas",
  "Sabão em Pó": "cat-limpeza", "Detergente": "cat-limpeza", "Desinfetante": "cat-limpeza", "Água Sanitária": "cat-limpeza",
  "Shampoo": "cat-higiene", "Condicionador": "cat-higiene", "Sabonete": "cat-higiene", "Papel Higiênico": "cat-higiene",
  "Papel Toalha": "cat-utilitarios", "Filtro de Café": "cat-utilitarios", "Sacos de Lixo": "cat-utilitarios",
  "Outros": "cat-outros"
};

// Função de helper de cor
function getCategoryClass(categoria) {
  return categoriasCores[categoria] || 'cat-outros';
}

// Helper para validar a categoria
function isCategoriaValida(categoriaRecebida) {
  for (const grupo in categorias) {
    if (categorias[grupo].includes(categoriaRecebida)) {
      return true;
    }
  }
  return false;
}

// Middleware de proteção para ações (POST, UPDATE, DELETE)
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/'); // Se não estiver logado, volta para a home
}

/**
 * ROTA READ (GET /)
 * (Agora é pública e decide o que mostrar)
 */
app.get('/', async (req, res) => {
  let itensPendentes = [];
  let itensComprados = [];
  let countPendentes = 0;
  let countComprados = 0;
  
  // Só procura itens SE o utilizador estiver logado
  if (req.isAuthenticated()) {
    const userId = req.user.id;
    const sql = "SELECT * FROM itens WHERE user_id = $1 ORDER BY comprado, categoria, nome";
    
    try {
      const result = await db.query(sql, [userId]);
      const rows = result.rows;

      const pendentes = rows.filter(item => item.comprado === 0);
      const comprados = rows.filter(item => item.comprado === 1);

      pendentes.forEach(item => item.colorClass = getCategoryClass(item.categoria));
      comprados.forEach(item => item.colorClass = getCategoryClass(item.categoria));

      itensPendentes = pendentes;
      itensComprados = comprados;
      countPendentes = pendentes.length;
      countComprados = comprados.length;

    } catch (err) {
      console.error(err.message);
      return res.status(500).send("Erro ao consultar o banco de dados.");
    }
  }

  // Renderiza a página para TODOS
  res.render('index.ejs', { 
    user: req.user, // Estará 'undefined' se não estiver logado
    itensPendentes: itensPendentes,
    itensComprados: itensComprados,
    countPendentes: countPendentes,
    countComprados: countComprados,
    listaDeCategorias: categorias,
    loginError: req.flash('error') // Passa a mensagem de erro do login
  });
});

/**
 * ROTAS DE AÇÃO (protegidas)
 */
app.post('/add', ensureAuthenticated, async (req, res) => {
  const { nome, quantidade, categoria } = req.body;
  const userId = req.user.id;

  if (!nome || !quantidade || !categoria || !isCategoriaValida(categoria)) {
      return res.redirect('/'); 
  }

  const sql = "INSERT INTO itens (nome, quantidade, categoria, user_id) VALUES ($1, $2, $3, $4)";
  
  try {
    await db.query(sql, [nome, quantidade, categoria, userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Erro ao adicionar item.");
  }
});

app.post('/update/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const action = req.query.action;
  const userId = req.user.id;

  let sql;
  
  if (action === 'increase') {
    sql = "UPDATE itens SET quantidade = quantidade + 1 WHERE id = $1 AND user_id = $2";
  } else if (action === 'decrease') {
    
    // --- A CORREÇÃO ESTÁ AQUI ---
    // Trocámos MAX(1, ...) por GREATEST(1, ...)
    sql = "UPDATE itens SET quantidade = GREATEST(1, quantidade - 1) WHERE id = $1 AND user_id = $2";
    // ----------------------------

  } else {
    return res.redirect('/');
  }

  try {
    await db.query(sql, [id, userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Erro ao atualizar item.");
  }
});

app.post('/toggle/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const userId = req.user.id;
  
  const sql = "UPDATE itens SET comprado = CASE WHEN comprado = 0 THEN 1 ELSE 0 END WHERE id = $1 AND user_id = $2";

  try {
    await db.query(sql, [id, userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao atualizar status do item.");
  }
});

app.post('/delete/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const userId = req.user.id;
  
  const sql = "DELETE FROM itens WHERE id = $1 AND user_id = $2";

  try {
    await db.query(sql, [id, userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Erro ao deletar item.");
  }
});

// ------------------------------------------------------------------

// 5. INICIAR O SERVIDOR
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});