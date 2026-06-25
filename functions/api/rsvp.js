export async function onRequestPost(context) {
    try {
        const { request, env } = context;
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
                JSON.stringify({
                    success: false,
                    message: "Missing required fields"
                }),
                {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
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

        // Save RSVP to KV database (if configured)
        if (env.RSVP_DB) {
            const id = `rsvp:${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            await env.RSVP_DB.put(id, JSON.stringify(rsvpData));
        } else if (env.TELEGRAM_CHAT_ID) {
            // Fallback: Save to kvdb.io (zero-config database based on chat ID)
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
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    chat_id: env.TELEGRAM_CHAT_ID,
                    text: telegramMessage
                })
            }
        );

        if (!telegramResponse.ok) {
            const telegramErrorText = await telegramResponse.text();

            return new Response(
                JSON.stringify({
                    success: false,
                    message: "Telegram request failed",
                    details: telegramErrorText
                }),
                {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        return new Response(
            JSON.stringify({
                success: true
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                message: error.message || "Unknown error"
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
}