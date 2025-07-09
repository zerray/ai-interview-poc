export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const text = (req.query?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text missing" });

  const VOICE_ID = "EXAVITQu4vr4xnSDxMaL";           // Rachel；可换成你喜欢的
  const elevenResp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.3, similarity_boost: 0.8 },
        text
      })
    }
  );

  if (!elevenResp.ok) {
    const errText = await elevenResp.text();
    return res.status(500).json({ error: errText });
  }

  res.setHeader("Content-Type", "audio/mpeg");
  elevenResp.body.pipe(res);          // 把 MP3 流直接回给浏览器
}
