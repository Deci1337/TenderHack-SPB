import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node src/transcribe.js <audio-file>");
  process.exit(1);
}

const result = await client.audio.transcriptions.create({
  file: fs.createReadStream(filePath),
  model: "whisper-1",
});

console.log(result.text);
