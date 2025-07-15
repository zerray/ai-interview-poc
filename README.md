# AI Interview PoC

A proof-of-concept AI-powered mock interview application. It simulates an interactive interview process using large language models and optionally includes voice feedback via ElevenLabs Text-to-Speech.

🌐 **Live Demo:**  
[https://ai-interview-poc.vercel.app](https://ai-interview-poc.vercel.app)

---

## 🚀 Deploy to Vercel

You can deploy this app to [Vercel](https://vercel.com) in just a few steps:

### 1. Clone the repository

```bash
git clone https://github.com/zerray/ai-interview-poc.git
cd ai-interview-poc
```

### 2. Create a new project on Vercel

- Go to [vercel.com](https://vercel.com/)
- Click “New Project”
- Import the `ai-interview-poc` repo

### 3. Set the required environment variables

In your Vercel project settings, add the following **Environment Variables**:

| Variable Name         | Description                                        |
|-----------------------|----------------------------------------------------|
| `OPENAI_API_KEY`      | Your OpenAI API key                                |
| `ELEVEN_API_KEY`      | *(Optional)* ElevenLabs API key (for TTS support)  |
| `ASSEMBLY_API_KEY`    | *(Optional)* AssemblyAI API key (for transcription) |

> 💡 You can get your ElevenLabs key from [https://elevenlabs.io](https://elevenlabs.io)  
> 💡 You can get your AssemblyAI key from [https://www.assemblyai.com](https://www.assemblyai.com)

### 4. Deploy 🎉

Once you've added the environment variables, click **Deploy**.  
Your app should be live in a minute!

---

## 🔈 Optional: Enable Voice Mode

Append the `voice=true` query parameter to the URL to enable voice responses using ElevenLabs TTS.

Example:

```
https://ai-interview-poc.vercel.app/?voice=true
```

Make sure `ELEVEN_API_KEY` is set in your environment variables for this to work.

---

## 🛠️ Tech Stack

- [Next.js](https://nextjs.org/)
- [OpenAI GPT API](https://platform.openai.com/)
- [ElevenLabs TTS API](https://elevenlabs.io)
- [AssemblyAI Transcription API](https://www.assemblyai.com)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vercel Hosting](https://vercel.com/)

---

## 📄 License

This project is provided as-is for experimentation purposes.
