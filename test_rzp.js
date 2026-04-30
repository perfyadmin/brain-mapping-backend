require('dotenv').config();
const Razorpay = require('razorpay');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_LIVE_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

async function test() {
  try {
    console.log("Using Key ID:", RAZORPAY_KEY_ID);
    const order = await razorpay.orders.create({
      amount: 100000,
      currency: "INR",
      receipt: "r_12345"
    });
    console.log("Order created successfully:", order.id);
  } catch (error) {
    console.error("Razorpay Error:", error);
  }
}

test();
