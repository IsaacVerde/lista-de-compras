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

// Estratégia Local (Email/Senha)
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
        return done(null, false, { message: 'Senha incorreta.' });
      }
    });
  } catch (err) {
    return done(err);
  }
}));

// Estratégia do Google
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
        // Verifica se o email já existe (de um login local)
        const emailResult = await db.query("SELECT * FROM users WHERE email = $1", [profile.emails[0].value]);
        if (emailResult.rows.length > 0) {
          // Se sim, apenas liga o googleId a essa conta
          const updatedUser = await db.query("UPDATE users SET googleId = $1 WHERE email = $2 RETURNING *", [profile.id, profile.emails[0].value]);
          return done(null, updatedUser.rows[0]);
        } else {
          // Senão, cria um usuário novo
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

// Salva o ID do usuário na sessão
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Recupera os dados do usuário a partir do ID na sessão
passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

// ------------------------------------------------------------------
//           ROTAS DE AUTENTICAÇÃO
// ------------------------------------------------------------------

app.get('/login', (req, res) => {
  res.render('login.ejs');
});

app.get('/register', (req, res) => {
  res.render('register.ejs');
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (checkResult.rows.length > 0) {
      return res.redirect('/register'); // Idealmente, com uma mensagem de erro
    }
    
    bcrypt.hash(password, saltRounds, async (err, hash) => {
      if (err) throw err;
      const result = await db.query(
        "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
        [email, hash]
      );
      const user = result.rows[0];
      req.login(user, (err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    });
  } catch (err) {
    console.error(err);
    res.redirect('/register');
  }
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login'
}));

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect('/login');
  });
});

// Rotas do Google
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback', 
  passport.authenticate('google', {
    successRedirect: '/',
    failureRedirect: '/login'
  })
);

// ------------------------------------------------------------------
//           ROTAS DO APP (PROTEGIDAS E REATORADAS)
// ------------------------------------------------------------------

// (Helpers de Categorias)
const categoriasValidas = [
  "Frutas", "Verduras e Legumes", "Laticínios", "Carnes e Aves",
  "Peixes e Frutos do Mar", "Padaria", "Congelados", "Mercearia (Secos)",
  "Bebidas", "Limpeza", "Higiene Pessoal", "Outros"
];
function getCategoryClass(categoria) {
  // (Esta função é a mesma que você já tinha)
   switch(categoria) {
    case 'Frutas': return 'cat-frutas';
    case 'Verduras e Legumes': return 'cat-verduras';
    case 'Laticínios': return 'cat-laticinios';
    case 'Carnes e Aves': return 'cat-carnes';
    case 'Peixes e Frutos do Mar': return 'cat-peixes';
    case 'Padaria': return 'cat-padaria';
    case 'Congelados': return 'cat-congelados';
    case 'Mercearia (Secos)': return 'cat-mercearia';
    case 'Bebidas': return 'cat-bebidas';
    case 'Limpeza': return 'cat-limpeza';
    case 'Higiene Pessoal': return 'cat-higiene';
    default: return 'cat-outros';
  }
}

// Middleware de proteção
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

/**
 * ROTA READ (GET /)
 * (Refatorado para Autenticação)
 */
app.get('/', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const sql = "SELECT * FROM itens WHERE user_id = $1 ORDER BY comprado, categoria, nome";
  
  try {
    const result = await db.query(sql, [userId]);
    const rows = result.rows;

    const pendentes = rows.filter(item => item.comprado === 0);
    const comprados = rows.filter(item => item.comprado === 1);

    pendentes.forEach(item => item.colorClass = getCategoryClass(item.categoria));
    comprados.forEach(item => item.colorClass = getCategoryClass(item.categoria));

    res.render('index.ejs', { 
      user: req.user,
      itensPendentes: pendentes,
      itensComprados: comprados,
      countPendentes: pendentes.length,
      countComprados: comprados.length,
      listaDeCategorias: categoriasValidas
    });

  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao consultar o banco de dados.");
  }
});

/**
 * ROTA CREATE (POST /add)
 * (Refatorado para Autenticação)
 */
app.post('/add', ensureAuthenticated, async (req, res) => {
  const { nome, quantidade, categoria } = req.body;
  const userId = req.user.id; // Pega o ID do usuário logado

  if (!nome || !quantidade || !categoria || !categoriasValidas.includes(categoria)) {
      return res.redirect('/'); 
  }

  // Adiciona user_id à query
  const sql = "INSERT INTO itens (nome, quantidade, categoria, user_id) VALUES ($1, $2, $3, $4)";
  
  try {
    await db.query(sql, [nome, quantidade, categoria, userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao adicionar item.");
  }
});

/**
 * ROTA UPDATE (POST /update/:id)
 * (Refatorado para Autenticação)
 */
app.post('/update/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const action = req.query.action;
  const userId = req.user.id;

  let sql;
  
  // Adiciona AND user_id = $2 para segurança
  if (action === 'increase') {
    sql = "UPDATE itens SET quantidade = quantidade + 1 WHERE id = $1 AND user_id = $2";
  } else if (action === 'decrease') {
    sql = "UPDATE itens SET quantidade = MAX(1, quantidade - 1) WHERE id = $1 AND user_id = $2";
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

/**
 * ROTA TOGGLE (POST /toggle/:id)
 * (Refatorado para Autenticação)
 */
app.post('/toggle/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const userId = req.user.id;
  
  // Adiciona AND user_id = $2 para segurança
  const sql = "UPDATE itens SET comprado = CASE WHEN comprado = 0 THEN 1 ELSE 0 END WHERE id = $1 AND user_id = $2";

  try {
    await db.query(sql, [id, userId]);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao atualizar status do item.");
  }
});

/**
 * ROTA DELETE (POST /delete/:id)
 * (Refatorado para Autenticação)
 */
app.post('/delete/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const userId = req.user.id;
  
  // Adiciona AND user_id = $2 para segurança
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