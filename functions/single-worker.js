export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        };

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response("OK", { headers: corsHeaders });
        }

        try {
            // Route 0: Diagnostic Version (GET /api/version or GET /version)
            if (url.pathname === "/api/version" || url.pathname === "/version") {
                try {
                    const testKyiv = toKyiv(new Date());
                    return new Response(JSON.stringify({ version: "1.5.1-visitors-fix", testKyiv }), {
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                } catch (e) {
                    return new Response(JSON.stringify({ version: "1.5.1-visitors-fix", error: e.message, stack: e.stack }), {
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }
            }

            // Route 1: Set Webhook (GET /api/set-webhook or GET /set-webhook)
            if (url.pathname === "/api/set-webhook" || url.pathname === "/set-webhook") {
                return await handleSetWebhook(request, env, corsHeaders);
            }

            // Route 2: Telegram Bot Webhook (POST /api/bot-webhook or POST /bot-webhook)
            if (request.method === "POST" && (url.pathname === "/api/bot-webhook" || url.pathname === "/bot-webhook")) {
                // Respond immediately to Telegram to avoid 5s timeout,
                // then process the command in the background
                const body = await request.json();
                ctx.waitUntil(handleBotWebhook(body, env));
                return new Response("OK", { status: 200 });
            }

            // Route 3: Visit Tracking (POST /api/visit)
            if (request.method === "POST" && url.pathname === "/api/visit") {
                return await handleVisit(request, env, corsHeaders);
            }

            // Route 4: RSVP Form Submission (POST / or POST /api/rsvp)
            if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/api/rsvp")) {
                return await handleRSVP(request, env, corsHeaders);
            }

            // Default: Fallback to RSVP submission if POST request (compatibility with old root URL)
            if (request.method === "POST") {
                return await handleRSVP(request, env, corsHeaders);
            }

            return new Response(
                JSON.stringify({ success: false, message: "Path or Method not allowed. Open /api/set-webhook to configure." }),
                { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        } catch (error) {
            return new Response(
                JSON.stringify({ success: false, message: error.message }),
                { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
        }
    }
};

// --- HELPER FUNCTIONS FOR NO-CONFIG DATABASE ---
async function getKV(appKey, key) {
    try {
        const res = await fetch(`https://keyvalue.immanuel.co/api/KeyVal/GetValue/${appKey}/${key}`);
        const text = await res.text();
        
        // Handle API errors (DBNull, 404, exception responses)
        if (!res.ok || !text || text === "null" || text === '""') return null;
        if (text.includes('"ExceptionMessage"') || text.includes('"Message":"An error')) return null;
        
        // Parse the outer quotes returned by ASP.NET API
        let parsedStr;
        try {
            parsedStr = JSON.parse(text);
        } catch (e) {
            return null;
        }
        
        // Try parsing inner JSON if it is JSON
        try {
            return JSON.parse(parsedStr);
        } catch (e) {
            return parsedStr;
        }
    } catch (err) {
        console.error("getKV error:", err);
        return null;
    }
}

async function setKV(appKey, key, value) {
    try {
        const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
        const encoded = encodeURIComponent(valStr);
        const res = await fetch(`https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/${appKey}/${key}/${encoded}`, {
            method: "POST",
            body: "1" // Passing a non-empty string body forces Cloudflare to set Content-Length: 1, avoiding HTTP 411 Length Required error from keyvalue.immanuel.co
        });
        return res.ok;
    } catch (err) {
        console.error("setKV error:", err);
        return false;
    }
}

// --- BASE64URL HELPER FUNCTIONS FOR IIS SAFE PATHS ---
function base64encode(str) {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- KYIV TIMEZONE HELPER ---
function toKyiv(date) {
    // Returns a Date-like object with Kyiv time components
    const d = date instanceof Date ? date : new Date(date);
    const kyivStr = d.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" });
    // Parse "DD.MM.YYYY, HH:MM:SS" format
    const m = kyivStr.match(/(\d+)\.(\d+)\.(\d+),?\s+(\d+):(\d+)/);
    if (!m) return { day: '??', month: '??', hours: '??', minutes: '??', dateStr: '??', full: kyivStr };
    return {
        day: m[1].padStart(2, '0'),
        month: m[2].padStart(2, '0'),
        year: m[3],
        hours: m[4].padStart(2, '0'),
        minutes: m[5].padStart(2, '0'),
        dateStr: `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}`,
        timeStr: `${m[4].padStart(2,'0')}:${m[5].padStart(2,'0')}`,
        isoDate: `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`,
        full: kyivStr
    };
}

function nowKyivISO() {
    const k = toKyiv(new Date());
    return `${k.year}-${k.month}-${k.day}T${k.hours}:${k.minutes}:00+03:00`;
}

function base64decode(b64url) {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) {
        b64 += "=";
    }
    return decodeURIComponent(escape(atob(b64)));
}

async function setKVLarge(appKey, key, value) {
    try {
        const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
        const base64Data = base64encode(valStr);
        const chunkSize = 150;
        const totalChunks = Math.ceil(base64Data.length / chunkSize);
        
        // Save total chunk count as metadata so reader knows exactly how many to fetch
        await setKV(appKey, `${key}_meta`, String(totalChunks));
        
        for (let i = 0; i < totalChunks; i++) {
            const chunk = base64Data.substring(i * chunkSize, (i + 1) * chunkSize);
            const success = await setKV(appKey, `${key}_${i}`, chunk);
            if (!success) return false;
        }
        return true;
    } catch (err) {
        console.error("setKVLarge error:", err);
        return false;
    }
}

async function getKVLarge(appKey, key) {
    try {
        // Read metadata to know how many chunks
        const metaVal = await getKV(appKey, `${key}_meta`);
        let totalChunks = 0;
        
        if (metaVal !== null) {
            totalChunks = parseInt(String(metaVal), 10);
            if (isNaN(totalChunks) || totalChunks <= 0) totalChunks = 0;
        }
        
        if (totalChunks === 0) {
            // Try reading chunk 0 directly (old format without meta)
            const firstChunk = await getKV(appKey, `${key}_0`);
            if (firstChunk === null) {
                return null;
            }
            // Old format: read chunks until null
            let base64Data = firstChunk;
            let i = 1;
            for (; i < 50; i++) { // safety limit
                const chunk = await getKV(appKey, `${key}_${i}`);
                if (chunk === null) break;
                base64Data += chunk;
            }
            try {
                return JSON.parse(base64decode(base64Data));
            } catch (e) {
                return null;
            }
        }
        
        // New format: read exactly totalChunks, but robustly break if null (salvaging data)
        let base64Data = "";
        for (let i = 0; i < totalChunks; i++) {
            const chunk = await getKV(appKey, `${key}_${i}`);
            if (chunk === null) {
                console.error(`Chunk ${i} is missing for key ${key}`);
                break;
            }
            base64Data += chunk;
        }
        
        if (!base64Data) return null;
        
        try {
            return JSON.parse(base64decode(base64Data));
        } catch (e) {
            try {
                return base64decode(base64Data);
            } catch (e2) {
                return null;
            }
        }
    } catch (err) {
        console.error("getKVLarge error:", err);
        return null;
    }
}

// --- RSVP HANDLER ---
async function handleRSVP(request, env, corsHeaders) {
    const body = await request.json();

    const {
        fullName = "",
        attendance = "",
        guests = "",
        transfer = "",
        cottage = "",
        comment = ""
    } = body;

    if (!fullName.trim() || !attendance.trim()) {
        return new Response(
            JSON.stringify({ success: false, message: "Missing required fields" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
    }

    // Clean up cottage info prefix from comment if it was passed natively
    let displayComment = comment;
    if (cottage && displayComment.startsWith(`[Будиночок: ${cottage}]`)) {
        displayComment = displayComment.replace(`[Будиночок: ${cottage}]`, "").trim();
    } else if (displayComment.startsWith("[Будиночок:")) {
        displayComment = displayComment.replace(/^\[Будиночок:[^\]]+\]\s*/, "");
    }

    const rsvpData = {
        fullName,
        attendance,
        guests,
        transfer,
        cottage,
        comment: displayComment,
        timestamp: nowKyivISO()
    };

    // Save to database
    if (env.RSVP_DB) {
        // Native Cloudflare KV
        const id = `rsvp:${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        await env.RSVP_DB.put(id, JSON.stringify(rsvpData));
    } else if (env.TELEGRAM_CHAT_ID) {
        // Fallback to keyvalue.immanuel.co
        const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
        if (!isNaN(cleanChatId)) {
            const appKey = `rsvp_bot_${cleanChatId}`;
            
            // 1. Get index of existing records
            let indexStr = await getKV(appKey, "index");
            let keys = [];
            if (indexStr) {
                keys = indexStr.split(",").filter(k => k.trim().length > 0);
            }
            
            // 2. Generate new key and append to index
            const newKey = `rsvp_${Date.now()}`;
            keys.push(newKey);
            
            // 3. Save new index and guest record (Using chunked Base64url to bypass IIS path segment length limits and dangerous characters)
            await setKV(appKey, "index", keys.join(","));
            await setKVLarge(appKey, newKey, rsvpData);
        }
    }

    // Send Telegram Notification
    const telegramMessage = [
        "💍 Нова відповідь на весільне запрошення",
        "",
        `👤 Ім'я: ${fullName}`,
        `✅ Присутність: ${attendance}`,
        `👥 Хто буде разом: ${guests || "—"}`,
        `🚗 Трансфер: ${transfer || "—"}`,
        `🏠 Будиночок: ${cottage || "—"}`,
        `💬 Коментар: ${displayComment || "—"}`
    ].join("\n");

    const telegramResponse = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                text: telegramMessage
            })
        }
    );

    if (!telegramResponse.ok) {
        const errorText = await telegramResponse.text();
        return new Response(
            JSON.stringify({ success: false, message: "Telegram send failed", details: errorText }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
    }

    return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
}

// --- BOT WEBHOOK HANDLER ---
async function handleBotWebhook(update, env) {
    if (!update.message || !update.message.text) {
        return;
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();
    const authorizedChatId = String(env.TELEGRAM_CHAT_ID).trim();

    if (String(chatId).trim() !== authorizedChatId) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🔒 Вибачте, у вас немає доступу до цієї статистики.");
        return;
    }

    if (text === "/start" || text === "/help" || text.includes("/help")) {
        const helpMsg = [
            "🤖 Вітання! Я помічник вашого весільного запрошення.",
            "",
            "Команди:",
            "📊 /stats — загальна статистика",
            "📋 /guests — список гостей, які прийдуть",
            "🏠 /cottages — хто хоче будиночок",
            "🚗 /transfers — кому потрібен трансфер",
            "❌ /absent — хто не прийде",
            "👁 /visitors — відвідувачі сайту",
            "🗑 /delete N — видалити анкету за номером (з /guests або /absent)"
        ].join("\n");
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, helpMsg);
        return;
    }

    // Fetch records
    const rsvps = [];
    const rsvpKeys = []; // parallel array of DB keys for deletion support
    if (env.RSVP_DB) {
        // Native Cloudflare KV
        const list = await env.RSVP_DB.list({ prefix: "rsvp:" });
        for (const key of list.keys) {
            const valStr = await env.RSVP_DB.get(key.name);
            if (valStr) {
                try { rsvps.push(JSON.parse(valStr)); rsvpKeys.push(key.name); } catch (e) {}
            }
        }
    } else if (env.TELEGRAM_CHAT_ID) {
        // Fallback to keyvalue.immanuel.co
        const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
        if (!isNaN(cleanChatId)) {
            const appKey = `rsvp_bot_${cleanChatId}`;
            
            // 1. Get index of existing records
            let indexStr = await getKV(appKey, "index");
            if (indexStr) {
                const keys = indexStr.split(",").filter(k => k.trim().length > 0);
                
                // 2. Fetch all guest records
                for (const key of keys) {
                    if (!key.startsWith("rsvp_")) continue;
                    const data = await getKVLarge(appKey, key);
                    if (data) {
                        rsvps.push(data);
                        rsvpKeys.push(key);
                    }
                }
            }
        }
    }

    if (text.startsWith("/stats")) {
        let totalYes = 0;
        let totalNo = 0;
        let totalGuestsCount = 0;
        let needCottage = 0;
        let needTransfer = 0;

        for (const item of rsvps) {
            const isYes = item.attendance && item.attendance.includes("Так");
            if (isYes) {
                totalYes++;
                let extra = 0;
                if (item.guests) {
                    const m = item.guests.match(/\+(\d+)/);
                    if (m) extra = parseInt(m[1], 10);
                }
                totalGuestsCount += 1 + extra;

                if (item.cottage && item.cottage.includes("Так")) needCottage++;
                if (item.transfer && item.transfer.includes("Так")) needTransfer++;
            } else {
                totalNo++;
            }
        }

        const statsMsg = [
            "📊 Загальна статистика відповідей:",
            "",
            `✅ Будуть присутні (анкет): *${totalYes}*`,
            `👥 Загальна к-ть гостей (з супутниками): *${totalGuestsCount}*`,
            `🏠 Потрібен будиночок: *${needCottage}*`,
            `🚗 Потрібен трансфер: *${needTransfer}*`,
            `❌ Не зможуть прийти: *${totalNo}*`,
            "",
            `Отримано всього анкет: ${rsvps.length}`
        ].join("\n");

        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, statsMsg);
    } 
    else if (text.startsWith("/guests")) {
        const listYes = rsvps.filter(item => item.attendance && item.attendance.includes("Так"));
        if (listYes.length === 0) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "📋 Поки що ніхто не підтвердив присутність.");
        } else {
            let msg = "📋 Список гостей, які прийдуть:\n\n";
            listYes.forEach((item, idx) => {
                msg += `${idx + 1}. *${item.fullName}* (${item.guests || "Тільки я"})\n`;
                if (item.comment && item.comment.trim()) {
                    msg += `   💬 _${item.comment.trim()}_\n`;
                }
            });
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
        }
    } 
    else if (text.startsWith("/cottages")) {
        const listCottage = rsvps.filter(item => 
            item.attendance && item.attendance.includes("Так") && 
            item.cottage && item.cottage.includes("Так")
        );
        if (listCottage.length === 0) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🏠 Будиночок поки ніхто не замовляв.");
        } else {
            let msg = "🏠 Будиночок планують орендувати:\n\n";
            listCottage.forEach((item, idx) => {
                msg += `${idx + 1}. *${item.fullName}* (${item.guests || "Тільки я"})\n`;
            });
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
        }
    } 
    else if (text.startsWith("/transfers")) {
        const listTransfer = rsvps.filter(item => 
            item.attendance && item.attendance.includes("Так") && 
            item.transfer && item.transfer.includes("Так")
        );
        if (listTransfer.length === 0) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🚗 Трансфер нікому не потрібен.");
        } else {
            let msg = "🚗 Трансфер потрібен для:\n\n";
            listTransfer.forEach((item, idx) => {
                msg += `${idx + 1}. *${item.fullName}* (${item.guests || "Тільки я"})\n`;
            });
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
        }
    }
    else if (text.startsWith("/absent")) {
        const listNo = rsvps.filter(item => !item.attendance || !item.attendance.includes("Так"));
        if (listNo.length === 0) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Поки немає відмов.");
        } else {
            let msg = "❌ Не зможуть бути на святі:\n\n";
            listNo.forEach((item, idx) => {
                msg += `${idx + 1}. *${item.fullName}*\n`;
                if (item.comment && item.comment.trim()) {
                    msg += `   💬 _${item.comment.trim()}_\n`;
                }
            });
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
        }
    }
    else if (text.startsWith("/visitors")) {
        await handleVisitorsCommand(env, chatId);
    }
    else if (text.startsWith("/delete")) {
        const parts = text.split(/\s+/);
        const num = parseInt(parts[1], 10);
        if (isNaN(num) || num < 1 || num > rsvps.length) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ Вкажіть номер анкети від 1 до ${rsvps.length}.\nНаприклад: /delete 3`);
        } else {
            const idx = num - 1;
            const deletedItem = rsvps[idx];
            const deletedKey = rsvpKeys[idx];
            
            const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
            if (!isNaN(cleanChatId) && deletedKey) {
                const appKey = `rsvp_bot_${cleanChatId}`;
                
                // Remove from index
                let indexStr = await getKV(appKey, "index");
                if (indexStr) {
                    const keys = indexStr.split(",").filter(k => k.trim() !== deletedKey && k.trim().length > 0);
                    await setKV(appKey, "index", keys.length > 0 ? keys.join(",") : "_");
                }
                
                // Clear the data chunks (overwrite meta with 0)
                await setKV(appKey, `${deletedKey}_meta`, "0");
                
                const msg = [
                    "🗑 Анкету видалено:",
                    "",
                    `👤 ${deletedItem.fullName}`,
                    `✅ ${deletedItem.attendance}`,
                    `👥 ${deletedItem.guests || "—"}`,
                    `🚗 ${deletedItem.transfer || "—"}`,
                    `🏠 ${deletedItem.cottage || "—"}`
                ].join("\n");
                await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
            } else {
                await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Не вдалося видалити анкету.");
            }
        }
    }
}

// --- SET WEBHOOK HANDLER ---
async function handleSetWebhook(request, env, corsHeaders) {
    if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response(JSON.stringify({ success: false, message: "Bot token not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });
    }

    const url = new URL(request.url);
    const domain = url.origin;
    const webhookUrl = `${domain}/api/bot-webhook`;

    const res = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const data = await res.json();

    return new Response(
        JSON.stringify({ success: true, webhookUrl, telegramResponse: data }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
}

async function sendTelegramMessage(token, chatId, text) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
}

// --- VISIT TRACKING HANDLER ---
async function handleVisit(request, env, corsHeaders) {
    try {
        const body = await request.json();
        const visitorId = body.visitorId || "unknown";
        const clientTimezone = body.timezone || "unknown";
        const screen = body.screen || "unknown";
        const lang = body.lang || "unknown";
        const referrer = body.ref || "";
        const ua = request.headers.get("User-Agent") || "unknown";
        const now = nowKyivISO();

        // Determine device type from User-Agent
        let device = "Desktop";
        if (/mobile|android|iphone|ipad/i.test(ua)) {
            device = /ipad/i.test(ua) ? "Tablet" : "Mobile";
        }

        // Get Cloudflare geo details
        const cf = request.cf || {};
        const city = cf.city || "";
        const country = cf.country || "";
        const cfTimezone = cf.timezone || "";

        const visitEntry = {
            id: visitorId,
            ts: now,
            device: device,
            city: city,
            country: country,
            cfTimezone: cfTimezone,
            clientTimezone: clientTimezone,
            screen: screen,
            lang: lang,
            ref: referrer
        };

        const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
        if (!isNaN(cleanChatId)) {
            const appKey = `rsvp_bot_${cleanChatId}`;
            
            // Get existing visits list
            let visits = await getKVLarge(appKey, "visits_log");
            if (!visits || !Array.isArray(visits)) {
                visits = [];
            }
            
            visits.push(visitEntry);
            
            // Save updated visits list
            await setKVLarge(appKey, "visits_log", visits);
        }

        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, message: error.message }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
    }
}

// --- VISITORS COMMAND HANDLER ---
async function handleVisitorsCommand(env, chatId) {
    const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
    if (isNaN(cleanChatId)) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Помилка конфігурації.");
        return;
    }

    const appKey = `rsvp_bot_${cleanChatId}`;
    let visits = await getKVLarge(appKey, "visits_log");
    
    if (!visits || !Array.isArray(visits) || visits.length === 0) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "👁 Поки що ніхто не відвідав сайт.");
        return;
    }

    const totalVisits = visits.length;
    const uniqueIds = new Set(visits.map(v => v.id));
    const uniqueCount = uniqueIds.size;
    
    // Count devices
    let mobileCount = 0;
    let desktopCount = 0;
    let tabletCount = 0;
    for (const v of visits) {
        if (v.device === "Mobile") mobileCount++;
        else if (v.device === "Tablet") tabletCount++;
        else desktopCount++;
    }

    // Today's visits (Kyiv timezone)
    const todayKyiv = toKyiv(new Date());
    const todayStr = todayKyiv.isoDate;
    const todayVisits = visits.filter(v => {
        if (!v.ts) return false;
        const vk = toKyiv(v.ts);
        return vk.isoDate === todayStr;
    }).length;

    // Recent 20 visits
    const recent = visits.slice(-20).reverse();
    let recentLines = "";
    recent.forEach((v, idx) => {
        const k = v.ts ? toKyiv(v.ts) : null;
        const dateStr = k ? `${k.dateStr} ${k.timeStr}` : "?";
        const deviceEmoji = v.device === "Mobile" ? "📱" : v.device === "Tablet" ? "📋" : "💻";
        const shortId = v.id ? v.id.substring(0, 8) : "?";
        
        let locParts = [];
        if (v.city) locParts.push(v.city);
        if (v.country) locParts.push(v.country);
        
        const loc = locParts.length > 0 ? locParts.join(", ") : "Unknown location";
        const tz = v.clientTimezone || v.cfTimezone || "unknown tz";
        const lang = v.lang && v.lang !== "unknown" ? ` | ${v.lang}` : "";
        const screen = v.screen && v.screen !== "unknown" ? ` | ${v.screen}` : "";
        
        recentLines += `${deviceEmoji} \`${shortId}\` — ${dateStr}\n📍 _${loc}_ (${tz}${screen}${lang})\n\n`;
    });

    const msg = [
        "👁 Статистика відвідувань сайту:",
        "",
        `📊 Всього переглядів: *${totalVisits}*`,
        `👤 Унікальних відвідувачів: *${uniqueCount}*`,
        `📅 Сьогодні: *${todayVisits}*`,
        "",
        `📱 Мобільних: ${mobileCount}  |  💻 Десктоп: ${desktopCount}${tabletCount > 0 ? `  |  📋 Планшет: ${tabletCount}` : ""}`,
        "",
        "🕐 Останні відвідування:",
        recentLines
    ].join("\n");

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}
