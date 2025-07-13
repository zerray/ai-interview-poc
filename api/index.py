from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
import httpx, os, asyncio, json

OPENAI_KEY   = os.environ["OPENAI_API_KEY"]
ELEVEN_KEY   = os.environ["ELEVEN_API_KEY"]
VOICE_ID     = "MF3mGyEYCl7XYWbV9V6O"        # Bella（多语言）

app = FastAPI()

# ---------- /generate-questions ----------
@app.post("/generate-questions")
async def generate(payload: dict):
    resume = payload.get("resume", "")[:6000]
    if not resume:
        raise HTTPException(400, "resume missing")

    prompt = (
        "你是一位面试官。根据候选人简历生成 5 个中文问题，"
        "只返回 JSON: [{\"q\":\"...\"},...]。\n\n简历:\n----\n" + resume + "\n----"
    )

    async with httpx.AsyncClient() as cli:
        r = await cli.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role":"user","content": prompt}],
                "temperature": 0.6,
            },
            timeout=60,
        )
    data = r.json()
    try:
        questions = json.loads(data["choices"][0]["message"]["content"])
    except Exception:
        # 粗兜底：按行切
        questions = [
            {"q": l.strip("•- ")} for l in
            data["choices"][0]["message"]["content"].splitlines() if l.strip()
        ][:5]

    return {"questions": [q["q"] for q in questions]}


# ---------- /tts ----------
async def eleven_stream(text: str):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/stream"
    headers = {"xi-api-key": ELEVEN_KEY, "Content-Type": "application/json"}
    body = {
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.35, "similarity_boost": 0.8},
        "text": text[:950],
    }
    async with httpx.AsyncClient(timeout=None) as cli:
        async with cli.stream("POST", url, headers=headers, json=body) as resp:
            if resp.status_code >= 400:
                detail = await resp.aread()
                raise HTTPException(502, detail.decode())
            async for chunk in resp.aiter_bytes():
                yield chunk

@app.get("/tts")
async def tts(text: str = ""):
    if not text:
        raise HTTPException(400, "text missing")
    return StreamingResponse(eleven_stream(text),
                             media_type="audio/mpeg")


# ---------- /answer  (动态追问/追踪记忆) ----------
memory: dict[str, list[str]] = {}      # demo 用内存字典；Prod 请换 Redis/DB

@app.post("/answer")
async def answer(payload: dict):
    # payload = {id, job_desc, q, a, followup_cnt}
    _id = payload["id"]
    job = payload["job_desc"]
    q   = payload["q"]
    a   = payload["a"]
    cnt = payload["followup_cnt"]

    mem = memory.setdefault(_id, [])
    prompt = f"""
你是一位面试官，领域 {job}。
当前问题: {q}
候选人回答: {a}

历史摘要:
{chr(10).join(mem[-6:])}

如果回答信息不足，给一个后续追问 (followup)。
若已充分，给下一个主问题 (next)。
JSON:
{{"action":"followup|next|finish","question":"...","summary":"一句话摘要"}}
"""
    async with httpx.AsyncClient() as cli:
        r = await cli.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role":"user","content": prompt}],
                "temperature": 0.4,
            },
        )
    out = json.loads(r.json()["choices"][0]["message"]["content"])
    mem.append(out["summary"])
    return JSONResponse(out)
