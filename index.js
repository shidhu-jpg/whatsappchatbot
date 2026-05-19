import 'dotenv/config';
import express from 'express';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================
// AGENCY SYSTEM PROMPT — Fill in your real details below
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
   - CMS websites (WordPress, headless CMS)
   - Progressive Web Apps (PWA)
   - Tech stack: React, Next.js, Node.js, Tailwind CSS, Supabase
   - Starting price: [e.g., ₹15,000]
   - Typical timeline: [e.g., 1–4 weeks depending on complexity]

2. APP DEVELOPMENT
   - Android & iOS native apps
   - Cross-platform apps using Flutter or React Native
   - Starting price: [e.g., ₹30,000]
   - Typical timeline: [e.g., 4–10 weeks]

3. ADDITIONAL SERVICES:
   - UI/UX Design & Prototyping
   - SEO & Performance Optimization
   - Website maintenance & annual support packages
   - API integrations & third-party tool setup

OUR PROCESS:
1. Free 30-minute consultation call
2. Requirement gathering & project scoping
3. Custom proposal with fixed price quote
4. Design → Development → Testing → Launch
5. 30-day post-launch support included

REPLY GUIDELINES:
- Be warm, friendly, and professional
- Keep WhatsApp replies short (3–5 sentences max)
- If someone asks for a price quote, first ask them to describe their project
- Always end with a call-to-action (e.g., "Would you like a free consultation call?")
- If asked something specific you don't know, say "Let me check with our team and get back to you"
- Never make up prices or timelines not listed above
- Respond in the same language the user writes in (Hindi, English, Hinglish)
`;

// ============================================================
// MONGODB — Stores personal numbers across restarts
// ============================================================
let db = null;
let personalNumbers = new Set();

async function connectMongo() {
    if (!process.env.MONGODB_URI) {
        console.log('⚠️  No MONGODB_URI set — personal numbers will reset if server restarts');
        return;
    }
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('whatsapp-bot');
        const docs = await db.collection('personal_numbers').find().toArray();
        personalNumbers = new Set(docs.map(d => d.jid));
        console.log(`📋 Loaded ${personalNumbers.size} personal number(s) from MongoDB`);
    } catch (err) {
        console.error('MongoDB connection failed:', err.message);
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
// EXPRESS SERVER — Health checks + QR code display
// ============================================================
const app = express();
let latestQR = null;
let isConnected = false;

app.get('/', (req, res) => {
    res.send(`
        <html><head><title>WhatsApp Bot</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0f0f0;">
            <h2>WhatsApp Agency Bot</h2>
            <p>Status: <strong style="color:${isConnected ? 'green' : 'orange'}">${isConnected ? '✅ Connected' : '⏳ Not connected'}</strong></p>
            ${!isConnected ? '<p><a href="/qr" style="font-size:18px">👉 Click here to scan QR code</a></p>' : '<p>Bot is running and replying to messages.</p>'}
        </body></html>
    `);
});

app.get('/qr', async (req, res) => {
    if (isConnected) {
        return res.send('<html><body style="text-align:center;padding:40px;font-family:sans-serif;"><h2>✅ Already connected!</h2><p>The bot is live and running.</p></body></html>');
    }
    if (!latestQR) {
        return res.send(`
            <html><body style="text-align:center;padding:40px;font-family:sans-serif;">
                <h2>⏳ QR not ready yet</h2>
                <p>Baileys is connecting to WhatsApp servers... wait 10–20 seconds and refresh.</p>
                <p style="color:gray;font-size:13px">Auto-refreshing in 5 seconds</p>
                <script>setTimeout(()=>location.reload(),5000)</script>
            </body></html>`);
    }
    try {
        const qrImage = await QRCode.toDataURL(latestQR);
        const qrText  = await QRCode.toString(latestQR, { type: 'utf8' });
        res.send(`
            <html><head><title>Scan QR</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#fff;">
                <h2>Scan with WhatsApp</h2>
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <img src="${qrImage}" style="width:280px;height:280px;border:8px solid white;border-radius:12px;" />
                <p style="color:#aaa;font-size:13px">Auto-refreshes every 20 seconds &bull; If image doesn't work, scan the text QR below</p>
                <pre style="display:inline-block;font-size:7px;line-height:7px;background:#fff;color:#000;padding:10px;">${qrText}</pre>
                <script>setTimeout(()=>location.reload(),20000)</script>
            </body></html>
        `);
    } catch (e) {
        res.send(`<html><body style="text-align:center;padding:40px;"><p>Error: ${e.message}</p><a href="/qr">Retry</a></body></html>`);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connected: isConnected, uptime: Math.floor(process.uptime()) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ============================================================
// WHATSAPP BOT — Baileys WebSocket (no Chrome needed)
// ============================================================
const conversationHistory = new Map();

async function startBot() {
    console.log('🚀 [1/4] startBot() called');

    try {
        await connectMongo();
    } catch (e) {
        console.error('⚠️  MongoDB failed (non-fatal):', e.message);
    }

    console.log('🔑 [2/4] Loading auth state...');
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    console.log('✅ [3/4] Auth state loaded. Creating WhatsApp socket...');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Agency Bot', 'Chrome', '1.0'],
        logger: pino({ level: 'silent' }),
    });
    console.log('✅ [4/4] Socket created — waiting for QR from WhatsApp...');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
            isConnected = false;
            console.log('\n📱 QR ready — open /qr in your browser to scan it\n');
        }

        if (connection === 'open') {
            isConnected = true;
            latestQR = null;
            console.log('\n✅ WhatsApp connected! Bot is live.\n');
            console.log('📱 Send these to YOURSELF on WhatsApp to manage personal numbers:');
            console.log('   !add 919876543210   → AI skips this number, you reply manually');
            console.log('   !remove 919876543210 → Remove from personal list');
            console.log('   !list               → Show all personal numbers\n');
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Disconnected. Reconnecting...');
                setTimeout(launchWithRetry, 3000);
            } else {
                console.log('❌ Logged out. Delete the auth_info folder and restart.');
            }
        }
    });

    // ============================================================
    // COMMANDS — Send these to YOURSELF on WhatsApp
    // ============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const jid = msg.key.remoteJid;
            const isGroup = jid?.endsWith('@g.us');
            if (!jid || isGroup) continue;

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ''
            ).trim();

            if (!text) continue;

            // Commands sent from your own number
            if (msg.key.fromMe) {
                if (text.startsWith('!add ')) {
                    const rawNum = text.slice(5).trim().replace(/\D/g, '');
                    if (!rawNum) return;
                    const targetJid = `${rawNum}@s.whatsapp.net`;
                    await addPersonalNumber(targetJid);
                    await sock.sendMessage(jid, { text: `✅ ${rawNum} added to personal list.\nAI will NOT reply to them — only you will.` }, { quoted: msg });
                    console.log(`[PERSONAL] Added: ${targetJid}`);

                } else if (text.startsWith('!remove ')) {
                    const rawNum = text.slice(8).trim().replace(/\D/g, '');
                    if (!rawNum) return;
                    const targetJid = `${rawNum}@s.whatsapp.net`;
                    if (personalNumbers.has(targetJid)) {
                        await removePersonalNumber(targetJid);
                        await sock.sendMessage(jid, { text: `✅ ${rawNum} removed.\nAI will now auto-reply to them.` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { text: `⚠️ ${rawNum} is not in your personal list.` }, { quoted: msg });
                    }
                    console.log(`[PERSONAL] Removed: ${targetJid}`);

                } else if (text === '!list') {
                    if (personalNumbers.size === 0) {
                        await sock.sendMessage(jid, { text: '📋 Personal list is empty.\n\nUse *!add [number]* to add someone.' }, { quoted: msg });
                    } else {
                        const list = [...personalNumbers]
                            .map((j, i) => `${i + 1}. ${j.replace('@s.whatsapp.net', '')}`)
                            .join('\n');
                        await sock.sendMessage(jid, { text: `📋 Personal numbers (${personalNumbers.size}):\n\n${list}\n\nAI skips these — you reply personally.` }, { quoted: msg });
                    }
                }
                continue;
            }

            // ============================================================
            // INCOMING MESSAGES — AI replies unless it's a personal number
            // ============================================================
            if (personalNumbers.has(jid)) {
                console.log(`[PERSONAL] ⚠️  Message from ${jid.replace('@s.whatsapp.net', '')} — waiting for your manual reply`);
                continue;
            }

            if (!conversationHistory.has(jid)) {
                conversationHistory.set(jid, []);
            }
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
                console.log(`[${new Date().toLocaleTimeString()}] AI → ${jid.replace('@s.whatsapp.net', '')}: "${text.slice(0, 50)}"`);

            } catch (err) {
                console.error('Gemini error:', err.message);
                await sock.sendMessage(jid, { text: 'Sorry, I ran into a small issue. Please try again or contact us directly!' }, { quoted: msg });
            }
        }
    });
}

// Keep the process alive even if WhatsApp connection crashes
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err?.message || err);
});

async function launchWithRetry() {
    try {
        await startBot();
    } catch (err) {
        console.error('Bot crashed:', err?.message || err);
        console.log('Retrying in 10 seconds...');
        setTimeout(launchWithRetry, 10000);
    }
}

launchWithRetry();
