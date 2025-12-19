// background.js
console.log("=== Background Service Worker ===");

// Offscreenドキュメントの作成管理
let creating; // 作成中のPromiseを保持

async function setupOffscreenDocument(path) {
  // すでに存在するかチェック
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) return;

  // 作成中なら待つ
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'To play Voicevox audio with specific output device',
    });
    await creating;
    creating = null;
  }
}

// メッセージの中継
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. 話者リスト取得（Popup -> Background -> Voicevox）
  if (request.type === "GET_SPEAKERS") {
    fetch("http://127.0.0.1:50021/speakers")
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data: data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 2. 読み上げリクエスト（Content/Popup -> Background -> Offscreen）
  if (request.type === "SPEAK_REQUEST") {
    (async () => {
      try {
        // Offscreenがなければ作る
        await setupOffscreenDocument('offscreen.html');
        // Offscreenに転送
        chrome.runtime.sendMessage({
          type: "PLAY_AUDIO",
          payload: request.payload
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // 非同期でsendResponseを返す
  }
});
