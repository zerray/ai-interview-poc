/* ========= constants & helpers ========= */
const resumeIn = document.querySelector("#resume");
const uploadBtn= document.querySelector("#upload");
const startBtn = document.querySelector("#start");
const log      = document.querySelector("#log");

let questions = [], idx = 0, followup = 0, sessionId = crypto.randomUUID();

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = new SpeechRecognition();
rec.lang = "en-US";                // <-- set ASR language
rec.interimResults = false;
rec.continuous     = false;

function append(role, txt) {
  log.textContent += `${role}: ${txt}\n`;
}

/* ========= TTS via /api/tts ========= */
async function ask(text) {
  append("AI", text);
  const resp = await fetch("/api/tts?text=" + encodeURIComponent(text));
  if (!resp.ok) { append("SYS", "TTS error"); return; }
  const url  = URL.createObjectURL(await resp.blob());
  await new Audio(url).play().catch(()=>{});
  URL.revokeObjectURL(url);
}

/* ========= upload & question generation ========= */
uploadBtn.onclick = async () => {
  const f = resumeIn.files[0];
  if (!f) return alert("Please select a resume file first.");
  uploadBtn.disabled = true;
  append("SYS", "⏳ Parsing resume …");

  const resume = await f.text();
  const { questions: qList } = await fetch("/api/generate-questions", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ resume })
  }).then(r=>r.json());

  questions = qList;
  append("AI", "Questions generated. Click “Start Interview”.");
  startBtn.disabled = false;
};

/* ========= interview loop ========= */
async function nextQuestion(qText) {
  await ask(qText);
  rec.start();
}

rec.onresult = async e => {
  const ans = e.results[0][0].transcript.trim();
  append("YOU", ans);
  rec.stop();

  const payload = {
    id: sessionId,
    job_desc: "Backend Java Architecture",
    q: questions[idx],
    a: ans,
    followup_cnt: followup
  };
  const { action, question } = await fetch("/api/answer", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  }).then(r=>r.json());

  if (action === "followup") {
    followup++; await nextQuestion(question);
  } else if (action === "next") {
    followup = 0; questions[++idx] = question; await nextQuestion(question);
  } else {
    append("AI","The interview is finished. Thank you!");
  }
};

startBtn.onclick = () => nextQuestion(questions[idx]);
