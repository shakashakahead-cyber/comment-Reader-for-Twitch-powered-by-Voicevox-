export let creating; // Singleton promise

export async function setupOffscreenDocument(path) {
    // Check if existing
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) return;

    // Wait if creating
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
