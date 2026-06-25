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
                return new Response(JSON.stringify({ version: "1.2.0-chunked" }), {
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            // Route 1: Set Webhook (GET /api/set-webhook or GET /set-webhook)
            if (url.pathname === "/api/set-webhook" || url.pathname === "/set-webhook") {
                return await handleSetWebhook(request, env, corsHeaders);
            }

            // Route 2: Telegram Bot Webhook (POST /api/bot-webhook or POST /bot-webhook)
            if (request.method === "POST" && (url.pathname === "/api/bot-webhook" || url.pathname === "/bot-webhook")) {
                return await handleBotWebhook(request, env);
            }

            // Route 3: RSVP Form Submission (POST / or POST /api/rsvp)
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
        if (!res.ok) return null;
        const text = await res.text();
        if (!text || text === "null" || text === '""') return null;
        
        // Parse the outer quotes returned by ASP.NET API
        const parsedStr = JSON.parse(text);
        
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
        let i = 0;
        while (i * chunkSize < base64Data.length) {
            const chunk = base64Data.substring(i * chunkSize, (i + 1) * chunkSize);
            const success = await setKV(appKey, `${key}_${i}`, chunk);
            if (!success) return false;
            i++;
        }
        await setKV(appKey, `${key}_${i}`, "");
        return true;
    } catch (err) {
        console.error("setKVLarge error:", err);
        return false;
    }
}

async function getKVLarge(appKey, key) {
    try {
        let base64Data = "";
        let i = 0;
        const firstChunk = await getKV(appKey, `${key}_0`);
        if (firstChunk === null) {
            // Fallback for old keys that are not chunked/encoded
            const rawVal = await getKV(appKey, key);
            if (rawVal) {
                try {
                    return typeof rawVal === "object" ? rawVal : JSON.parse(rawVal);
                } catch (e) {
                    return rawVal;
                }
            }
            return null;
        }
        
        base64Data = firstChunk;
        i = 1;
        while (true) {
            const chunk = await getKV(appKey, `${key}_${i}`);
            if (!chunk || chunk === "" || chunk === "null") {
                break;
            }
            base64Data += chunk;
            i++;
        }
        
        const valStr = base64decode(base64Data);
        try {
            return JSON.parse(valStr);
        } catch (e) {
            return valStr;
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
        timestamp: new Date().toISOString()
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
async function handleBotWebhook(request, env) {
    const update = await request.json();

    if (!update.message || !update.message.text) {
        return new Response("OK", { status: 200 });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();
    const authorizedChatId = String(env.TELEGRAM_CHAT_ID).trim();

    if (String(chatId).trim() !== authorizedChatId) {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🔒 Вибачте, у вас немає доступу до цієї статистики.");
        return new Response("Unauthorized", { status: 200 });
    }

    if (text === "/start" || text === "/help" || text.includes("/help")) {
        const helpMsg = [
            "🤖 Вітання! Я помічник вашого весільного запрошення.",
            "",
            "Команди:",
            "📊 /stats — загальна статистика (кількість гостей, трансфери, будиночки)",
            "📋 /guests — список гостей, які прийдуть",
            "🏠 /cottages — список тих, кому потрібен будиночок",
            "🚗 /transfers — список тих, кому потрібен трансфер",
            "❌ /absent — список тих, хто не зможе прийти"
        ].join("\n");
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, helpMsg);
        return new Response("OK", { status: 200 });
    }

    // Fetch records
    const rsvps = [];
    if (env.RSVP_DB) {
        // Native Cloudflare KV
        const list = await env.RSVP_DB.list({ prefix: "rsvp:" });
        for (const key of list.keys) {
            const valStr = await env.RSVP_DB.get(key.name);
            if (valStr) {
                try { rsvps.push(JSON.parse(valStr)); } catch (e) {}
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

    return new Response("OK", { status: 200 });
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
