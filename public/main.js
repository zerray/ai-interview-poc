const resumeIn = document.querySelector("#resume");
const uploadBtn= document.querySelector("#upload");
const startBtn = document.querySelector("#start");
const log      = document.querySelector("#log");

let questions = [], idx = 0, followup = 0, sessionId = crypto.randomUUID();

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = new SpeechRecognition();
rec.lang = "zh-CN"; rec.interimResults = false; rec.continuous = false;

function append(role, txt) {
  log.textContent += `${role}: ${txt}\n`;
}

async function ask(text) {
  append("AI", text);
  const r = await fetch("/api/tts?text=" + encodeURIComponent(text));
  const url = URL.createObjectURL(await r.blob());
  await new Audio(url).play().catch(()=>{});
  URL.revokeObjectURL(url);
}

uploadBtn.onclick = async () => {
  const f = resumeIn.files[0];
  if (!f) return alert("请选择文件");
  uploadBtn.disabled = true; append("SYS","⏳ 解析简历…");
  const resume = await f.text();           // 简化：只吃 txt/docx 转 txt
  const r = await fetch("/api/generate-questions",{
    method:"POST",headers:{'Content-Type':'application/json'},
    body: JSON.stringify({resume})
  }).then(r=>r.json());
  questions = r.questions;
  append("AI","已生成问题，点击开始");
  startBtn.disabled = false;
};

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
    job_desc: "Java 后端架构",
    q: questions[idx],
    a: ans,
    followup_cnt: followup
  };
  const {action, question} = await fetch("/api/answer",{
      method:"POST",
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    }).then(r=>r.json());

  if (action === "followup") { followup++; await nextQuestion(question); }
  else if (action === "next") { followup=0; questions[++idx]=question; await nextQuestion(question); }
  else append("AI","面试结束！");
};

startBtn.onclick = () => nextQuestion(questions[idx]);
