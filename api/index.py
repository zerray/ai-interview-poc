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
        "You are a professional interviewer. Based on the candidate’s résumé "
        "and the job context below, generate 5 job-relevant QUESTIONS in English. "
        "Focus on skills, experience, and fit. "
        "Return ONLY a JSON array like [{\"q\": \"...\"}, ...]. "
        "Do NOT include ```json or any explanation.\n\n"
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
    You are an interviewer for the role: {job}.
    Current question: {q}
    Candidate's answer: {a}
    Follow-up count: {cnt}

    Conversation summaries so far:
    {chr(10).join(mem[-6:])}

    Decide the next action:
    1. "followup" – ask a deeper question about THIS topic
    2. "next"     – move to the NEXT main question
    3. "finish"   – end the interview

    Additional rule:
    - If follow-up count has reached 3 and the candidate still cannot give a clear or specific answer, or if the candidate says they don't know or can't remember, then choose "next".

    Respond ONLY as valid JSON matching:
    {{
      "action": "followup" | "next" | "finish",
      "question": "your next question or goodbye statement",
      "summary": "one-sentence summary of the candidate's answer"
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
    mem.append(out["summary"])
    return JSONResponse(out)


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
