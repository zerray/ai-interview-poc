import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (req, res) => {
  try {
    const { resume } = await readJson(req);
    if (!resume) throw new Error("resume text missing");

    const prompt = `
你是一位严谨而友好的技术面试官。
请根据下方候选人简历，生成 5 个针对性技术/行为问题，每题尽量围绕 TA 的经验或技能展开。
要求：
1. 提问语言：中文；
2. 不要超出简历未提及的技能领域；
3. 只返回 JSON 数组，每个元素形如 {"q":"问题文本"}。
4. 只返回 **纯 JSON**，不要包在 \`\`\`json 里，不要任何注释或额外文本。

简历原文：
----
${resume.slice(0, 6000)}    <!-- 控制输入长短，免得超 token -->
----
`;

    const chatResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",          // 速度/成本合适
      temperature: 0.7,
      messages: [{ role:"user", content: prompt }]
    });

    // 尝试解析
    let questions = [];
    try {
      questions = JSON.parse(chatResp.choices[0].message.content).map(o => o.q);
    } catch (e) {
      // fallback：简单按行劈
      questions = chatResp.choices[0].message.content
                   .split(/\n+/).filter(l => l.trim()).slice(0, 5);
    }

    return res.status(200).json({ questions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

/* ---------- helper: 读取 JSON body ---------- */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", chunk => buf += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
  });
}
