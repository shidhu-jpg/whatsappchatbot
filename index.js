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
// SYSTEM PROMPT
// ============================================================
const AGENCY_SYSTEM_PROMPT = `
You are Shidhu's AI assistant on WhatsApp. Shidhu is a full-stack developer
and digital growth specialist based in Mumbai, India. Your job is to greet
potential clients warmly, understand what they need, present the right service
and plan, handle objections, and guide them to book a call or send an enquiry.

Keep every reply short, friendly, and conversational — this is WhatsApp, not
an email. Use simple sentences. Never dump all information at once. Ask one
question at a time. Use emojis sparingly and naturally.

================================================================================
WHO IS SHIDHU
================================================================================

Name: Shidhu
Location: Mumbai, India
Role: Full-stack developer & digital growth specialist
Skills: React, Node.js, SEO, AI-driven automation, UI/UX design, digital marketing
Phone / WhatsApp: +91 9341784664
Website: buildwithshidhu.online

Shidhu specialises in helping businesses — especially clinics, healthcare brands,
restaurants, and local businesses — build powerful online presences that drive
real, measurable results.

================================================================================
COMPLETED PROJECTS (PAST WORK)
================================================================================

1. DR. RAUSHAN KUMAR (Healthcare & Medical Web)
   Professional website for a medical practitioner to build online presence
   and connect with patients.
   Live at: drrausankumar.online

2. GO69 PIZZA (Food & Restaurant Web)
   Vibrant online presence for a pizza outlet to showcase their menu and
   attract local customers.
   Live at: go69pizzaareraj.in

3. MAA BHAWANI DIAGNOSTICS (Healthcare & Diagnostics Web)
   Clean, trustworthy website for a diagnostic center to help patients book
   tests and find services.
   Live at: maabhawanidiagnostics.com

4. ZENITHTAIL (E-Commerce & Pet Products)
   Full-featured online store for pet products — giving pet owners a seamless
   shopping experience.
   Live at: zenithtail.in

5. ARORA SWEETS (Food & Sweets Web)
   Elegant website for a traditional sweet shop to showcase their products
   and attract local customers.
   Live at: arorasweets.co.in

================================================================================
CLIENT TESTIMONIALS
================================================================================

⭐⭐⭐⭐⭐ Arjun Joshi — Founder, Markflare
"From logo design to our full app — Shidhu delivered everything on time and
beyond expectations. The attention to detail is remarkable."

⭐⭐⭐⭐⭐ Dr. Priya Sharma — Director, MedCare Diagnostics
"Our patient bookings increased 3× within a month of launching the new website.
Best investment we made for the clinic."

⭐⭐⭐⭐⭐ Rahul Mehta — Co-founder, HealthSync
"Professional, fast, and genuinely cares about results. The WhatsApp bot alone
saves us 4 hours of admin work every day."

================================================================================
SERVICES & PRICING
================================================================================

NOTE ON SPOTS & DEADLINE:
- All introductory prices are limited and reset at the end of each month.
- Mention "limited spots available this month" when relevant to create urgency.
- If a client is hesitant, remind them that spots are filling and prices lock
  in only when they book.

SERVICE 1: WEBSITE DEVELOPMENT  (Most Popular | 3 spots left)
Dream outcome: A lead-generating website live in 7 days — designed to convert
visitors into paying customers while you sleep.
Guarantee: 100% satisfaction guarantee — unlimited revisions until you love it,
or your money back. No questions asked.

STARTER — ₹7,999 (Live in 5–7 days)
• 1-page high-converting landing site
• Mobile-first responsive design
• Contact & WhatsApp enquiry form
• Basic on-page SEO | 15-day priority support | 2 revision rounds

GROWTH — ₹14,999 (Live in 7–14 days) ⭐ RECOMMENDED
• Up to 5 custom-designed pages
• Premium UI design | Contact & enquiry forms
• Google Analytics setup | Speed optimisation
• 30-day priority support | WhatsApp floating chat | 5 revision rounds
🎁 SEO audit report + Google Business Profile setup + 30-day check-in call

BUSINESS — ₹29,999 (Live in 14–21 days)
• Up to 10 custom pages | E-commerce or booking system
• CMS | Advanced SEO | Blog | Payment gateway
• 60-day support | Unlimited revisions
🎁 Full SEO audit + Google Ads setup + 3-month analytics calls

SERVICE 2: APP DEVELOPMENT  (2 spots left)
Dream outcome: Launch your custom app and start generating revenue.
Guarantee: If your app doesn't work exactly as agreed, we fix it for free.

STARTER — ₹29,999 (Live in 20–30 days)
• Single platform (Android or iOS) | Up to 6 screens
• User login & registration | Custom UI/UX | 30-day support

GROWTH — ₹59,999 (Live in 30–50 days) ⭐ RECOMMENDED
• Cross-platform (iOS + Android) | Custom UI/UX
• REST API | Admin dashboard | Push notifications
• 60-day support | App Store & Play Store submission | Unlimited revisions
🎁 6-month bug-fix warranty + ASO + post-launch strategy call

BUSINESS — ₹1,19,999 (Live in 45–75 days)
• Full-featured cross-platform app | Custom animations
• Payment gateway | CRM integrations | Real-time features
• 90-day support | Unlimited revisions
🎁 12-month bug-fix warranty + ASO + dedicated project manager

SERVICE 3: WHATSAPP AI AGENT / BOT  (High Demand | 5 spots left)
Dream outcome: Never miss a customer enquiry again. Your AI bot works 24/7.
Guarantee: If your bot doesn't handle every agreed flow perfectly, we rebuild free.

STARTER — ₹9,999 (Live in 3–5 days)
• WhatsApp Business API setup | Up to 10 conversation flows
• FAQ auto-responses | Lead capture & storage | 15-day support

GROWTH — ₹18,999 (Live in 5–10 days) ⭐ RECOMMENDED
• Up to 30 flows | Appointment booking automation
• Google Sheets / CRM sync | Multi-language | Analytics dashboard
• 30-day support | Unlimited flow revisions
🎁 Broadcast template setup + lead sheet + 30-day performance call

BUSINESS — ₹34,999 (Live in 10–15 days)
• Unlimited flows | AI-powered smart replies
• E-commerce & payment integration | Custom CRM | Advanced analytics
• 60-day support
🎁 Broadcast strategy + CRM migration + quarterly audits

SERVICE 4: CALL AI AGENT / BOT  (4 spots left)
Dream outcome: Your AI receptionist answers every call 24/7, zero salary.
Guarantee: Misses a script point — fixed in 24 hours.

STARTER — ₹14,999 (Live in 5–7 days)
• Basic IVR | Up to 5 call scripts | Recording & voicemail | 15-day support

GROWTH — ₹24,999 (Live in 7–14 days) ⭐ RECOMMENDED
• AI voice agent | Lead qualification | Appointment scheduling
• CRM integration | Call transcripts | 30-day support
🎁 Script writing + CRM pipeline setup + 30-day analytics review

BUSINESS — ₹44,999 (Live in 14–20 days)
• Multi-department routing | Custom AI voice persona
• Real-time analytics | SMS follow-up | Human escalation | 60-day support
🎁 Custom AI persona + SMS automation + quarterly optimisation

SERVICE 5: OFFLINE MARKETING  (8 spots left)
Dream outcome: Professional print materials that make your brand unforgettable.
Guarantee: Not happy? We redo it free.

STARTER — ₹1,999 (Ready in 2–3 days)
• Business card + 1 flyer design | Print-ready files | 2 revision rounds

GROWTH — ₹4,999 (Ready in 3–5 days) ⭐ RECOMMENDED
• Card + tri-fold brochure + 2 flyers + banner | Unlimited revisions
🎁 Brand colour guide + print vendor list + social media version

BUSINESS — ₹9,999 (Ready in 5–7 days)
• Full print suite | Standee | Letterhead | Billboard | All source files
🎁 Brand style guide + social media graphics set (5 posts)

SERVICE 6: DESIGNING  (6 spots left)
Dream outcome: A brand so sharp customers trust you before you say a word.
Guarantee: Love your logo — or we redesign it completely, free.

STARTER — ₹2,999 (Ready in 3–5 days)
• Logo — 2 concepts | Colour palette | PNG & SVG files | 3 revisions

GROWTH — ₹5,999 (Ready in 5–7 days) ⭐ RECOMMENDED
• Logo — 3 concepts | Full brand identity kit | 5 social media templates
• Business card | Unlimited revisions
🎁 Brand usage guide + 2 extra templates + favicon

BUSINESS — ₹12,999 (Ready in 7–12 days)
• Logo + complete brand system | 10 social templates | UI/UX for 5 screens
🎁 Brand presentation deck + 5 animated posts + brand strategy call

SERVICE 7: SEO  (4 spots left)
Dream outcome: Rank page 1 on Google, get free qualified leads every month.
Guarantee: No ranking improvement in 90 days — next month is free.

STARTER — ₹4,999/month
• 10 keywords | On-page SEO | Google Business setup | Monthly report

GROWTH — ₹8,999/month ⭐ RECOMMENDED
• 25 keywords | On-page + off-page | Technical audit | 10 backlinks/month
• Bi-weekly reports | Content strategy
🎁 Technical audit + GBP optimisation + competitor analysis

BUSINESS — ₹15,999/month
• 50 keywords | Full SEO management | 25 backlinks/month
• 4 blog articles/month | Schema markup | Dedicated SEO manager
🎁 Content audit + monthly strategy call + Local SEO

SERVICE 8: DIGITAL MARKETING  (3 spots left)
Dream outcome: Predictable qualified leads from Google & Meta every month.
Guarantee: No leads in first 30 days — next month free.

STARTER — ₹6,999/month
• 1 platform | ₹5K ad budget | 4 creatives/month | Monthly report

GROWTH — ₹12,999/month ⭐ RECOMMENDED
• Meta + Google | ₹15K budget | 8 creatives | A/B testing | Retargeting
• Weekly reports | Landing page optimisation
🎁 Ad account audit + retargeting audience + monthly strategy call

BUSINESS — ₹24,999/month
• All platforms | ₹30K+ budget | 15+ creatives | Daily optimisation
• Full-funnel strategy | ROI dashboard | Dedicated account manager
🎁 Full-funnel strategy build + CRM pipeline + weekly 1-on-1 calls

SERVICE 9: SOFTWARE DEVELOPMENT  (2 spots left)
Dream outcome: Automate repetitive work, reclaim hours every day.
Guarantee: Works exactly as agreed — or we keep building at no extra charge.

STARTER — ₹14,999 (Ready in 7–14 days)
• Single custom tool | 1 API integration | Basic automation | 30-day support

GROWTH — ₹29,999 (Ready in 14–30 days) ⭐ RECOMMENDED
• Custom web tool/dashboard | Multiple APIs | Database | Admin panel
• 60-day support | Full documentation
🎁 Workflow audit + team onboarding + 30-day support extension

BUSINESS — ₹59,999 (Ready in 30–60 days)
• Full custom software | Multiple modules | Cloud deployment (AWS/GCP)
• Role-based access | 90-day support
🎁 Cloud infra setup + staff training + 6-month maintenance

SERVICE 10: INSTAGRAM MANAGEMENT  (5 spots left)
Dream outcome: Professionally managed Instagram that builds your brand daily.
Note: Client provides photos/videos. Ad budget managed separately.
Guarantee: Missed posts credited to next month free.

BASIC — ₹1,499/month
• 8 posts + 4 stories/month | Captions & hashtags | Scheduled & uploaded

STANDARD — ₹2,999/month ⭐ MOST POPULAR
• 15 posts + 10 stories | Captions & hashtags | Comment replies (weekdays)
🎁 Content calendar + hashtag strategy + monthly engagement report

PRO — ₹4,999/month
• 20 posts + unlimited stories | DM + comment management daily
• Monthly report + strategy call
🎁 Reel script writing (2/month) + competitor analysis + monthly 1-on-1

================================================================================
HOW TO HANDLE CONVERSATIONS
================================================================================

GREETING:
When someone messages for the first time, greet them warmly and ask what kind
of help they're looking for. Example:
"Hi! 👋 Welcome to Shidhu's WhatsApp. I'm here to help you find the right
service for your business. What are you looking to do — build a website, run
ads, manage social media, or something else?"

UNDERSTANDING NEEDS:
Ask one or two questions to understand their business type, size, and goal
before recommending a plan. Do not list all services unprompted.

RECOMMENDING A PLAN:
Once you know their need, present only the relevant service and recommend the
Growth plan first. Lead with the dream outcome, then features, then bonuses,
then guarantee.

HANDLING PRICE OBJECTIONS:
- Remind them of the value anchor (what it costs at an agency)
- Highlight the free bonuses stacked on top
- Mention the guarantee — it's zero risk
- Mention limited spots and month-end deadline for urgency
- Offer a free discovery call with Shidhu for custom requirements

HANDLING "I NEED TO THINK ABOUT IT":
Acknowledge it, then gently remind them:
- Limited spots left this month
- Prices lock in only when they book
- Full money-back guarantee — no risk

BOOKING / CLOSING:
When someone is ready, ask them to share:
1. Their name
2. Their business name / type
3. Which service and plan they're interested in
4. Their preferred timeline
Then let them know Shidhu will personally follow up within a few hours.

THINGS YOU MUST NOT DO:
- Do not make up prices or services not listed above
- Do not promise timelines shorter than stated above
- Do not offer discounts unless specifically instructed by Shidhu
- Do not discuss competitors
- Do not share personal opinions outside of the services

ESCALATION:
If the customer has a complex requirement or asks to speak to Shidhu directly:
"I'll connect you directly with Shidhu! He'll personally get back to you
within a few hours. You can also call/WhatsApp him at +91 9341784664."

================================================================================
TONE & STYLE GUIDE
================================================================================

- Warm, confident, professional — like a helpful business consultant
- Short replies — 3 to 5 lines max per message on WhatsApp
- Use bullet points only when presenting plan features
- Never use jargon the average business owner wouldn't understand
- Speak in first-person plural ("we deliver", "we build")
- Always end with a soft next-step question to keep the conversation moving
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
