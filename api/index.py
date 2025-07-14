from fastapi import FastAPI, Request, HTTPException
from fastapi import UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
import httpx, os, asyncio, json

OPENAI_KEY   = os.environ["OPENAI_API_KEY"]
ELEVEN_KEY   = os.environ["ELEVEN_API_KEY"]
ASSEMBLY_KEY = os.environ["ASSEMBLY_API_KEY"]
VOICE_ID     = "ZIlrSGI4jZqobxRKprJz"        # Clara

app = FastAPI()

# ---------- /generate-questions ----------
@app.post("/api/generate-questions")
async def generate(payload: dict):
    resume = payload.get("resume", "")[:6000]
    job    = payload.get("job", "")[:3000]  # 可为 job title 或 JD 文本

    if not resume:
        raise HTTPException(400, "resume missing")

    # 构建 prompt
    prompt = (
    "You are a friendly and professional AI interviewer conducting an interview for the position described below.\n\n"
    "Start by introducing yourself briefly and mentioning the job title. Then ask the candidate to do a short self-introduction.\n"
    "After that, generate 4 additional interview questions that are job-relevant and based on the candidate’s résumé and the job description.\n\n"
    "Your questions should focus on the candidate’s skills, recent experience, and how well they fit the role.\n\n"
    "Return ONLY a JSON array like: [{\"q\": \"...\"}, ...].\n"
    "Do NOT include ```json or any explanation.\n"

    """Example:
    [
      {"q": "Hi! I'm your AI interviewer for this session. We're interviewing for the Software Engineer role. Could you start by briefly introducing yourself?"},
      {"q": "Can you walk me through one of your most recent projects and your role in it?"},
      {"q": "How have you used Python or Java in past backend development work?"},
      {"q": "What are some challenges you've faced when working on scalable systems, and how did you solve them?"},
      {"q": "What makes you interested in this particular role, and how do you see yourself contributing?"}
    ]
    """
    )

    if job:
        prompt += f"Job Description or Title:\n----\n{job}\n----\n\n"

    prompt += f"Candidate Résumé:\n----\n{resume}\n----"

    async with httpx.AsyncClient() as cli:
        r = await cli.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.6,
            },
            timeout=60,
        )

    data = r.json()

    try:
        questions = json.loads(data["choices"][0]["message"]["content"])
    except Exception:
        # fallback：从纯文本中尝试提取问题
        questions = [
            {"q": l.strip("•- ")} for l in
            data["choices"][0]["message"]["content"].splitlines()
            if l.strip() and "?" in l
        ][:5]

    print(questions)
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

@app.get("/api/tts")
async def tts(text: str = ""):
    if not text:
        raise HTTPException(400, "text missing")
    return StreamingResponse(eleven_stream(text),
                             media_type="audio/mpeg")


# ---------- /answer ----------
memory: dict[str, list[str]] = {}

@app.post("/api/answer")
async def answer(payload: dict):
    # payload = {id, job_desc, q, a, followup_cnt}
    _id = payload["id"]
    job = payload["job_desc"]
    q   = payload["q"]
    a   = payload["a"]
    cnt = payload["followup_cnt"]

    mem = memory.setdefault(_id, [])

    prompt = f"""
You are an intelligent and friendly AI interviewer for the role of {job}.

Your objective is to:
- Assess the candidate’s experience and technical ability
- Maintain a natural and engaging conversation flow
- Ask relevant and clear questions with smooth transitions

Current question:
{q}

Candidate's response:
{a}

Number of follow-ups already asked: {cnt}
Recent conversation summaries:
{chr(10).join(mem[-6:])}

Your response should follow these rules:
1. If the candidate’s answer is unclear, off-topic, or misses key technical points, ask ONE concise follow-up question to clarify or go deeper.
2. If the answer is reasonably clear OR the follow-up count is 2 or more, move to the next question.
3. If the candidate asks a question, first respond naturally. If it’s out of scope, say: “I’m an AI interviewer — that question might be better answered by the company’s HR.”
4. If the candidate asks to end, conclude the interview.

Tone:
- Friendly, respectful, and professional
- Respond naturally, as if you were a human interviewer
- Provide encouragement or acknowledgments like “Thanks” or “Interesting point” before transitioning

Return only valid JSON in the following format:
{{
  "action": "followup" | "next" | "finish",
  "acknowledge": "brief reply to the candidate’s question or a transitional phrase, or empty string",
  "question": "next interview question or closing statement",
  "summary": "a one-sentence summary of the candidate’s answer"
}}
"""

    async with httpx.AsyncClient() as cli:
        r = await cli.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
            },
        )
    out = json.loads(r.json()["choices"][0]["message"]["content"])
    full_question = (out["acknowledge"] + "\n" if out["acknowledge"] else "") + out["question"]
    if cnt >= 2:
        full_question = out["acknowledge"]
        out["action"] = "next"
    mem.append(out["summary"])

    #print(cnt)
    #print(out["action"])
    #print(full_question)

    return JSONResponse({
        "action": out["action"],
        "question": full_question.strip(),
        "summary": out["summary"]
    })


# ---------- /generate-report ----------
@app.post("/api/generate-report")
async def generate_report(payload: dict):
    session_id = payload.get("id")
    qna        = payload.get("qna")  # List of {q, a} dicts
    job        = payload.get("job", "Software Engineer")
    resume     = payload.get("resume", "")[:6000]

    if not qna or not isinstance(qna, list):
        raise HTTPException(400, "Invalid or missing interview data")

    formatted_qna = "\n".join([
        f"Q{i+1}: {item['q']}\nA{i+1}: {item['a']}"
        for i, item in enumerate(qna)
    ])

    prompt = (
        f"You are a professional technical recruiter and interview analyst.\n"
        f"Based on the following job context, résumé, and interview transcript,\n"
        f"write a structured and concise candidate evaluation report in English.\n"
        f"It should include:\n"
        f"1. Strengths\n2. Weaknesses\n3. Overall fit score (0–100)\n"
        f"4. Reasoning for the score and fit.\n"
        f"Keep it professional and insightful.\n\n"
        f"Job Description or Title:\n----\n{job}\n----\n\n"
        f"Résumé:\n----\n{resume}\n----\n\n"
        f"Interview Transcript:\n----\n{formatted_qna}\n----"
    )

    async with httpx.AsyncClient() as cli:
        r = await cli.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.5,
            },
            timeout=60,
        )

    data = r.json()
    report = data["choices"][0]["message"]["content"].strip()

    print("Generated Report:\n", report)
    return {"report": report}

# -------- /transcribe --------
@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    api_key = ASSEMBLY_KEY

    # 上传音频到 AssemblyAI
    async with httpx.AsyncClient() as client:
        upload_resp = await client.post(
            "https://api.assemblyai.com/v2/upload",
            headers={"authorization": api_key},
            content=await audio.read(),
            timeout=60,
        )
        upload_url = upload_resp.json()["upload_url"]

        # 请求转录
        transcript_resp = await client.post(
            "https://api.assemblyai.com/v2/transcript",
            headers={"authorization": api_key, "content-type": "application/json"},
            json={"audio_url": upload_url}
        )
        transcript_id = transcript_resp.json()["id"]

        # 查询结果（可换成 webhook）
        while True:
            r = await client.get(
                f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
                headers={"authorization": api_key}
            )
            data = r.json()
            if data["status"] == "completed":
                return {"text": data["text"]}
            elif data["status"] == "error":
                return {"text": "[Error] Transcription failed"}
            await asyncio.sleep(1)
