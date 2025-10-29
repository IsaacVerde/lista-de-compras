// 1. IMPORTAÇÕES E CONFIGURAÇÃO (igual)
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
app.enable('trust proxy'); // <- ESSENCIAL PARA O GOOGLE/VERCEL
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ------------------------------------------------------------------
//           CONFIGURAÇÃO DE SESSÃO E PASSPORT (igual)
// ------------------------------------------------------------------

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// ------------------------------------------------------------------
//           CONFIGURAÇÃO DO BANCO DE DADOS (igual)
// ------------------------------------------------------------------

const db = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

console.log('Conectado ao Vercel Postgres.');

// 3. CRIAÇÃO DAS TABELAS (igual)
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
//           LÓGICA DO PASSPORT (Estratégias) (igual)
// ------------------------------------------------------------------

// (Cole aqui toda a sua lógica do passport.use(LocalStrategy), passport.use(GoogleStrategy), serializeUser, deserializeUser)
// ...
// (É exatamente igual ao arquivo anterior, não muda nada)

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
//           ROTAS DE AUTENTICAÇÃO (igual)
// ------------------------------------------------------------------

// (Cole aqui todas as suas rotas GET /login, POST /login, GET /register, POST /register, GET /logout, GET /auth/google, GET /auth/google/callback)
// ...
// (É exatamente igual ao arquivo anterior, não muda nada)

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
      return res.redirect('/register');
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
//           ROTAS DO APP (COM NOVAS CATEGORIAS)
// ------------------------------------------------------------------

// (NOVO) Objeto de Categorias e Subcategorias
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

// (NOVO) Mapeamento de cores (a CHAVE é a subcategoria exata)
const categoriasCores = {
  // Hortifruti
  "Frutas": "cat-frutas",
  "Verduras": "cat-verduras",
  "Legumes": "cat-verduras",
  // Carnes
  "Carne Bovina": "cat-carnes",
  "Aves": "cat-carnes",
  "Carne Suína": "cat-carnes",
  "Peixes": "cat-peixes",
  "Frutos do Mar": "cat-peixes",
  // Laticínios
  "Leite": "cat-laticinios",
  "Queijos": "cat-laticinios",
  "Iogurtes": "cat-laticinios",
  "Manteiga": "cat-laticinios",
  "Presunto": "cat-laticinios",
  "Ovos": "cat-laticinios",
  // Padaria
  "Pães": "cat-padaria",
  "Bolos": "cat-padaria",
  "Biscoitos": "cat-padaria",
  // Mercearia
  "Arroz": "cat-mercearia",
  "Feijão": "cat-mercearia",
  "Massas": "cat-mercearia",
  "Óleos": "cat-mercearia",
  "Temperos": "cat-mercearia",
  "Molhos": "cat-mercearia",
  "Enlatados": "cat-mercearia",
  // Congelados
  "Pratos Prontos": "cat-congelados",
  "Salgados": "cat-congelados",
  "Polpas de Fruta": "cat-congelados",
  "Sorvetes": "cat-congelados",
  // Bebidas
  "Água": "cat-bebidas",
  "Sucos": "cat-bebidas",
  "Refrigerantes": "cat-bebidas",
  "Cervejas": "cat-bebidas",
  "Vinhos": "cat-bebidas",
  // Limpeza
  "Sabão em Pó": "cat-limpeza",
  "Detergente": "cat-limpeza",
  "Desinfetante": "cat-limpeza",
  "Água Sanitária": "cat-limpeza",
  // Higiene
  "Shampoo": "cat-higiene",
  "Condicionador": "cat-higiene",
  "Sabonete": "cat-higiene",
  "Papel Higiênico": "cat-higiene",
  // Utilitários
  "Papel Toalha": "cat-utilitarios",
  "Filtro de Café": "cat-utilitarios",
  "Sacos de Lixo": "cat-utilitarios",
  // Outros
  "Outros": "cat-outros"
};

// (NOVO) Função de helper atualizada
function getCategoryClass(categoria) {
  return categoriasCores[categoria] || 'cat-outros';
}

// (NOVO) Helper para validar a categoria
function isCategoriaValida(categoriaRecebida) {
  for (const grupo in categorias) {
    if (categorias[grupo].includes(categoriaRecebida)) {
      return true;
    }
  }
  return false;
}

// Middleware de proteção (igual)
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

/**
 * ROTA READ (GET /)
 * (Atualizada para enviar o novo objeto de categorias)
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
      listaDeCategorias: categorias // (MUDANÇA) Enviando o novo objeto
    });

  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao consultar o banco de dados.");
  }
});

/**
 * ROTA CREATE (POST /add)
 * (Atualizada para validar a nova categoria)
 */
app.post('/add', ensureAuthenticated, async (req, res) => {
  const { nome, quantidade, categoria } = req.body;
  const userId = req.user.id;

  if (!nome || !quantidade || !categoria || !isCategoriaValida(categoria)) {
      console.log("Falha na validação do item:", req.body);
      return res.redirect('/'); 
  }

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
 * ROTAS UPDATE, TOGGLE, DELETE (iguais)
 */
// (Cole aqui suas rotas POST /update, POST /toggle, POST /delete)
// ...
// (São exatamente iguais ao arquivo anterior, não mudam nada)

app.post('/update/:id', ensureAuthenticated, async (req, res) => {
  const id = req.params.id;
  const action = req.query.action;
  const userId = req.user.id;

  let sql;
  
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

// 5. INICIAR O SERVIDOR (igual)
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});