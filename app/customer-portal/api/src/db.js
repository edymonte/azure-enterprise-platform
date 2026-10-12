'use strict';

// Azure SQL access WITHOUT passwords.
//
// In AKS the Workload Identity webhook injects AZURE_CLIENT_ID, AZURE_TENANT_ID
// and AZURE_FEDERATED_TOKEN_FILE. The 'azure-active-directory-default'
// authentication uses DefaultAzureCredential, which exchanges the Kubernetes
// service-account token for an Entra token -> SQL accepts it because the
// managed identity was created as a contained user (scripts/sql-grant-app-identity.ps1).
//
// Without SQL_SERVER (local dev / unit tests) an in-memory catalog is used.

const sql = require('mssql');

const MEMORY_PRODUCTS = [
  { id: 1, name: 'Digital Account', category: 'banking' },
  { id: 2, name: 'Platinum Card', category: 'cards' },
  { id: 3, name: 'Fixed Income Fund', category: 'investments' },
];

let poolPromise;

function mode() {
  return process.env.SQL_SERVER ? 'azure-sql' : 'in-memory';
}

function getPool() {
  if (!poolPromise) {
    poolPromise = sql
      .connect({
        server: process.env.SQL_SERVER,
        database: process.env.SQL_DATABASE || 'portal',
        authentication: {
          type: 'azure-active-directory-default',
          options: { clientId: process.env.AZURE_CLIENT_ID },
        },
        options: { encrypt: true },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
        connectionTimeout: 15000,
      })
      .then(async (pool) => {
        await ensureSchema(pool);
        return pool;
      })
      .catch((err) => {
        poolPromise = undefined; // retry on next call
        throw err;
      });
  }
  return poolPromise;
}

async function ensureSchema(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.products') IS NULL
    BEGIN
      CREATE TABLE dbo.products (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        category NVARCHAR(50) NOT NULL
      );
      INSERT INTO dbo.products (name, category) VALUES
        (N'Digital Account', N'banking'),
        (N'Platinum Card', N'cards'),
        (N'Fixed Income Fund', N'investments');
    END`);
}

async function ping() {
  if (mode() === 'in-memory') return;
  const pool = await getPool();
  await pool.request().query('SELECT 1 AS ok');
}

async function listProducts() {
  if (mode() === 'in-memory') return MEMORY_PRODUCTS;
  const pool = await getPool();
  const result = await pool.request().query('SELECT id, name, category FROM dbo.products ORDER BY id');
  return result.recordset;
}

module.exports = { mode, ping, listProducts };
