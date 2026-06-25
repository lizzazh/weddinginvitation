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

    // Save to Cloudflare KV
    if (env.RSVP_DB) {
        const id = `rsvp:${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        await env.RSVP_DB.put(id, JSON.stringify(rsvpData));
    } else if (env.TELEGRAM_CHAT_ID) {
        // Fallback to kvdb.io
        const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
        if (!isNaN(cleanChatId)) {
            const id = `rsvp_${Date.now()}`;
            try {
                await fetch(`https://kvdb.io/rsvp_bot_${cleanChatId}/${id}`, {
                    method: "POST",
                    body: JSON.stringify(rsvpData)
                });
            } catch (e) {
                console.error("kvdb.io write error:", e);
            }
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
        const list = await env.RSVP_DB.list({ prefix: "rsvp:" });
        for (const key of list.keys) {
            const valStr = await env.RSVP_DB.get(key.name);
            if (valStr) {
                try { rsvps.push(JSON.parse(valStr)); } catch (e) {}
            }
        }
    } else if (env.TELEGRAM_CHAT_ID) {
        const cleanChatId = Math.abs(parseInt(env.TELEGRAM_CHAT_ID, 10));
        if (!isNaN(cleanChatId)) {
            try {
                const kvRes = await fetch(`https://kvdb.io/rsvp_bot_${cleanChatId}/?values=true`);
                if (kvRes.ok) {
                    const kvData = await kvRes.json();
                    for (const pair of kvData) {
                        try { rsvps.push(JSON.parse(pair[1])); } catch (e) {}
                    }
                }
            } catch (e) {
                console.error("kvdb.io read error:", e);
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
