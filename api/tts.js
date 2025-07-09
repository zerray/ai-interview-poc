// api/tts.js  —— 完整替换原文件
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const text = (req.query?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text missing" });

  // 1️⃣ 选多语言 voice，100% 兼容中/英
  const VOICE_ID = "MF3mGyEYCl7XYWbV9V6O";          // Bella（官方多语言示例）

  // 2️⃣ 如果字符过长 → 直接 400，前端可切句或加 <break>
  if (text.length > 950) {
    return res.status(400).json({ error: "Text too long (>950 chars)" });
  }

  // 3️⃣ 调 ElevenLabs Streaming TTS
  const elevenResp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json",
        // 告诉 ElevenLabs 我想要 mpeg 流
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        model_id: "eleven_multilingual_v2",
        text,
        // ↓ 可调语气；0.0~1.0
        voice_settings: { stability: 0.35, similarity_boost: 0.80 }
      })
    }
  );

  // 4️⃣ 若 ElevenLabs 报错 → 把信息透回浏览器方便调试
  if (!elevenResp.ok) {
    const errText = await elevenResp.text();
    return res.status(502).json({ error: errText });
  }

  // 5️⃣ 把 MP3 Stream 透传给前端
  res.setHeader("Content-Type", "audio/mpeg");
  return elevenResp.body.pipe(res);      // Node v18+ readable → pipe OK
}
