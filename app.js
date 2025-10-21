// 1. IMPORTAÇÕES E CONFIGURAÇÃO
require('dotenv').config(); // Carrega o .env (TEM QUE SER A PRIMEIRA LINHA)
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg'); // Importa o Pool do 'pg'

const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ------------------------------------------------------------------

// LISTA DE CATEGORIAS (Sem mudança)
const categoriasValidas = [
  "Frutas", "Verduras e Legumes", "Laticínios", "Carnes e Aves",
  "Peixes e Frutos do Mar", "Padaria", "Congelados", "Mercearia (Secos)",
  "Bebidas", "Limpeza", "Higiene Pessoal", "Outros"
];

// HELPER DE CORES (Sem mudança)
function getCategoryClass(categoria) {
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

// ------------------------------------------------------------------

// 2. CONEXÃO COM O BANCO DE DADOS (Refatorado para PG)
const db = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões Vercel/Supabase
  }
});

console.log('Conectado ao Vercel Postgres.');

// ------------------------------------------------------------------

// 3. CRIAÇÃO DA TABELA (Refatorado para PG)
// (MUDANÇA CRÍTICA: 'SERIAL PRIMARY KEY' é o 'AUTOINCREMENT' do Postgres)
const criarTabela = async () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS itens (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 1,
      categoria TEXT,
      comprado INTEGER DEFAULT 0 
    )
  `;
  try {
    await db.query(sql);
    console.log("Tabela 'itens' verificada/criada com sucesso.");
  } catch (err) {
    console.error("Erro ao criar tabela:", err.message);
  }
};
criarTabela(); // Roda a verificação da tabela ao iniciar o app

// ------------------------------------------------------------------

// 4. ROTAS (CRUD - Refatoradas com async/await)

/**
 * ROTA READ (GET /)
 * (Refatorado com async/await e db.query)
 */
app.get('/', async (req, res) => { // 1. Adiciona 'async'
  const sql = "SELECT * FROM itens ORDER BY comprado, categoria, nome";
  
  try { // 2. Adiciona 'try...catch'
    const result = await db.query(sql); // 3. Usa 'await db.query'
    const rows = result.rows; // 4. Os dados ficam em 'result.rows'

    // O resto da sua lógica é IDÊNTICO
    const pendentes = rows.filter(item => item.comprado === 0);
    const comprados = rows.filter(item => item.comprado === 1);

    pendentes.forEach(item => item.colorClass = getCategoryClass(item.categoria));
    comprados.forEach(item => item.colorClass = getCategoryClass(item.categoria));

    res.render('index.ejs', { 
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
 * (Refatorado com async/await e placeholders $1, $2)
 */
app.post('/add', async (req, res) => { // 1. Adiciona 'async'
  const { nome, quantidade, categoria } = req.body;

  if (!nome || !quantidade || !categoria || !categoriasValidas.includes(categoria)) {
      return res.redirect('/'); 
  }

  // 2. (MUDANÇA CRÍTICA) Postgres usa $1, $2, $3 em vez de ?
  const sql = "INSERT INTO itens (nome, quantidade, categoria) VALUES ($1, $2, $3)";
  
  try { // 3. Adiciona 'try...catch'
    await db.query(sql, [nome, quantidade, categoria]); // 4. Usa 'await db.query'
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao adicionar item.");
  }
});

/**
 * ROTA UPDATE (POST /update/:id)
 * (Refatorado com async/await e placeholder $1)
 */
app.post('/update/:id', async (req, res) => { // 1. Adiciona 'async'
  const id = req.params.id;
  const action = req.query.action; 

  let sql;
  
  // 2. (MUDANÇA CRÍTICA) Postgres usa $1 em vez de ?
  if (action === 'increase') {
    sql = "UPDATE itens SET quantidade = quantidade + 1 WHERE id = $1";
} else if (action === 'decrease') {
    sql = "UPDATE itens SET quantidade = GREATEST(1, quantidade - 1) WHERE id = $1";
  } else {
    return res.redirect('/');
  }

  try { // 3. Adiciona 'try...catch'
    await db.query(sql, [id]); // 4. Usa 'await db.query'
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Erro ao atualizar item.");
  }
});

/**
 * ROTA TOGGLE (POST /toggle/:id)
 * (Refatorado com async/await e placeholder $1)
 */
app.post('/toggle/:id', async (req, res) => { // 1. Adiciona 'async'
  const id = req.params.id;
  
  // 2. (MUDANÇA CRÍTICA) Postgres usa $1 em vez de ?
  const sql = "UPDATE itens SET comprado = CASE WHEN comprado = 0 THEN 1 ELSE 0 END WHERE id = $1";

  try { // 3. Adiciona 'try...catch'
    await db.query(sql, [id]); // 4. Usa 'await db.query'
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Erro ao atualizar status do item.");
  }
});

/**
 * ROTA DELETE (POST /delete/:id)
 * (Refatorado com async/await e placeholder $1)
 */
app.post('/delete/:id', async (req, res) => { // 1. Adiciona 'async'
  const id = req.params.id;
  
  // 2. (MUDANÇA CRÍTICA) Postgres usa $1 em vez de ?
  const sql = "DELETE FROM itens WHERE id = $1";

  try { // 3. Adiciona 'try...catch'
    await db.query(sql, [id]); // 4. Usa 'await db.query'
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Erro ao deletar item.");
  }
});

// ------------------------------------------------------------------

// 5. INICIAR O SERVIDOR (Sem mudança)
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);

});
