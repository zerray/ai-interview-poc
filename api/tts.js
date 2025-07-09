// api/tts.js   （放在生成问题的那个 generate-questions.js 旁边）
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const { text = "" } = req.query;
  if (!text) return res.status(400).json({ error: "text missing" });

  // 调 ElevenLabs Streaming TTS —— 选你喜欢的 voice_id
  const VOICE_ID = "EXAVITQu4vr4xnSDxMaL";          // Rachel
  const eleven = await fetch(
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

  // 直接把音频流管道给浏览器（Content-Type: audio/mpeg）
  res.setHeader("Content-Type", "audio/mpeg");
  eleven.body.pipe(res);
}
