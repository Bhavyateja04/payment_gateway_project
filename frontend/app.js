console.log("Checkout JS loaded");

const params = new URLSearchParams(window.location.search);
const orderId = params.get("order_id");

const amountEl = document.querySelector('[data-test-id="order-amount"]');
const orderIdEl = document.querySelector('[data-test-id="order-id"]');

const upiForm = document.querySelector('[data-test-id="upi-form"]');
const cardForm = document.querySelector('[data-test-id="card-form"]');

const processing = document.querySelector('[data-test-id="processing-state"]');
const success = document.querySelector('[data-test-id="success-state"]');
const error = document.querySelector('[data-test-id="error-state"]');

// Fetch order public details
async function loadOrder() {
  const res = await fetch(`http://localhost:8000/api/v1/orders/${orderId}/public`);

  if (!res.ok) {
    amountEl.textContent = "Invalid Order";
    orderIdEl.textContent = "N/A";
    return;
  }

  const order = await res.json();
  amountEl.textContent = `INR ${(order.amount / 100).toFixed(2)}`;
  orderIdEl.textContent = order.id;
}


loadOrder();

// Toggle forms
document.querySelector('[data-test-id="method-upi"]').onclick = () => {
  upiForm.style.display = "block";
  cardForm.style.display = "none";
};

document.querySelector('[data-test-id="method-card"]').onclick = () => {
  cardForm.style.display = "block";
  upiForm.style.display = "none";
};

// UPI Payment
upiForm.onsubmit = async (e) => {
  e.preventDefault();
  const vpa = document.querySelector('[data-test-id="vpa-input"]').value;

  processing.style.display = "block";
  upiForm.style.display = "none";
  cardForm.style.display = "none";

  const res = await fetch("http://localhost:8000/api/v1/payments/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      method: "upi",
      vpa,
    }),
  });

  const payment = await res.json();
  pollPayment(payment.id);
};

function pollPayment(paymentId) {
  const interval = setInterval(async () => {
    const res = await fetch(`http://localhost:8000/api/v1/payments/${paymentId}`, {
      headers: {
        "X-Api-Key": "key_test_abc123",
        "X-Api-Secret": "secret_test_xyz789",
      },
    });

    const data = await res.json();

    if (data.status === "success") {
      clearInterval(interval);
      processing.style.display = "none";
      success.style.display = "block";
      document.querySelector('[data-test-id="payment-id"]').textContent = paymentId;
    }

    if (data.status === "failed") {
      clearInterval(interval);
      processing.style.display = "none";
      error.style.display = "block";
    }
  }, 2000);
}
