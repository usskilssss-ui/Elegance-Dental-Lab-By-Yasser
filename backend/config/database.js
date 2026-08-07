const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  // Force IPv4 — Railway + Atlas SRV often fails on IPv6-first DNS.
  const conn = await mongoose.connect(uri, { family: 4 });
  console.log(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};

/** Retry until Atlas accepts the connection (do not crash the process). */
const connectDBWithRetry = async (maxAttempts = 30, delayMs = 3000) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await connectDB();
    } catch (error) {
      lastErr = error;
      console.error(
        `MongoDB connect attempt ${attempt}/${maxAttempts} failed: ${error.message}`
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
};

module.exports = connectDB;
module.exports.connectDBWithRetry = connectDBWithRetry;
