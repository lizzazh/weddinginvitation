export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        
        // Safety checks
        if (!env.TELEGRAM_BOT_TOKEN) {
            return new Response("Bot token not configured", { status: 500 });
        }
        
        const update = await request.json();
        
        // Handle only text messages
        if (!update.message || !update.message.text) {
            return new Response("OK", { status: 200 });
        }
        
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const authorizedChatId = String(env.TELEGRAM_CHAT_ID).trim();
        
        // Only allow authorized chat or user to query database
        if (String(chatId).trim() !== authorizedChatId) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🔒 Вибачте, у вас немає доступу до цієї статистики.");
            return new Response("Unauthorized", { status: 200 });
        }
        
        if (text === "/start" || text === "/help") {
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
        
        if (!env.RSVP_DB) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ База даних RSVP_DB не підключена. Будь ласка, створіть та підключіть KV namespace у налаштуваннях Cloudflare Pages.");
            return new Response("OK", { status: 200 });
        }
        
        // Fetch all records
        const list = await env.RSVP_DB.list({ prefix: "rsvp:" });
        const rsvps = [];
        for (const key of list.keys) {
            const valStr = await env.RSVP_DB.get(key.name);
            if (valStr) {
                try {
                    rsvps.push(JSON.parse(valStr));
                } catch (e) {
                    // Ignore malformed JSON
                }
            }
        }
        
        if (text === "/stats") {
            let totalYes = 0;
            let totalNo = 0;
            let totalGuestsCount = 0; // count +1, +2, etc.
            let needCottage = 0;
            let needTransfer = 0;
            
            for (const item of rsvps) {
                const isYes = item.attendance && item.attendance.includes("Так");
                if (isYes) {
                    totalYes++;
                    // Extract guests count
                    let extra = 0;
                    if (item.guests) {
                        const m = item.guests.match(/\+(\d+)/);
                        if (m) extra = parseInt(m[1], 10);
                    }
                    totalGuestsCount += 1 + extra; // main person + extra
                    
                    if (item.cottage && item.cottage.includes("Так")) {
                        needCottage++;
                    }
                    if (item.transfer && item.transfer.includes("Так")) {
                        needTransfer++;
                    }
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
        else if (text === "/guests") {
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
        else if (text === "/cottages") {
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
        else if (text === "/transfers") {
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
        else if (text === "/absent") {
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
        else {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❓ Невідома команда. Надішліть /help для списку доступних команд.");
        }
        
        return new Response("OK", { status: 200 });
    } catch (err) {
        return new Response("Error: " + err.message, { status: 500 });
    }
}

async function sendTelegramMessage(token, chatId, text) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "Markdown"
        })
    });
}
