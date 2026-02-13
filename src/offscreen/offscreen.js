// offscreen.js
const VOICEVOX_BASE_URLS = [
    "http://127.0.0.1:50021",
    "http://localhost:50021"
];
let preferredVoicevoxBaseUrl = VOICEVOX_BASE_URLS[0];
let audioQueue = [];
let isPlaying = false;
const UNIQUE_ID_DEDUP_TTL_MS = 30 * 1000;
const uniqueIdsInQueue = new Set();
const recentUniqueIds = new Map();
const SINK_ID_RETRY_COOLDOWN_MS = 30 * 1000;
const failedSinkIds = new Map();
let hasLoggedSinkIdUnsupported = false;

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

function describeError(error) {
    if (!error) return "Unknown error";
    const name = typeof error.name === "string" && error.name ? error.name : "Error";
    const message = typeof error.message === "string" && error.message ? error.message : "";
    return message ? `${name}: ${message}` : name;
}

function normalizeDeviceId(deviceId) {
    return String(deviceId ?? "").trim();
}

function shortDeviceId(deviceId) {
    if (!deviceId) return "<default>";
    if (deviceId.length <= 12) return deviceId;
    return `${deviceId.slice(0, 6)}...${deviceId.slice(-4)}`;
}

function shouldRetrySinkId(deviceId, now = Date.now()) {
    const failedAt = failedSinkIds.get(deviceId);
    if (!failedAt) return true;

    if ((now - failedAt) >= SINK_ID_RETRY_COOLDOWN_MS) {
        failedSinkIds.delete(deviceId);
        return true;
    }

    return false;
}

async function fetchVoicevox(path, init = {}) {
    const candidates = getVoicevoxBaseCandidates();
    const errors = [];

    for (const baseUrl of candidates) {
        const requestUrl = `${baseUrl}${path}`;

        try {
            const response = await fetch(requestUrl, init);
            if (!response.ok) {
                const errorBody = sanitizeErrorText(await response.text().catch(() => ""));
                throw new Error(
                    `HTTP ${response.status}${errorBody ? `: ${errorBody}` : ""}`
                );
            }

            preferredVoicevoxBaseUrl = baseUrl;
            return response;
        } catch (err) {
            const reason = err && err.message ? err.message : String(err);
            errors.push(`${baseUrl}: ${reason}`);
        }
    }

    throw new Error(
        `VOICEVOX fetch failed (${path}). Tried: ${candidates.join(", ")}. ${errors.join(" | ")}`
    );
}

function pruneRecentUniqueIds(now) {
    for (const [uniqueId, timestamp] of recentUniqueIds.entries()) {
        if (now - timestamp > UNIQUE_ID_DEDUP_TTL_MS) {
            recentUniqueIds.delete(uniqueId);
        }
    }
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "PLAY_AUDIO") {
        const payload = request.payload;
        if (!payload || typeof payload.text !== "string" || !payload.text.trim()) return;

        if (payload.uniqueId) {
            const now = Date.now();
            pruneRecentUniqueIds(now);
            if (uniqueIdsInQueue.has(payload.uniqueId)) return;

            const seenAt = recentUniqueIds.get(payload.uniqueId);
            if (seenAt && (now - seenAt) < UNIQUE_ID_DEDUP_TTL_MS) return;

            uniqueIdsInQueue.add(payload.uniqueId);
        }

        audioQueue.push(payload);
        processQueue();
    }

    // Queue clear handling
    if (request.type === "CLEAR_QUEUE") {
        audioQueue = []; // Empty the queue
        isPlaying = false;
        uniqueIdsInQueue.clear();
        recentUniqueIds.clear();
        // Simple way to stop current audio is to reload the page
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
        if (item.uniqueId) {
            uniqueIdsInQueue.delete(item.uniqueId);
            recentUniqueIds.set(item.uniqueId, Date.now());
        }
        isPlaying = false;
        processQueue();
    }
}

async function generateAudio(text, speakerId, speed) {
    const safeSpeakerId = Number.isFinite(Number(speakerId)) ? Number(speakerId) : 3;
    const queryPath = `/audio_query?speaker=${encodeURIComponent(safeSpeakerId)}&text=${encodeURIComponent(text)}`;
    const queryRes = await fetchVoicevox(queryPath, { method: "POST" });

    const queryJson = await queryRes.json();
    queryJson.speedScale = Number(speed) || 1.0;
    queryJson.volumeScale = 1.0;

    const synthRes = await fetchVoicevox(`/synthesis?speaker=${encodeURIComponent(safeSpeakerId)}`, {
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

        const normalizedDeviceId = normalizeDeviceId(deviceId);

        if (normalizedDeviceId && typeof audio.setSinkId === 'function') {
            if (shouldRetrySinkId(normalizedDeviceId)) {
                try {
                    await audio.setSinkId(normalizedDeviceId);
                    failedSinkIds.delete(normalizedDeviceId);
                } catch (e) {
                    failedSinkIds.set(normalizedDeviceId, Date.now());
                    console.warn(
                        `[AudioOutput] Failed to set sinkId "${shortDeviceId(normalizedDeviceId)}". ` +
                        `Falling back to default output. ${describeError(e)}`
                    );

                    try {
                        await audio.setSinkId("default");
                    } catch (fallbackErr) {
                        console.warn(
                            `[AudioOutput] Failed to switch to default sink. ${describeError(fallbackErr)}`
                        );
                    }
                }
            }
        } else if (normalizedDeviceId && typeof audio.setSinkId !== 'function' && !hasLoggedSinkIdUnsupported) {
            hasLoggedSinkIdUnsupported = true;
            console.warn(
                "[AudioOutput] setSinkId is not supported in this context. Using default output device."
            );
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
