export async function onRequestGet(context) {
    try {
        const { request, env } = context;
        
        if (!env.TELEGRAM_BOT_TOKEN) {
            return new Response(JSON.stringify({
                success: false,
                message: "TELEGRAM_BOT_TOKEN is not configured in Cloudflare environment variables."
            }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        
        const url = new URL(request.url);
        const domain = url.origin;
        const webhookUrl = `${domain}/api/bot-webhook`;
        
        const telegramRes = await fetch(
            `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
        );
        const data = await telegramRes.json();
        
        return new Response(
            JSON.stringify({
                success: true,
                message: "Webhook configuration finished.",
                webhookUrl: webhookUrl,
                telegramResponse: data
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
                message: error.message || "Unknown error occurred"
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
