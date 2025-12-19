// offscreen.js [Deduplication Added]
const VOICEVOX_URL = "http://127.0.0.1:50021";
let audioQueue = [];
let isPlaying = false;

// ▼▼▼ 追加: 再生済みIDを記録するセット ▼▼▼
const playedIds = new Set();

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "PLAY_AUDIO") {
    // ... (omitted) ...
    const payload = request.payload;

    if (payload.uniqueId && playedIds.has(payload.uniqueId)) {

      return;
    }

    if (payload.uniqueId) {
      playedIds.add(payload.uniqueId);
      setTimeout(() => {
        playedIds.delete(payload.uniqueId);
      }, 5000);
    }

    audioQueue.push(payload);
    processQueue();
  }

  // ▼▼▼ 追加: キュークリア処理 ▼▼▼
  if (request.type === "CLEAR_QUEUE") {

    audioQueue = []; // キューを空にする
    isPlaying = false;
    // 現在再生中の音声を止める簡単な方法は、ページをリロードするか、
    // あるいはAudio要素をglobalで保持して pause() する。
    // 今回は単純化のため reload する（Offscreenなので影響は少ない）
    window.location.reload();
  }
});

async function processQueue() {
  if (isPlaying || audioQueue.length === 0) return;

  const item = audioQueue.shift();
  isPlaying = true;

  try {
    const audioBlob = await generateAudio(item.text, item.speakerId, item.speed);
    await playAudio(audioBlob, item.volume, item.deviceId);
  } catch (err) {
    console.error("Playback Error:", err);
  } finally {
    isPlaying = false;
    processQueue();
  }
}

// ... (以下、generateAudio と playAudio は変更なし) ...
async function generateAudio(text, speakerId, speed) {
  const queryUrl = `${VOICEVOX_URL}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`;
  const queryRes = await fetch(queryUrl, { method: "POST" });

  if (!queryRes.ok) throw new Error("Voicevox API Error");

  const queryJson = await queryRes.json();
  queryJson.speedScale = Number(speed) || 1.0;
  queryJson.volumeScale = 1.0;

  const synthRes = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(queryJson)
  });

  return await synthRes.blob();
}

async function playAudio(blob, volume, deviceId) {
  return new Promise(async (resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.volume = volume;

    if (deviceId && typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(deviceId);
      } catch (e) {
        console.warn("Failed to set audio device:", e);
      }
    }

    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = (e) => {
      console.error("Audio Playback Error", e);
      URL.revokeObjectURL(url);
      resolve();
    };

    try {
      await audio.play();
    } catch (e) {
      console.error("Play failed:", e);
      resolve();
    }
  });
}