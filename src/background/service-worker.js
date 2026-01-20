import { setupOffscreenDocument } from './offscreen-manager.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Get Speaker List (Popup -> Background -> Voicevox)
    if (request.type === "GET_SPEAKERS") {
        fetch("http://127.0.0.1:50021/speakers")
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data: data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // 2. Speak Request (Content/Popup -> Background -> Offscreen)
    if (request.type === "SPEAK_REQUEST") {
        (async () => {
            try {
                // Ensure Offscreen exists
                await setupOffscreenDocument(OFFSCREEN_PATH);
                // Forward to Offscreen
                chrome.runtime.sendMessage({
                    type: "PLAY_AUDIO",
                    payload: request.payload
                });
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // async response
    }
});
