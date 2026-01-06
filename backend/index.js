const express = require("express");
const pool = require("./db");
require("dotenv").config();
const fs = require("fs");
const cors= require("cors");
const path = require("path");

/* =========================
   TEST MODE CONFIG
========================= */
const TEST_MODE = process.env.TEST_MODE === "true";
const TEST_PAYMENT_SUCCESS =
  process.env.TEST_PAYMENT_SUCCESS !== "false";
const TEST_PROCESSING_DELAY =
  parseInt(process.env.TEST_PROCESSING_DELAY || "1000", 10);

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   AUTH MIDDLEWARE
========================= */
async function authenticate(req, res, next) {
  const apiKey = req.header("X-Api-Key");
  const apiSecret = req.header("X-Api-Secret");

  if (!apiKey || !apiSecret) {
    return res.status(401).json({
      error: {
        code: "AUTHENTICATION_ERROR",
        description: "Invalid API credentials"
      }
    });
  }

  const { rows } = await pool.query(
    "SELECT * FROM merchants WHERE api_key=$1 AND api_secret=$2 AND is_active=true",
    [apiKey, apiSecret]
  );

  if (rows.length === 0) {
    return res.status(401).json({
      error: {
        code: "AUTHENTICATION_ERROR",
        description: "Invalid API credentials"
      }
    });
  }

  req.merchant = rows[0];
  next();
}

/* =========================
   HELPERS
========================= */
function randomId(prefix) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function isValidVPA(vpa) {
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(vpa);
}

function isValidCardNumber(cardNumber) {
  const num = cardNumber.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(num)) return false;

  let sum = 0;
  let double = false;

  for (let i = num.length - 1; i >= 0; i--) {
    let d = parseInt(num[i], 10);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }

  return sum % 10 === 0;
}

function detectCardNetwork(cardNumber) {
  const n = cardNumber.replace(/[\s-]/g, "");
  if (n.startsWith("4")) return "visa";
  if (/^5[1-5]/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  if (/^(60|65|8[1-9])/.test(n)) return "rupay";
  return "unknown";
}

function isValidExpiry(month, year) {
  const m = parseInt(month, 10);
  let y = parseInt(year, 10);
  if (isNaN(m) || m < 1 || m > 12) return false;
  if (year.length === 2) y += 2000;

  const now = new Date();
  return new Date(y, m) >= new Date(now.getFullYear(), now.getMonth());
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch {
    res.json({
      status: "healthy",
      database: "disconnected",
      timestamp: new Date().toISOString()
    });
  }
});

/* =========================
   CREATE ORDER
========================= */
app.post("/api/v1/orders", authenticate, async (req, res) => {
  const { amount, currency = "INR", receipt, notes } = req.body;

  if (!Number.isInteger(amount) || amount < 100) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "amount must be at least 100"
      }
    });
  }

  let orderId;
  while (true) {
    orderId = randomId("order_");
    const exists = await pool.query(
      "SELECT 1 FROM orders WHERE id=$1",
      [orderId]
    );
    if (exists.rows.length === 0) break;
  }

  const { rows } = await pool.query(
    `INSERT INTO orders (id, merchant_id, amount, currency, receipt, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [orderId, req.merchant.id, amount, currency, receipt || null, notes || null]
  );

  const o = rows[0];

  res.status(201).json({
    id: o.id,
    merchant_id: o.merchant_id,
    amount: o.amount,
    currency: o.currency,
    receipt: o.receipt,
    notes: o.notes,
    status: o.status,
    created_at: o.created_at
  });
});

/* =========================
   GET ORDER
========================= */
app.get("/api/v1/orders/:orderId", authenticate, async (req, res) => {
  const { orderId } = req.params;

  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE id=$1 AND merchant_id=$2",
    [orderId, req.merchant.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND_ERROR",
        description: "Order not found"
      }
    });
  }

  const o = rows[0];
  res.json({
    id: o.id,
    merchant_id: o.merchant_id,
    amount: o.amount,
    currency: o.currency,
    receipt: o.receipt,
    notes: o.notes,
    status: o.status,
    created_at: o.created_at,
    updated_at: o.updated_at
  });
});

/* =========================
   CREATE PAYMENT
========================= */
app.post("/api/v1/payments", authenticate, async (req, res) => {
  const { order_id, method } = req.body;

  const { rows: orders } = await pool.query(
    "SELECT * FROM orders WHERE id=$1 AND merchant_id=$2",
    [order_id, req.merchant.id]
  );

  if (orders.length === 0) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND_ERROR",
        description: "Order not found"
      }
    });
  }

  const order = orders[0];

  if (!["upi", "card"].includes(method)) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "Invalid payment method"
      }
    });
  }

  let paymentId;
  while (true) {
    paymentId = randomId("pay_");
    const exists = await pool.query(
      "SELECT 1 FROM payments WHERE id=$1",
      [paymentId]
    );
    if (exists.rows.length === 0) break;
  }

  let vpa = null;
  let card_network = null;
  let card_last4 = null;

  if (method === "upi") {
    if (!isValidVPA(req.body.vpa)) {
      return res.status(400).json({
        error: { code: "INVALID_VPA", description: "VPA format invalid" }
      });
    }
    vpa = req.body.vpa;
  }

  if (method === "card") {
    const c = req.body.card;
    if (
      !c ||
      !isValidCardNumber(c.number) ||
      !isValidExpiry(c.expiry_month, c.expiry_year)
    ) {
      return res.status(400).json({
        error: { code: "INVALID_CARD", description: "Card validation failed" }
      });
    }
    card_network = detectCardNetwork(c.number);
    card_last4 = c.number.slice(-4);
  }

  await pool.query(
    `INSERT INTO payments
     (id, order_id, merchant_id, amount, currency, method,
      status, vpa, card_network, card_last4)
     VALUES ($1,$2,$3,$4,$5,$6,'processing',$7,$8,$9)`,
    [
      paymentId,
      order.id,
      req.merchant.id,
      order.amount,
      order.currency,
      method,
      vpa,
      card_network,
      card_last4
    ]
  );

  const delay = TEST_MODE
    ? TEST_PROCESSING_DELAY
    : Math.floor(Math.random() * 5000) + 5000;

  await new Promise(r => setTimeout(r, delay));

  const success = TEST_MODE
    ? TEST_PAYMENT_SUCCESS
    : method === "upi"
    ? Math.random() < 0.9
    : Math.random() < 0.95;

  if (success) {
    await pool.query(
      "UPDATE payments SET status='success', updated_at=NOW() WHERE id=$1",
      [paymentId]
    );
  } else {
    await pool.query(
      `UPDATE payments
       SET status='failed',
           error_code='PAYMENT_FAILED',
           error_description='Payment processing failed',
           updated_at=NOW()
       WHERE id=$1`,
      [paymentId]
    );
  }

  res.status(201).json({
    id: paymentId,
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    method,
    status: success ? "success" : "failed",
    vpa,
    card_network,
    card_last4,
    created_at: new Date().toISOString()
  });
});

/* =========================
   START SERVER
========================= */
async function startServer() {
  try {
    const schema = fs.readFileSync(
      path.join(__dirname, "schema.sql")
    ).toString();
    await pool.query(schema);

    await pool.query(`
      INSERT INTO merchants (id, name, email, api_key, api_secret)
      VALUES (
        '550e8400-e29b-41d4-a716-446655440000',
        'Test Merchant',
        'test@example.com',
        'key_test_abc123',
        'secret_test_xyz789'
      )
      ON CONFLICT (email) DO NOTHING
    `);

    app.listen(8000, () =>
      console.log("API running on port 8000")
    );
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
}

/* =========================
   GET PAYMENT API
========================= */
app.get("/api/v1/payments/:paymentId", authenticate, async (req, res) => {
  const { paymentId } = req.params;

  const { rows } = await pool.query(
    "SELECT * FROM payments WHERE id=$1 AND merchant_id=$2",
    [paymentId, req.merchant.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND_ERROR",
        description: "Payment not found"
      }
    });
  }

  const p = rows[0];

  res.json({
    id: p.id,
    order_id: p.order_id,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    status: p.status,
    vpa: p.vpa,
    card_network: p.card_network,
    card_last4: p.card_last4,
    error_code: p.error_code,
    error_description: p.error_description,
    created_at: p.created_at,
    updated_at: p.updated_at
  });
});

/* =========================
   PUBLIC GET ORDER (CHECKOUT)
========================= */
app.get("/api/v1/orders/:orderId/public", async (req, res) => {
  const { orderId } = req.params;

  const { rows } = await pool.query(
    "SELECT id, amount, currency, status FROM orders WHERE id=$1",
    [orderId]
  );

  if (rows.length === 0) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND_ERROR",
        description: "Order not found"
      }
    });
  }

  res.json({
    id: rows[0].id,
    amount: rows[0].amount,
    currency: rows[0].currency,
    status: rows[0].status
  });
});
/* =========================
   PUBLIC CREATE PAYMENT (CHECKOUT)
========================= */
app.post("/api/v1/payments/public", async (req, res) => {
  const { order_id, method } = req.body;

  // 1️⃣ Validate order
  const { rows: orders } = await pool.query(
    `SELECT o.*, m.id AS merchant_id
     FROM orders o
     JOIN merchants m ON o.merchant_id = m.id
     WHERE o.id=$1`,
    [order_id]
  );

  if (orders.length === 0) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND_ERROR",
        description: "Order not found"
      }
    });
  }

  const order = orders[0];

  // 2️⃣ Validate method
  if (!["upi", "card"].includes(method)) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "Invalid payment method"
      }
    });
  }

  // 3️⃣ Generate payment ID
  let paymentId;
  while (true) {
    paymentId = randomId("pay_");
    const exists = await pool.query(
      "SELECT 1 FROM payments WHERE id=$1",
      [paymentId]
    );
    if (exists.rows.length === 0) break;
  }

  let vpa = null;
  let card_network = null;
  let card_last4 = null;

  // 4️⃣ Method validation
  if (method === "upi") {
    if (!isValidVPA(req.body.vpa)) {
      return res.status(400).json({
        error: {
          code: "INVALID_VPA",
          description: "VPA format invalid"
        }
      });
    }
    vpa = req.body.vpa;
  }

  if (method === "card") {
    const c = req.body.card;
    if (
      !c ||
      !isValidCardNumber(c.number) ||
      !isValidExpiry(c.expiry_month, c.expiry_year)
    ) {
      return res.status(400).json({
        error: {
          code: "INVALID_CARD",
          description: "Card validation failed"
        }
      });
    }
    card_network = detectCardNetwork(c.number);
    card_last4 = c.number.slice(-4);
  }

  // 5️⃣ Create payment (processing)
  await pool.query(
    `INSERT INTO payments
     (id, order_id, merchant_id, amount, currency, method,
      status, vpa, card_network, card_last4)
     VALUES ($1,$2,$3,$4,$5,$6,'processing',$7,$8,$9)`,
    [
      paymentId,
      order.id,
      order.merchant_id,
      order.amount,
      order.currency,
      method,
      vpa,
      card_network,
      card_last4
    ]
  );

  // 6️⃣ Simulate processing
  const delay = TEST_MODE
    ? TEST_PROCESSING_DELAY
    : Math.floor(Math.random() * 5000) + 5000;

  await new Promise(r => setTimeout(r, delay));

  const success = TEST_MODE
    ? TEST_PAYMENT_SUCCESS
    : method === "upi"
    ? Math.random() < 0.9
    : Math.random() < 0.95;

  if (success) {
    await pool.query(
      "UPDATE payments SET status='success', updated_at=NOW() WHERE id=$1",
      [paymentId]
    );
  } else {
    await pool.query(
      `UPDATE payments
       SET status='failed',
           error_code='PAYMENT_FAILED',
           error_description='Payment processing failed',
           updated_at=NOW()
       WHERE id=$1`,
      [paymentId]
    );
  }

  // 7️⃣ Response
  res.status(201).json({
    id: paymentId,
    order_id: order.id,
    amount: order.amount,
    currency: order.currency,
    method,
    status: success ? "success" : "failed",
    vpa,
    card_network,
    card_last4,
    created_at: new Date().toISOString()
  });
});

startServer();
