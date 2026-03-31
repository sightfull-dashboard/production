import Database from 'better-sqlite3';

const db = new Database('veridian.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    emp_id TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    dob TEXT NOT NULL,
    job_title TEXT NOT NULL,
    department TEXT NOT NULL,
    pay_rate REAL NOT NULL,
    email TEXT,
    cell TEXT,
    id_number TEXT,
    passport TEXT,
    bank_name TEXT,
    account_no TEXT,
    tax_number TEXT,
    ismibco TEXT,
    isunion TEXT,
    address1 TEXT,
    address2 TEXT,
    address3 TEXT,
    address4 TEXT,
    postal_code TEXT,
    paye_credit TEXT,
    annual_leave REAL DEFAULT 0,
    sick_leave REAL DEFAULT 0,
    family_leave REAL DEFAULT 0,
    last_worked TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('Employees table created successfully.');
db.close();
