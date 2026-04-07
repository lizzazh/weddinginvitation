export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();

        const {
            fullName = "",
            attendance = "",
            guests = "",
            transfer = "",
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

        const telegramMessage = [
            "💍 Нова відповідь на весільне запрошення",
            "",
            `👤 Ім'я: ${fullName}`,
            `✅ Присутність: ${attendance}`,
            `👥 Хто буде разом: ${guests || "—"}`,
            `🚗 Трансфер: ${transfer || "—"}`,
            `💬 Коментар: ${comment || "—"}`
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