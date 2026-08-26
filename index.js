require('dotenv').config();
const express = require('express');
const app = express();

// Raw body needed for Stripe webhook signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use('/merchants', require('./server/routes/merchants'));
app.use('/accounts', require('./server/routes/accounts'));
app.use('/checkout', require('./server/routes/payments'));
app.use('/terminal', require('./server/routes/terminal'));
app.use('/webhooks', require('./server/routes/webhooks'));
app.use('/refunds', require('./server/routes/refunds'));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
