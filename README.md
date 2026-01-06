# Payment Gateway System (Razorpay/Stripe-like)

## 📌 Project Overview

This project is a fully containerized **payment gateway system** inspired by platforms like Razorpay and Stripe.  
It allows merchants to create payment orders via APIs and enables customers to complete payments through a **hosted checkout page** supporting **UPI and Card payments**.

The system demonstrates real-world fintech concepts such as:
- API key–based authentication
- Order and payment lifecycle management
- Payment validation (VPA, card Luhn check, expiry validation)
- Hosted checkout flow with polling
- Dockerized multi-service architecture

---

## 🛠 Tech Stack

- **Backend API**: Node.js, Express
- **Database**: PostgreSQL
- **Dashboard Frontend**: HTML, JavaScript, Nginx
- **Checkout Page**: HTML, JavaScript, Nginx
- **Containerization**: Docker, Docker Compose

---

## 🏗 Architecture Overview

```text
Merchant / Customer
        |
        v
+-------------------+
|  Dashboard (3000) |
+-------------------+
        |
        v
+-------------------+        +------------------+
|   API (8000)      | -----> |  PostgreSQL DB   |
+-------------------+        +------------------+
        ^
        |
+-------------------+
| Checkout (3001)   |
+-------------------+
````

### Components

* **API Service**: Handles merchants, orders, payments, and validation
* **Dashboard**: Merchant interface to view API credentials and transactions
* **Checkout Page**: Hosted payment page for customers
* **Database**: Stores merchants, orders, and payments

---

## 🚀 Setup Instructions

### Prerequisites

* Docker
* Docker Compose

### Steps

```bash
git clone <YOUR_GITHUB_REPO_URL>
cd payment-gateway
docker-compose up -d
```

### Service Ports

| Service   | URL                                            |
| --------- | ---------------------------------------------- |
| API       | [http://localhost:8000](http://localhost:8000) |
| Dashboard | [http://localhost:3000](http://localhost:3000) |
| Checkout  | [http://localhost:3001](http://localhost:3001) |

No manual setup is required.
Database tables and test merchant are seeded automatically on startup.

---

## 🔐 Test Merchant Credentials (Auto-Seeded)

These credentials are **automatically created on startup**:

```
Email: test@example.com
API Key: key_test_abc123
API Secret: secret_test_xyz789
```

---

## 📦 Environment Variables

File: `.env.example`

```env
DATABASE_URL=postgresql://gateway_user:gateway_pass@postgres:5432/payment_gateway
PORT=8000

# Test merchant credentials
TEST_MERCHANT_EMAIL=test@example.com
TEST_API_KEY=key_test_abc123
TEST_API_SECRET=secret_test_xyz789

# Payment simulation config
UPI_SUCCESS_RATE=0.90
CARD_SUCCESS_RATE=0.95
PROCESSING_DELAY_MIN=5000
PROCESSING_DELAY_MAX=10000

# Test mode (for automated evaluation)
TEST_MODE=false
TEST_PAYMENT_SUCCESS=true
TEST_PROCESSING_DELAY=1000
```

---

## 📑 API Documentation

### Health Check

```
GET /health
```

Response:

```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Create Order

```
POST /api/v1/orders
```

Headers:

```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

Body:

```json
{
  "amount": 50000,
  "receipt": "receipt_001"
}
```

---

### Get Order

```
GET /api/v1/orders/:order_id
```

---

### Create Payment

```
POST /api/v1/payments
```

UPI Body:

```json
{
  "order_id": "order_xxx",
  "method": "upi",
  "vpa": "user@paytm"
}
```

---

### Get Payment

```
GET /api/v1/payments/:payment_id
```

---

### Public Checkout APIs

Used by checkout page (no authentication):

```
GET /api/v1/orders/:order_id/public
POST /api/v1/payments/public
```

---

## 💳 Payment Validation Logic

* **UPI VPA Validation**

  * Regex-based format validation
* **Card Validation**

  * Luhn algorithm for card number
  * Card network detection (Visa, Mastercard, Amex, RuPay)
  * Expiry date validation
* **Security**

  * CVV and full card numbers are never stored

---

## 🗄 Database Schema

### Tables

* **merchants**
* **orders**
* **payments**

### Relationships

* One merchant → many orders
* One order → many payments

Indexes are applied on:

* `orders.merchant_id`
* `payments.order_id`
* `payments.status`

---

## 🖥 Dashboard Features

* Login page
* Dashboard showing API key & secret
* Transaction statistics
* Transactions list

All required `data-test-id` attributes are implemented exactly as specified.

---

## 🧾 Checkout Page Flow

1. Open checkout page with order ID:

   ```
   http://localhost:3001/checkout?order_id=order_xxx
   ```
2. Select payment method (UPI/Card)
3. Enter payment details
4. Payment enters processing state
5. UI polls payment status
6. Displays success or failure state