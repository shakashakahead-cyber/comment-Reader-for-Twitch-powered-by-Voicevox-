(async () => {
    const src = chrome.runtime.getURL('src/content/main.js');
    try {
        await import(src);
        console.log("[TwitchReader] Module loaded:", src);
    } catch (e) {
        console.error("[TwitchReader] Module load failed:", e);
    }
})();
