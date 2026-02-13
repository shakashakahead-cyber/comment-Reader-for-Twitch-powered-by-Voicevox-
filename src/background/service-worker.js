import { setupOffscreenDocument } from './offscreen-manager.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const VOICEVOX_BASE_URLS = [
    "http://127.0.0.1:50021",
    "http://localhost:50021"
];
let preferredVoicevoxBaseUrl = VOICEVOX_BASE_URLS[0];

function getVoicevoxBaseCandidates() {
    const ordered = [];
    [preferredVoicevoxBaseUrl, ...VOICEVOX_BASE_URLS].forEach((baseUrl) => {
        if (!baseUrl || ordered.includes(baseUrl)) return;
        ordered.push(baseUrl);
    });
    return ordered;
}

function sanitizeErrorText(text) {
    return String(text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
}

async function fetchVoicevoxJson(path) {
    const candidates = getVoicevoxBaseCandidates();
    const errors = [];

    for (const baseUrl of candidates) {
        try {
            const response = await fetch(`${baseUrl}${path}`);
            if (!response.ok) {
                const errorBody = sanitizeErrorText(await response.text().catch(() => ""));
                throw new Error(
                    `HTTP ${response.status}${errorBody ? `: ${errorBody}` : ""}`
                );
            }

            preferredVoicevoxBaseUrl = baseUrl;
            return await response.json();
        } catch (err) {
            const reason = err && err.message ? err.message : String(err);
            errors.push(`${baseUrl}: ${reason}`);
        }
    }

    throw new Error(
        `VOICEVOX request failed (${path}). Tried: ${candidates.join(", ")}. ${errors.join(" | ")}`
    );
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Get Speaker List (Popup -> Background -> Voicevox)
    if (request.type === "GET_SPEAKERS") {
        fetchVoicevoxJson("/speakers")
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
