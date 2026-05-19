import 'dotenv/config';
import express from 'express';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================
// AGENCY SYSTEM PROMPT — Fill in your real details
// ============================================================
const AGENCY_SYSTEM_PROMPT = `
You are a professional sales and support assistant for a digital agency. Your goal is to answer questions about the agency's services, understand the client's needs, and encourage them to get in touch for a free consultation.

AGENCY DETAILS:
- Name: [YOUR AGENCY NAME]
- Location: India
- Contact Email: [YOUR EMAIL]
- WhatsApp / Phone: [YOUR NUMBER]
- Website: [YOUR WEBSITE URL]

SERVICES WE OFFER:

1. WEB DEVELOPMENT
   - Business websites (landing pages, portfolios, company sites)
   - E-commerce stores with payment gateway integration
   - Custom web applications and dashboards
   - Progressive Web Apps (PWA)
   - Tech stack: React, Next.js, Node.js, Tailwind CSS
   - Starting price: [e.g., ₹15,000]
   - Typical timeline: [e.g., 1–4 weeks]

2. APP DEVELOPMENT
   - Android & iOS apps
   - Cross-platform apps using Flutter or React Native
   - Starting price: [e.g., ₹30,000]
   - Typical timeline: [e.g., 4–10 weeks]

3. ADDITIONAL SERVICES:
   - UI/UX Design & Prototyping
   - SEO & Performance Optimization
   - Website maintenance & support packages

OUR PROCESS:
1. Free 30-minute consultation call
2. Requirement gathering & scoping
3. Fixed-price proposal
4. Design → Development → Testing → Launch
5. 30-day post-launch support

REPLY GUIDELINES:
- Be warm, friendly, and professional
- Keep WhatsApp replies short (3–5 sentences max)
- If someone asks for a quote, first ask them to describe their project
- Always end with a call-to-action (e.g., "Would you like a free consultation call?")
- Never make up prices or timelines not listed above
- Respond in the same language the user writes in (Hindi, English, Hinglish)
`;

// ============================================================
// MONGODB — Stores personal numbers across restarts
// ============================================================
let db = null;
let personalNumbers = new Set();

async function connectMongo() {
    if (!process.env.MONGODB_URI) return;
    try {
        const client = new MongoClient(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
            tls: true,
            tlsInsecure: true,
        });
        await client.connect();
        db = client.db('whatsapp-bot');
        const docs = await db.collection('personal_numbers').find().toArray();
        personalNumbers = new Set(docs.map(d => d.jid));
        console.log(`📋 MongoDB connected. ${personalNumbers.size} personal number(s) loaded.`);
    } catch (err) {
        console.log('⚠️  MongoDB skipped:', err.message.slice(0, 80));
    }
}

async function addPersonalNumber(jid) {
    personalNumbers.add(jid);
    if (db) await db.collection('personal_numbers').updateOne({ jid }, { $set: { jid } }, { upsert: true });
}

async function removePersonalNumber(jid) {
    personalNumbers.delete(jid);
    if (db) await db.collection('personal_numbers').deleteOne({ jid });
}

// ============================================================
// EXPRESS SERVER — Health + QR page
// ============================================================
const app = express();
let latestQR = null;
let isConnected = false;

app.get('/', (req, res) => {
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5;">
        <h2>WhatsApp Agency Bot</h2>
        <p>Status: <strong style="color:${isConnected ? 'green' : 'orange'}">${isConnected ? '✅ Connected' : '⏳ Not connected yet'}</strong></p>
        ${!isConnected ? '<p><a href="/qr" style="font-size:18px;color:blue">👉 Click here to scan QR code</a></p>' : '<p>Bot is running and replying to messages.</p>'}
    </body></html>`);
});

app.get('/qr', async (req, res) => {
    if (isConnected) {
        return res.send('<html><body style="text-align:center;padding:40px;font-family:sans-serif;"><h2>✅ Already connected!</h2><p>The bot is live.</p></body></html>');
    }
    if (!latestQR) {
        return res.send(`<html><body style="text-align:center;padding:40px;font-family:sans-serif;">
            <h2>⏳ QR not ready yet</h2>
            <p>Connecting to WhatsApp... wait 15–20 seconds and refresh.</p>
            <script>setTimeout(()=>location.reload(),5000)</script>
        </body></html>`);
    }
    try {
        const qrImage = await QRCode.toDataURL(latestQR);
        const qrText = await QRCode.toString(latestQR, { type: 'utf8' });
        res.send(`<html><head><title>Scan QR</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#fff;">
            <h2>Scan with WhatsApp</h2>
            <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            <img src="${qrImage}" style="width:280px;height:280px;border:8px solid white;border-radius:12px;" /><br><br>
            <details><summary style="color:#aaa;cursor:pointer">Text QR (if image doesn't work)</summary>
            <pre style="display:inline-block;font-size:6px;line-height:6px;background:#fff;color:#000;padding:10px;">${qrText}</pre></details>
            <p style="color:#aaa;font-size:13px">Auto-refreshes every 25 seconds</p>
            <script>setTimeout(()=>location.reload(),25000)</script>
        </body></html>`);
    } catch (e) {
        res.send(`<html><body style="padding:40px;"><h2>Error showing QR</h2><p>${e.message}</p><a href="/qr">Retry</a></body></html>`);
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok', connected: isConnected, uptime: Math.floor(process.uptime()) }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server on port ${PORT}`));

// ============================================================
// WHATSAPP BOT — Dynamic import handles any Baileys version
// ============================================================
const conversationHistory = new Map();

async function startBot() {
    console.log('🚀 Starting WhatsApp bot...');

    await connectMongo();

    // Dynamic import handles both old (default) and new (named) Baileys exports
    const Baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = Baileys.makeWASocket || Baileys.default;
    const { useMultiFileAuthState, DisconnectReason } = Baileys;

    if (typeof makeWASocket !== 'function') {
        throw new Error(`makeWASocket not found. Available exports: ${Object.keys(Baileys).join(', ')}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    console.log('✅ Auth loaded. Connecting to WhatsApp...');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['WhatsApp', 'Chrome', '4.0.0'],
        logger: pino({ level: 'warn' }),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: undefined,
        keepAliveIntervalMs: 15000,
    });

    // Auto-reconnect if QR not received in 45 seconds
    const qrTimer = setTimeout(() => {
        if (!latestQR && !isConnected) {
            console.log('⏰ No QR in 45s — reconnecting...');
            sock.end();
        }
    }, 45000);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            clearTimeout(qrTimer);
            latestQR = qr;
            isConnected = false;
            // Print QR to Render logs — user can also check /qr URL
            console.log('\n📱 QR CODE READY — Visit /qr URL to scan, OR scan the terminal QR below:\n');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            clearTimeout(qrTimer);
            isConnected = true;
            latestQR = null;
            console.log('\n✅ WhatsApp connected! Bot is live and replying to messages.');
            console.log('Send to YOUR OWN number: !add [number], !remove [number], !list\n');
        }

        if (connection === 'close') {
            isConnected = false;
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                console.log(`🔄 Disconnected (code ${code}). Reconnecting in 5s...`);
                setTimeout(launchWithRetry, 5000);
            } else {
                console.log('❌ Logged out. Delete auth_info folder and restart.');
            }
        }
    });

    // ============================================================
    // SELF-COMMANDS — Send to yourself to manage personal numbers
    // ============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;
            const jid = msg.key.remoteJid;
            if (!jid || jid.endsWith('@g.us')) continue;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text || ''
            ).trim();

            if (!text) continue;

            // Commands from your own number
            if (msg.key.fromMe) {
                if (text.startsWith('!add ')) {
                    const num = text.slice(5).trim().replace(/\D/g, '');
                    if (!num) continue;
                    const targetJid = `${num}@s.whatsapp.net`;
                    await addPersonalNumber(targetJid);
                    await sock.sendMessage(jid, { text: `✅ ${num} added. AI will NOT reply to them.` }, { quoted: msg });

                } else if (text.startsWith('!remove ')) {
                    const num = text.slice(8).trim().replace(/\D/g, '');
                    if (!num) continue;
                    const targetJid = `${num}@s.whatsapp.net`;
                    if (personalNumbers.has(targetJid)) {
                        await removePersonalNumber(targetJid);
                        await sock.sendMessage(jid, { text: `✅ ${num} removed. AI will reply to them again.` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { text: `⚠️ ${num} is not in your personal list.` }, { quoted: msg });
                    }

                } else if (text === '!list') {
                    const list = personalNumbers.size === 0
                        ? 'Empty. Use !add [number] to add someone.'
                        : [...personalNumbers].map((j, i) => `${i + 1}. ${j.replace('@s.whatsapp.net', '')}`).join('\n');
                    await sock.sendMessage(jid, { text: `📋 Personal numbers:\n\n${list}` }, { quoted: msg });
                }
                continue;
            }

            // Skip personal numbers — you reply manually
            if (personalNumbers.has(jid)) {
                console.log(`[PERSONAL] Message from ${jid.replace('@s.whatsapp.net', '')} — awaiting your reply`);
                continue;
            }

            // AI reply
            if (!conversationHistory.has(jid)) conversationHistory.set(jid, []);
            const history = conversationHistory.get(jid);

            try {
                const model = genAI.getGenerativeModel({
                    model: 'gemini-1.5-flash',
                    systemInstruction: AGENCY_SYSTEM_PROMPT,
                });
                const chat = model.startChat({ history });
                const result = await chat.sendMessage(text);
                const reply = result.response.text();

                history.push({ role: 'user', parts: [{ text }] });
                history.push({ role: 'model', parts: [{ text: reply }] });
                if (history.length > 20) history.splice(0, 2);

                await sock.sendMessage(jid, { text: reply }, { quoted: msg });
                console.log(`[BOT] → ${jid.replace('@s.whatsapp.net', '')}: "${text.slice(0, 40)}"`);
            } catch (err) {
                console.error('Gemini error:', err.message);
                await sock.sendMessage(jid, { text: 'Sorry, I ran into a small issue. Please try again!' }, { quoted: msg });
            }
        }
    });
}

// ============================================================
// LAUNCH WITH AUTO-RETRY
// ============================================================
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err?.message));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err?.message));

async function launchWithRetry() {
    try {
        await startBot();
    } catch (err) {
        console.error('Bot crashed:', err?.message);
        console.log('Retrying in 10 seconds...');
        setTimeout(launchWithRetry, 10000);
    }
}

launchWithRetry();
