const express = require('express');
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: true },
};

async function query(text) {
  const pool = await sql.connect(config);
  const result = await pool.request().query(text);
  return result.recordset;
}

const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const money = (value) => value.toFixed(2);
const date = (value) => value.toISOString().slice(0, 10);

const table = (headers, rows) => `
  <table>
    <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}
  </table>`;

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Online store</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #222; }
    nav { background: #2b5797; padding: 12px 24px; }
    nav a { color: #fff; margin-right: 20px; text-decoration: none; }
    main { padding: 8px 24px 24px; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #eef1f5; }
  </style>
</head>
<body>
  <nav>
    <a href="/"><b>Online store</b></a>
    <a href="/products">Products</a>
    <a href="/customers">Customers</a>
    <a href="/sales">Sales</a>
  </nav>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;

const app = express();

app.get('/', async (req, res) => {
  const [counts] = await query(`
    SELECT (SELECT COUNT(*) FROM Products) AS Products,
           (SELECT COUNT(*) FROM Customers) AS Customers,
           (SELECT COUNT(*) FROM Sales) AS Sales`);
  res.send(page('Overview', `
    <p>Connected to Azure SQL database <b>${esc(config.database)}</b> on <b>${esc(config.server)}</b>.</p>
    ${table(['Table', 'Rows'], [
      ['Products', counts.Products],
      ['Customers', counts.Customers],
      ['Sales', counts.Sales],
    ])}`));
});

app.get('/products', async (req, res) => {
  const products = await query('SELECT ProductCode, Name, Price, Unit FROM Products ORDER BY ProductCode');
  res.send(page('Products', table(
    ['Code', 'Name', 'Price, UAH', 'Unit'],
    products.map((p) => [p.ProductCode, p.Name, money(p.Price), p.Unit]),
  )));
});

app.get('/customers', async (req, res) => {
  const customers = await query(`
    SELECT CustomerCode, LastName, FirstName, Patronymic, Address, Phone, Email, RegularCustomer
    FROM Customers ORDER BY CustomerCode`);
  res.send(page('Customers', table(
    ['Code', 'Full name', 'Address', 'Phone', 'Email', 'Regular customer'],
    customers.map((c) => [
      c.CustomerCode,
      `${c.LastName} ${c.FirstName} ${c.Patronymic ?? ''}`,
      c.Address, c.Phone, c.Email,
      c.RegularCustomer ? 'Yes (2% discount)' : 'No',
    ]),
  )));
});

// Cost of purchases (task 3.2): price x quantity, regular customers get 2% off
app.get('/sales', async (req, res) => {
  const sales = await query(`
    SELECT s.SaleCode, s.SaleDate, s.DeliveryDate,
           c.LastName + N' ' + c.FirstName AS Customer,
           p.Name AS Product, s.Quantity, p.Unit, p.Price,
           CAST(s.Quantity * p.Price AS DECIMAL(12,2)) AS Cost,
           CASE WHEN c.RegularCustomer = 1 THEN 2 ELSE 0 END AS DiscountPct,
           CAST(s.Quantity * p.Price
                * CASE WHEN c.RegularCustomer = 1 THEN 0.98 ELSE 1 END AS DECIMAL(12,2)) AS CostWithDiscount
    FROM Sales AS s
    JOIN Products AS p ON p.ProductCode = s.ProductCode
    JOIN Customers AS c ON c.CustomerCode = s.CustomerCode
    ORDER BY s.SaleCode`);
  const total = sales.reduce((sum, s) => sum + s.CostWithDiscount, 0);
  res.send(page('Sales: cost of purchases', `
    ${table(
      ['Code', 'Sale date', 'Delivery date', 'Customer', 'Product', 'Quantity',
        'Price, UAH', 'Cost, UAH', 'Discount', 'To pay, UAH'],
      sales.map((s) => [
        s.SaleCode, date(s.SaleDate), date(s.DeliveryDate), s.Customer, s.Product,
        `${s.Quantity} ${s.Unit}`, money(s.Price), money(s.Cost), `${s.DiscountPct}%`,
        money(s.CostWithDiscount),
      ]),
    )}
    <p>Total to pay: <b>${money(total)} UAH</b></p>`));
});

app.use((err, req, res, next) => {
  console.error(err);
  // A paused serverless database fails the first connection while it resumes.
  res.status(500).send(page('Database error', `
    <p>${esc(err.message)}</p>
    <p>If the database was paused, it resumes in about a minute. Refresh the page.</p>`));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));
