/* ========= constants & helpers ========= */
const resumeIn = document.querySelector("#resume");
const jdFile   = document.querySelector("#jdFile");
const jobTitle = document.querySelector("#jobTitle");
const reportSection = document.querySelector("#reportSection");
const downloadBtn   = document.querySelector("#downloadReport");

const uploadBtn= document.querySelector("#upload");
const startBtn = document.querySelector("#start");
const log      = document.querySelector("#log");

const urlParams = new URLSearchParams(window.location.search);
const useVoice = urlParams.get("voice") === "true";

let questions = [], idx = 0, followup = 0, sessionId = crypto.randomUUID();
let resumeText = "";
let qnaList    = [];
let jdText     = "";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = new SpeechRecognition();
rec.lang = "en-US";
rec.interimResults = false;
rec.continuous     = false;

rec.onstart = () => append("SYS", "🎙️ Listening...");
rec.onend   = () => append("SYS", "⏹️ Recognition ended.");

function append(role, txt) {
  log.textContent += `${role}: ${txt}\n`;
}

/* ========= AssemblyAI ========= */
let mediaRecorder, silenceTimer, audioChunks = [];

function stopAndTranscribe() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    append("SYS", "⏹️ Stopped recording (silence)");
  }
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.fftSize);
  let silenceDuration = 0;
  const silenceThreshold = 0.02;
  const maxSilenceTime = 3000;

  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(track => track.stop());
    audioContext.close();

    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append("audio", blob);

    const resp = await fetch("/api/transcribe", {
      method: "POST",
      body: formData
    });
    const { text } = await resp.json();
    processAnswer(text);
  };

  mediaRecorder.start();
  append("SYS", "🎙️ Recording…");

  function checkSilence() {
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const volume = Math.sqrt(sum / dataArray.length);

    if (volume < silenceThreshold) {
      silenceDuration += 1000/60.0;  // 60fps
      if (silenceDuration >= maxSilenceTime) {
        append("SYS", "🛑 Detected silence. Stopping recording.");
        mediaRecorder.stop();
        return;
      }
    } else {
      silenceDuration = 0; // reset if speech is detected
    }

    requestAnimationFrame(checkSilence);
  }

  requestAnimationFrame(checkSilence);
}

/* ========= TTS via /api/tts ========= */
function fallbackSpeak(text) {
  return new Promise(res => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = "en";
    utter.onend = res;
    speechSynthesis.speak(utter);
  });
}

async function ask(text) {
  append("AI", text);
  if (!useVoice) {
    return fallbackSpeak(text); // fallback only
  }
  const resp = await fetch("/api/tts?text=" + encodeURIComponent(text));
  if (!resp.ok) { append("SYS", "TTS error"); return fallbackSpeak(text); }
  const url  = URL.createObjectURL(await resp.blob());
  await new Promise(resolve => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });
  URL.revokeObjectURL(url);
}

/* ========= upload & question generation ========= */
uploadBtn.onclick = async () => {
  const f = resumeIn.files[0];
  if (!f) return alert("Please select a resume file first.");
  uploadBtn.disabled = true;
  append("SYS", "⏳ Reading resume content…");

  let resume = "";

  if (f.name.endsWith(".pdf")) {
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./libs/pdf.worker.min.mjs";
    const typedarray = new Uint8Array(await f.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const txt = await page.getTextContent();
      resume += txt.items.map(item => item.str).join(" ") + "\n";
    }

  } else if (f.name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
    resume = value;

  } else if (f.name.endsWith(".txt")) {
    resume = await f.text();

  } else {
    alert("Unsupported file type. Please upload PDF, DOCX, or TXT.");
    uploadBtn.disabled = false;
    return;
  }
  resumeText = resume;

  // === Parse JD if available ===
  let jdText = "";
  const jd = jdFile.files[0];

  if (jd) {
    append("SYS", "📄 Reading job description...");
    if (jd.name.endsWith(".pdf")) {
      const pdfjsLib = window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "./libs/pdf.worker.min.mjs";
      const typedarray = new Uint8Array(await jd.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const txt = await page.getTextContent();
        jdText += txt.items.map(item => item.str).join(" ") + "\n";
      }
    } else if (jd.name.endsWith(".docx")) {
      const { value } = await mammoth.extractRawText({ arrayBuffer: await jd.arrayBuffer() });
      jdText = value;
    } else if (jd.name.endsWith(".txt")) {
      jdText = await jd.text();
    } else {
      alert("Unsupported JD file type.");
      uploadBtn.disabled = false;
      return;
    }
    append("SYS", "📌 JD parsed.");
  } else {
    append("SYS", `📌 No JD uploaded. Using job title: "${jobTitle.value}"`);
  }

  // === Generate questions ===
  append("SYS", "📤 Sending data to backend…");
  const { questions: qList } = await fetch("/api/generate-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume,
      job: jdText || jobTitle.value || "Software Engineer"
    })
  }).then(r => r.json());

  questions = qList;
  append("AI", "Questions generated. Click “Start Interview”.");
  startBtn.disabled = false;
};

/* ========= interview loop ========= */
async function nextQuestion(qText) {
  await ask(qText);
  startRecording();
};

async function processAnswer(ans) {
  append("YOU", ans);

  qnaList.push({ q: questions[idx], a: ans });

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
  } else if (action === "next" && idx+1 < questions.length) {
    followup = 0; await nextQuestion(questions[++idx]);
  } else {
    append("AI","The interview is finished. Thank you!");
    reportSection.classList.remove("hidden");
  }
};

startBtn.onclick = () => nextQuestion(questions[idx]);

downloadBtn.onclick = async () => {
  append("SYS", "📄 Generating interview report…");

  const resp = await fetch("/api/generate-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: sessionId,
      qna: qnaList,
      job: jdText || jobTitle.value || "Software Engineer",
      resume: resumeText
    })
  });
  const { report } = await resp.json();

  // 下载为文本文件
  const blob = new Blob([report], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "interview_report.txt";
  a.click();
  URL.revokeObjectURL(url);
};
