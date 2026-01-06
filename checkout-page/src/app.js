// Prevent multiple polling intervals
let pollingInterval = null;

// Read order_id from URL
const params = new URLSearchParams(window.location.search);
const orderId = params.get("order_id");

// DOM elements
const amountEl = document.querySelector('[data-test-id="order-amount"]');
const orderIdEl = document.querySelector('[data-test-id="order-id"]');

const upiForm = document.querySelector('[data-test-id="upi-form"]');
const cardForm = document.querySelector('[data-test-id="card-form"]');

const processing = document.querySelector('[data-test-id="processing-state"]');
const success = document.querySelector('[data-test-id="success-state"]');
const error = document.querySelector('[data-test-id="error-state"]');

// -------------------------
// FETCH ORDER DETAILS
// -------------------------
fetch(`http://localhost:8000/api/v1/orders/${orderId}/public`)
  .then((res) => res.json())
  .then((order) => {
    amountEl.textContent = "INR " + order.amount / 100;
    orderIdEl.textContent = order.id;
  })
  .catch(() => {
    error.style.display = "block";
    document.querySelector('[data-test-id="error-message"]').textContent =
      "Unable to load order details";
  });

// -------------------------
// TOGGLE PAYMENT FORMS
// -------------------------
document.querySelector('[data-test-id="method-upi"]').onclick = () => {
  upiForm.style.display = "block";
  cardForm.style.display = "none";
};

document.querySelector('[data-test-id="method-card"]').onclick = () => {
  cardForm.style.display = "block";
  upiForm.style.display = "none";
};

// -------------------------
// UPI PAYMENT SUBMIT
// -------------------------
upiForm.onsubmit = async (e) => {
  e.preventDefault();

  const vpa = document.querySelector('[data-test-id="vpa-input"]').value;

  // UI state
  upiForm.style.display = "none";
  cardForm.style.display = "none";
  processing.style.display = "block";
  error.style.display = "none";

  const res = await fetch("http://localhost:8000/api/v1/payments/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      method: "upi",
      vpa,
    }),
  });

  if (!res.ok) {
    processing.style.display = "none";
    error.style.display = "block";
    document.querySelector('[data-test-id="error-message"]').textContent =
      "Payment could not be processed";
    return;
  }

  const payment = await res.json();
  pollPayment(payment.id);
};

// -------------------------
// POLL PAYMENT STATUS
// -------------------------
function pollPayment(paymentId) {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    const res = await fetch(
      `http://localhost:8000/api/v1/payments/${paymentId}`,
      {
        headers: {
          "X-Api-Key": "key_test_abc123",
          "X-Api-Secret": "secret_test_xyz789",
        },
      }
    );

    const data = await res.json();

    if (data.status === "success") {
      clearInterval(pollingInterval);
      processing.style.display = "none";
      success.style.display = "block";
      document.querySelector('[data-test-id="payment-id"]').textContent =
        paymentId;
    }

    if (data.status === "failed") {
      clearInterval(pollingInterval);
      processing.style.display = "none";
      error.style.display = "block";
      document.querySelector('[data-test-id="error-message"]').textContent =
        "Payment failed. Please try again.";
    }
  }, 2000);
}
