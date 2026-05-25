/**
 * stripeServer.js
 * Lightweight Express server on port 5002 that handles Stripe card charging.
 * Runs alongside the Metro proxy. Called by the React Native app via fetch.
 *
 * Endpoints:
 *   POST /api/stripe/charge    — creates a PaymentIntent and confirms it
 *   GET  /api/stripe/key       — returns the publishable key (safe for client)
 *   GET  /api/payment-config   — returns company-specific payment config (R11)
 */

const http     = require('http');
const { execSync } = require('child_process');

const FIREBASE_DB_URL = 'https://taxilatest.firebaseio.com';

// ── Per-company Stripe keys from Firebase RTDB ────────────────────────────────
// SA portal stores Stripe keys under stripeConfig/{companyId} with fields:
//   secretKey / secret_key    — Stripe secret key (sk_live_... or sk_test_...)
//   publishableKey / publishable_key — Stripe publishable key (pk_live_... or pk_test_...)
async function getCompanyStripeKeys(companyId) {
  if (!companyId) return null;
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/stripeConfig/${encodeURIComponent(companyId)}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;
    const secretKey      = data.secretKey      ?? data.secret_key      ?? data.SecretKey      ?? null;
    const publishableKey = data.publishableKey ?? data.publishable_key ?? data.PublishableKey ?? null;
    if (!secretKey) return null;
    return { secretKey, publishableKey: publishableKey ?? '' };
  } catch {
    return null;
  }
}

// ── Fetch Stripe credentials from Replit connector API ────────────────────────
async function getStripeKeys() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error('Replit connector environment not available');
  }

  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'stripe');
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken,
    },
  });

  const data = await response.json();
  const conn = data.items?.[0];
  if (!conn?.settings?.secret || !conn?.settings?.publishable) {
    throw new Error('Stripe credentials not found in Replit connector');
  }
  return { secretKey: conn.settings.secret, publishableKey: conn.settings.publishable };
}

// ── Resolve the best Stripe keys for a given company ─────────────────────────
// Priority: company-specific keys from Firebase > Replit connector fallback
async function resolveStripeKeys(companyId) {
  if (companyId) {
    const companyKeys = await getCompanyStripeKeys(companyId);
    if (companyKeys?.secretKey) {
      console.log(`[Stripe] Using company-specific keys for companyId: ${companyId}`);
      return companyKeys;
    }
  }
  console.log('[Stripe] Falling back to Replit connector keys');
  return getStripeKeys();
}

// ── Parse request body as JSON ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── CORS headers ──────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/payment-config?cid={companyId} — return publishable key for company (R11)
  if (req.method === 'GET' && req.url?.startsWith('/api/payment-config')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const cid = urlObj.searchParams.get('cid');
      if (!cid) return json(res, 400, { error: 'cid query parameter is required' });

      // Try company-specific key first
      const companyKeys = await getCompanyStripeKeys(cid);
      if (companyKeys?.publishableKey) {
        return json(res, 200, { configured: true, publishableKey: companyKeys.publishableKey });
      }

      // Fall back to Replit connector publishable key
      try {
        const { publishableKey } = await getStripeKeys();
        return json(res, 200, { configured: true, publishableKey });
      } catch {
        return json(res, 200, { configured: false });
      }
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/stripe/key — return publishable key (safe for client-side use)
  if (req.method === 'GET' && req.url === '/api/stripe/key') {
    try {
      const { publishableKey } = await getStripeKeys();
      return json(res, 200, { publishableKey });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/stripe/charge — create + confirm a PaymentIntent
  if (req.method === 'POST' && req.url === '/api/stripe/charge') {
    let body;
    try { body = await readBody(req); }
    catch { return json(res, 400, { error: 'Invalid JSON body' }); }

    const { amountCents, currency = 'nzd', cardNumber, expMonth, expYear, cvc, description, companyId } = body;

    if (!amountCents || !cardNumber || !expMonth || !expYear) {
      return json(res, 400, { error: 'Missing required fields: amountCents, cardNumber, expMonth, expYear' });
    }
    if (amountCents < 50) {
      return json(res, 400, { error: 'Amount must be at least 50 cents' });
    }

    try {
      // R11: prefer company-specific Stripe keys; fall back to Replit connector
      const { secretKey } = await resolveStripeKeys(companyId);

      const params = new URLSearchParams();
      params.append('amount', String(Math.round(amountCents)));
      params.append('currency', currency);
      if (description) params.append('description', description);
      params.append('payment_method_data[type]', 'card');
      params.append('payment_method_data[card][number]', cardNumber.replace(/\s/g, ''));
      params.append('payment_method_data[card][exp_month]', String(expMonth));
      params.append('payment_method_data[card][exp_year]', String(expYear));
      if (cvc) params.append('payment_method_data[card][cvc]', cvc);
      params.append('confirm', 'true');
      params.append('return_url', 'https://taxiapp.local/return');

      const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Version': '2025-08-27.basil',
        },
        body: params.toString(),
      });

      const pi = await piRes.json();

      if (pi.error) {
        return json(res, 402, { error: pi.error.message, code: pi.error.code, declineCode: pi.error.decline_code });
      }

      return json(res, 200, {
        success: true,
        paymentIntentId: pi.id,
        status: pi.status,
        amountCents: pi.amount,
        currency: pi.currency,
      });

    } catch (err) {
      console.error('[Stripe] Charge error:', err.message);
      return json(res, 500, { error: 'Payment processing failed: ' + err.message });
    }
  }

  // POST /api/ocr/card — extract card details from a camera photo using Google Vision API
  if (req.method === 'POST' && req.url === '/api/ocr/card') {
    let body;
    try { body = await readBody(req); }
    catch { return json(res, 400, { error: 'Invalid request' }); }

    const { imageBase64 } = body;
    if (!imageBase64) return json(res, 400, { error: 'imageBase64 is required' });

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return json(res, 503, {
        error: 'OCR not configured',
        message: 'Card photo scanning needs a Google Vision API key (GOOGLE_VISION_API_KEY secret). Please enter card details manually.',
      });
    }

    try {
      const visionRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: imageBase64 },
              features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
            }],
          }),
        }
      );
      const visionData = await visionRes.json();

      if (visionData.error) {
        console.error('[OCR] Vision API error:', visionData.error.message);
        return json(res, 422, { error: 'OCR failed', message: 'Could not read the card. Please enter details manually.' });
      }

      const fullText = visionData.responses?.[0]?.textAnnotations?.[0]?.description ?? '';
      console.log('[OCR] Detected text:', fullText.slice(0, 200));

      const cardNumMatch = fullText.replace(/\n/g, ' ').match(
        /\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}|\d{4}[\s\-]?\d{6}[\s\-]?\d{5}|\d{15,16})\b/
      );
      const cardNumber = cardNumMatch ? cardNumMatch[0].replace(/[\s\-]/g, '') : null;

      const expiryMatch = fullText.match(/\b(0[1-9]|1[0-2])\s*[\/\-]\s*(\d{2}(?:\d{2})?)\b/);
      let expiry = null;
      if (expiryMatch) {
        const yr = expiryMatch[2].length === 4 ? expiryMatch[2].slice(-2) : expiryMatch[2];
        expiry = `${expiryMatch[1]}/${yr}`;
      }

      const nameLines = fullText.split('\n').map(l => l.trim()).filter(l =>
        /^[A-Z][A-Z\s'\-\.]{3,}$/.test(l) && !/\d/.test(l) &&
        !['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'DEBIT', 'CREDIT', 'EFTPOS', 'BANK', 'VALID', 'THRU', 'GOOD'].includes(l)
      );
      const name = nameLines[0] ?? null;

      if (!cardNumber) {
        return json(res, 422, {
          error: 'Card number not detected',
          message: 'Could not read the card number. Ensure the front of the card is clearly visible and well-lit, then try again.',
        });
      }

      return json(res, 200, { success: true, cardNumber, expiry, name });
    } catch (err) {
      console.error('[OCR] Error:', err.message);
      return json(res, 500, { error: 'OCR processing failed', message: 'Please enter card details manually.' });
    }
  }

  json(res, 404, { error: 'Not found' });
});

const PORT = 5002;
let killAttempts = 0;

function tryListen() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[stripe-server] Listening on :${PORT}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && killAttempts < 2) {
    killAttempts++;
    console.warn(`[stripe-server] Port ${PORT} in use — killing old process (attempt ${killAttempts})…`);
    try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}
    setTimeout(tryListen, 1500);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`[stripe-server] Port ${PORT} still busy after ${killAttempts} kill(s) — giving up`);
    process.exit(1);
  } else {
    console.error('[stripe-server] Error:', err.message);
    process.exit(1);
  }
});

tryListen();
