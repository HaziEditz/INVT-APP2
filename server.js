require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 5000;
const HOST = '0.0.0.0';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Taxi360 Driver - Android App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 40px 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 2.4rem;
      color: #f7c948;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 1.1rem;
      color: #aaa;
    }
    .badge {
      display: inline-block;
      background: #f7c948;
      color: #1a1a2e;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 20px;
      margin-top: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      max-width: 960px;
      width: 100%;
      margin-bottom: 40px;
    }
    .card {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 12px;
      padding: 24px;
    }
    .card h2 {
      font-size: 1.1rem;
      color: #f7c948;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card ul {
      list-style: none;
      padding: 0;
    }
    .card ul li {
      padding: 6px 0;
      color: #ccc;
      font-size: 0.92rem;
      border-bottom: 1px solid #0f3460;
    }
    .card ul li:last-child { border-bottom: none; }
    .card ul li::before {
      content: '▸ ';
      color: #f7c948;
    }
    .tech-stack {
      max-width: 960px;
      width: 100%;
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 40px;
    }
    .tech-stack h2 {
      color: #f7c948;
      margin-bottom: 16px;
      font-size: 1.1rem;
    }
    .tech-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .tag {
      background: #0f3460;
      color: #e0e0e0;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 0.85rem;
    }
    .note {
      max-width: 960px;
      width: 100%;
      background: #2a1f0e;
      border: 1px solid #f7c948;
      border-radius: 12px;
      padding: 20px 24px;
      color: #f7c948;
      font-size: 0.92rem;
      line-height: 1.6;
    }
    .note strong { display: block; margin-bottom: 6px; font-size: 1rem; }
    footer {
      margin-top: 40px;
      color: #555;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="icon">🚕</div>
    <h1>Taxi360 Driver</h1>
    <p class="subtitle">Professional Android Driver Application</p>
    <span class="badge">Android Native App</span>
  </div>

  <div class="card-grid">
    <div class="card">
      <h2>🗂️ Job Management</h2>
      <ul>
        <li>View and accept offered jobs</li>
        <li>Manage current active jobs</li>
        <li>Job queue management</li>
        <li>Completed job history</li>
        <li>Dispatch integration</li>
      </ul>
    </div>
    <div class="card">
      <h2>🗺️ Navigation & Maps</h2>
      <ul>
        <li>Google Maps integration</li>
        <li>Pickup &amp; drop-off mapping</li>
        <li>Job location display</li>
        <li>Real-time driver tracking</li>
        <li>Address map selection</li>
      </ul>
    </div>
    <div class="card">
      <h2>💬 Communication</h2>
      <ul>
        <li>In-app chat functionality</li>
        <li>Chat inbox &amp; history</li>
        <li>Real-time messaging</li>
        <li>Push notifications</li>
        <li>Driver-dispatcher communication</li>
      </ul>
    </div>
    <div class="card">
      <h2>⏱️ Taximeter &amp; Shifts</h2>
      <ul>
        <li>Digital taximeter service</li>
        <li>Fare calculation</li>
        <li>Start &amp; end shift tracking</li>
        <li>Shift history records</li>
        <li>Extra money management</li>
      </ul>
    </div>
    <div class="card">
      <h2>🔐 Authentication</h2>
      <ul>
        <li>Firebase Authentication</li>
        <li>Email &amp; password sign-in</li>
        <li>Secure session management</li>
        <li>Driver account management</li>
        <li>Profile updates</li>
      </ul>
    </div>
    <div class="card">
      <h2>📁 Project Structure</h2>
      <ul>
        <li>64 Java source files</li>
        <li>Package: com.khybertech.taxi360driver</li>
        <li>Chat, JobView, Maps modules</li>
        <li>SignIn, Settings, ShiftHistory</li>
        <li>Background location services</li>
      </ul>
    </div>
  </div>

  <div class="tech-stack">
    <h2>🛠️ Technology Stack</h2>
    <div class="tech-tags">
      <span class="tag">Android (Java)</span>
      <span class="tag">Firebase Auth</span>
      <span class="tag">Firebase Realtime DB</span>
      <span class="tag">Google Maps API</span>
      <span class="tag">Google Play Services</span>
      <span class="tag">Volley HTTP</span>
      <span class="tag">OneSignal (Push)</span>
      <span class="tag">Background Location</span>
      <span class="tag">Gradle Build System</span>
    </div>
  </div>

  <div class="note">
    <strong>ℹ️ Note</strong>
    This is a native Android application (Java). To build and run the app, you'll need Android Studio with the Android SDK installed.
    Open the project in Android Studio, configure your Firebase credentials, Google Maps API key, and deploy to a device or emulator.
  </div>

  <footer>Taxi360 Driver &mdash; KhyberTech &copy; 2024</footer>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log(`Taxi360 Driver info server running at http://${HOST}:${PORT}`);
});
