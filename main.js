/* ==========================================================
   main.js  ·  简历驱动 AI 面试 POC
   依赖：Web Speech API + pdf.js + mammoth + /api/generate-questions
   ========================================================== */

const mammoth = window.mammoth;

/* ---------- 0. 元素获取 ---------- */
const resumeInput = document.getElementById("resume-input");
const uploadBtn   = document.getElementById("upload-btn");
const startBtn    = document.getElementById("start-btn");
const stopBtn     = document.getElementById("stop-btn");
const qaDiv       = document.getElementById("qa");

/* ---------- 1. 全局状态 ---------- */
let questions     = [];          // 动态生成的面试题
let current       = 0;           // 当前问到第几题
let transcriptLog = [];          // 记录整场对话

/* ---------- 2. 浏览器语音合成 ---------- */
function ask(text) {
  return new Promise(res => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = "zh-CN";
    utter.onend = res;
    speechSynthesis.speak(utter);
  });
}

/* ---------- 3. 浏览器语音识别 ---------- */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang           = "zh-CN";
recognition.interimResults = false;
recognition.continuous     = false;

/* ---------- 4. 辅助 UI ---------- */
function appendQA(role, text) {
  transcriptLog.push({ role, text });
  const p = document.createElement("p");
  p.innerHTML = `<strong>${role === "ai" ? "AI" : "你"}:</strong> ${text}`;
  qaDiv.appendChild(p);
  qaDiv.scrollTop = qaDiv.scrollHeight;
}

/* ---------- 5. 面试主流程 ---------- */
async function nextQuestion() {
  if (current >= questions.length) {
    appendQA("ai", "面试结束，感谢你的时间！");
    await ask("面试结束，感谢你的时间！");
    stopBtn.disabled = true;
    startBtn.disabled = false;
    console.log("📝 完整 transcript：", transcriptLog);
    return;
  }
  const q = questions[current++];
  appendQA("ai", q);
  await ask(q);
  recognition.start();
}

/* --- 识别成功：记录回答 & 进入下一题 --- */
recognition.onresult = e => {
  const text = e.results[0][0].transcript.trim();
  appendQA("user", text);
  recognition.stop();
  nextQuestion();
};

/* --- 识别错误：简单重试 --- */
recognition.onerror = e => {
  appendQA("ai", `抱歉，识别出错 (${e.error})，我们重试一次。`);
  recognition.stop();
  nextQuestion();
};

/* ---------- 6. 按钮事件 ---------- */
uploadBtn.onclick = async () => {
  const file = resumeInput.files[0];
  if (!file) return alert("请先选择简历文件 ⬆️");

  uploadBtn.disabled = true;
  uploadBtn.textContent = "⏳ 正在生成问题…";

  try {
    const resumeText = await extractPlainText(file);
    const resp = await fetch("./api/generate-questions.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: resumeText })
    });
    const data = await resp.json();
    if (!data.questions?.length) throw new Error("生成问题失败");

    questions = data.questions;
    current   = 0;
    appendQA("ai", `已根据你的简历生成 ${questions.length} 个问题，点击“开始面试”吧！`);
    startBtn.disabled = false;
  } catch (err) {
    console.error(err);
    alert(`❌ 生成问题失败：${err.message}`);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "📄 上传简历并生成问题";
  }
};

startBtn.onclick = () => {
  startBtn.disabled = true;
  stopBtn.disabled  = false;
  nextQuestion();
};

stopBtn.onclick = () => {
  recognition.abort();
  speechSynthesis.cancel();
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  appendQA("ai", "已手动停止面试。");
};

/* ---------- 7. 提取简历纯文本 ---------- */
async function extractPlainText(file) {
  /* --- PDF --- */
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    const pdfjsLib = window.pdfjsLib;     // 来自全局 CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./libs/pdf.worker.min.mjs"
    const pdf = await pdfjsLib.getDocument(await file.arrayBuffer()).promise;
    let full = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const txt  = await page.getTextContent();
      full      += txt.items.map(it => it.str).join(" ") + "\n";
    }
    return full;
  }

  /* --- DOCX --- */
  if (file.name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  }

  /* --- 纯文本 / 其它 --- */
  return await file.text();
}

/* ---------- 8. 离开页面前提醒保存 ---------- */
// 可选：localStorage 缓存
// window.onbeforeunload = () => localStorage.setItem("transcript", JSON.stringify(transcriptLog));
